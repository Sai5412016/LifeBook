/**
 * core/storage/media-sign — the app's client for the Edge Function
 * `media-sign` and for the short-lived R2 URLs it signs (PR 2, 2026-11-26).
 * Every decision lives in ./media-sign-protocol.ts (pure, tested); this file
 * only makes the requests. In `core/`, not `features/photos/`, for the same
 * layering reason as ./objects.ts: nothing in core imports features.
 *
 * NEVER log a signed URL, a token or a request body here — a signed URL
 * opens one original for up to an hour. Errors carry status + code only.
 */

import { File, UploadType } from 'expo-file-system';

import { ENV } from '@/core/env';
import { supabase } from '@/core/supabase';

import {
  R2RequestError,
  SIZE_PROBE_RANGE,
  buildMediaSignBody,
  isR2Success,
  parseMediaSignResponse,
  r2ErrorCode,
  storedSizeFromRangeProbe,
  type MediaSignOp,
  type SignedObjectRequest,
} from './media-sign-protocol';

/** What a request against R2 needs from a signature. */
export type SignedRequestParts = Pick<SignedObjectRequest, 'url' | 'method' | 'headers'>;

const FUNCTION_URL = (): string => `${ENV.SUPABASE_URL}/functions/v1/media-sign`;

/**
 * Asks `media-sign` for ONE signed request. The function itself decides the
 * object key and the household from the photo row (never from us), checks
 * membership/role, and refuses anything else with 4xx — surfaced here as
 * `MediaSignError` with its code.
 */
export async function requestMediaSign(
  photoId: string,
  op: MediaSignOp,
  put?: { contentType: string; bytes: number },
): Promise<SignedObjectRequest> {
  const { status, json } = await callMediaSign(buildMediaSignBody(photoId, op, put));
  return parseMediaSignResponse(status, json);
}

/**
 * The raw call: any body, status + parsed JSON back. Used by
 * `requestMediaSign` and, with a deliberately invalid body, by the
 * self-test in Einstellungen (features/photos/storage.ts#runR2SelfTest).
 */
export async function callMediaSign(body: unknown): Promise<{ status: number; json: unknown }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('media-sign: nicht angemeldet');
  }
  const response = await fetch(FUNCTION_URL(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ENV.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/**
 * Status and R2 `<Code>` of a one-byte GET on a signed URL, without
 * interpreting them — for the self-test, where a 404 NoSuchKey is the
 * EXPECTED answer. `status: null` when R2 could not be reached at all.
 */
export async function probeR2Raw(signedGet: SignedRequestParts): Promise<{ status: number | null; code: string | null }> {
  try {
    const response = await fetch(signedGet.url, { method: 'GET', headers: { Range: SIZE_PROBE_RANGE } });
    const body = response.status === 206 || response.status === 200 ? null : await response.text().catch(() => null);
    return { status: response.status, code: r2ErrorCode(body) };
  } catch {
    return { status: null, code: null };
  }
}

/**
 * Streams a local file to R2 with a signed PUT. Sends EXACTLY the headers
 * from the signature (content-type + content-length) and nothing else —
 * R2 recomputes the signature from them.
 *
 * WHY THIS SENDS A REAL Content-Length AND NEVER "chunked" (checked in the
 * installed expo-file-system 57.0.2, Android): `File.upload` with
 * BINARY_CONTENT builds its body in FileSystemUploadTask.kt#createBinaryBody
 * → `file.asRequestBody(null)`, whose `contentLength()` is `length()` of the
 * file (FileSystemUploadTask.kt:258-266). For a file:// path that is
 * `JavaFile` (unifiedfile/JavaFile.kt:22, `extends java.io.File`), so
 * `length()` is the exact byte count, never -1. OkHttp (4.9.2, the version
 * expo-file-system's build.gradle pins) then sets `Content-Length` from the
 * body and removes `Transfer-Encoding` in its BridgeInterceptor — chunked is
 * only used for a body whose length is -1. Our own `content-length` header is
 * replaced by OkHttp with that same value, so the signed length and the sent
 * length can only differ if the file changed on disk in between — and then R2
 * refuses with 403, which is exactly what the signature is for. Content-Type:
 * the body's own type is null here, so OkHttp keeps the header we pass.
 */
export async function putFileToR2(localUri: string, signed: SignedRequestParts): Promise<void> {
  const file = new File(localUri);
  if (!file.info().exists) {
    throw new Error('R2: lokale Datei fehlt vor dem Hochladen');
  }
  const response = await file.upload(signed.url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: signed.headers,
  });
  if (!isR2Success(response.status)) {
    throw new R2RequestError('upload', response.status, r2ErrorCode(response.body));
  }
}

/**
 * Size of the stored object, read with a one-byte ranged GET on a signed GET
 * URL (see media-sign-protocol.ts#storedSizeFromRangeProbe for why not HEAD).
 * null = not there; throws on any other refusal.
 */
export async function probeR2ObjectSize(signedGet: SignedRequestParts): Promise<number | null> {
  const response = await fetch(signedGet.url, { method: 'GET', headers: { Range: SIZE_PROBE_RANGE } });
  const ok = response.status === 206 || response.status === 200 || response.status === 404;
  const body = ok ? null : await response.text().catch(() => null);
  return storedSizeFromRangeProbe(
    response.status,
    { contentRange: response.headers.get('content-range'), contentLength: response.headers.get('content-length') },
    body,
  );
}

/** Deletes the object behind a signed DELETE URL. A missing object is success (S3 semantics: 204). */
export async function deleteR2Object(signedDelete: SignedRequestParts): Promise<void> {
  const response = await fetch(signedDelete.url, { method: 'DELETE' });
  if (!isR2Success(response.status) && response.status !== 404) {
    const body = await response.text().catch(() => null);
    throw new R2RequestError('delete', response.status, r2ErrorCode(body));
  }
}
