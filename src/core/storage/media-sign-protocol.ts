/**
 * core/storage/media-sign-protocol — the PURE half of the app's client for the
 * Edge Function `media-sign` (supabase/functions/media-sign, deployed
 * 2026-11-26 as version 1) and for the signed R2 URLs it hands out. No Expo,
 * React Native or Supabase import, so every rule here runs under Vitest
 * (media-sign-protocol.test.ts); ./media-sign.ts does the actual requests.
 *
 * Logging rule, same as the function's own: a signed URL is a bearer
 * credential for one object for up to an hour. Nothing in here puts a URL,
 * a token or a key into an error message — only HTTP statuses and the
 * short error CODES (`not_signed_in`, `SignatureDoesNotMatch`, …).
 */

export type MediaSignOp = 'get' | 'put' | 'delete';

/** What the function answers with 200 (docs/r2.md). */
export type SignedObjectRequest = {
  url: string;
  method: 'GET' | 'PUT' | 'DELETE';
  /** For PUT: exactly the headers the upload must send (content-type, content-length). Empty otherwise. */
  headers: Record<string, string>;
  expiresAt: string;
};

/** A refused or failed call to `media-sign` — `code` is the function's own error code. */
export class MediaSignError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`media-sign HTTP ${status} (${code})`);
    this.name = 'MediaSignError';
  }
}

/** A request to R2 itself (PUT/GET/DELETE on a signed URL) that did not succeed. */
export class R2RequestError extends Error {
  constructor(
    readonly operation: 'upload' | 'size-check' | 'download' | 'delete',
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`R2 ${operation} HTTP ${status}${code ? ` (${code})` : ''}`);
    this.name = 'R2RequestError';
  }
}

export type MediaSignBody =
  | { photo_id: string; op: 'get' | 'delete' }
  | { photo_id: string; op: 'put'; content_type: string; bytes: number };

/**
 * The request body. For `put`, `bytes` MUST be the real size of the file
 * as read from disk just before signing: the function signs Content-Length,
 * and R2 refuses any upload whose length differs (403 SignatureDoesNotMatch).
 */
export function buildMediaSignBody(
  photoId: string,
  op: MediaSignOp,
  put?: { contentType: string; bytes: number },
): MediaSignBody {
  if (op !== 'put') {
    return { photo_id: photoId, op };
  }
  if (!put || !Number.isInteger(put.bytes) || put.bytes <= 0) {
    throw new Error('media-sign: put braucht Dateityp und eine echte Dateigröße');
  }
  return { photo_id: photoId, op: 'put', content_type: put.contentType.toLowerCase(), bytes: put.bytes };
}

/**
 * Turns the function's answer into a signed request, or throws
 * `MediaSignError` with the function's own code. A 200 without a usable URL
 * counts as an error too — never hand an incomplete answer to an upload.
 */
export function parseMediaSignResponse(status: number, json: unknown): SignedObjectRequest {
  const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  if (status !== 200) {
    const code = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? 'gateway' : 'unknown';
    throw new MediaSignError(status, code);
  }
  const method = body.method;
  if (
    typeof body.url !== 'string' ||
    !body.url.startsWith('https://') ||
    (method !== 'GET' && method !== 'PUT' && method !== 'DELETE')
  ) {
    throw new MediaSignError(status, 'malformed_response');
  }
  const headers: Record<string, string> = {};
  if (body.headers && typeof body.headers === 'object') {
    for (const [name, value] of Object.entries(body.headers as Record<string, unknown>)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
    }
  }
  return {
    url: body.url,
    method,
    headers,
    expiresAt: typeof body.expires_at === 'string' ? body.expires_at : '',
  };
}

/**
 * A PUT signature from `media-sign` binds content-type AND content-length.
 * Checked before every upload: if the answer does not carry exactly the
 * length of the file we are about to send, R2 would refuse it anyway — and a
 * mismatch here means something upstream is wrong, so fail loudly instead.
 */
export function assertPutHeadersMatch(
  signed: Pick<SignedObjectRequest, 'method' | 'headers'>,
  bytes: number,
  contentType: string,
): void {
  if (signed.method !== 'PUT') {
    throw new Error('media-sign: Antwort ist keine Upload-Adresse');
  }
  if (signed.headers['content-length'] !== String(bytes)) {
    throw new Error(
      `media-sign: signierte Länge ${signed.headers['content-length'] ?? 'fehlt'} passt nicht zur Datei (${bytes} Bytes)`,
    );
  }
  if ((signed.headers['content-type'] ?? '').toLowerCase() !== contentType.toLowerCase()) {
    throw new Error('media-sign: signierter Dateityp passt nicht zur Datei');
  }
}

/** The `<Code>` of an S3/R2 XML error body, e.g. "SignatureDoesNotMatch", "NoSuchKey". */
export function r2ErrorCode(body: string | null | undefined): string | null {
  const match = /<Code>([A-Za-z0-9]+)<\/Code>/.exec(body ?? '');
  return match ? match[1] : null;
}

/** 2xx counts as success for a signed R2 request. */
export function isR2Success(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The range header for the size check: one byte, so nothing but headers is really transferred. */
export const SIZE_PROBE_RANGE = 'bytes=0-0';

/**
 * Stored object size from a ranged GET (`Range: bytes=0-0`) on a signed GET
 * URL — WHY NOT HEAD: a presigned URL is signed for ONE method, and HEAD with
 * a GET signature is refused (the method is part of the signature). The
 * function hands out get/put/delete only, so the size is read from the range
 * answer instead, which R2 gives as `Content-Range: bytes 0-0/<total>`.
 *
 * - 206 → total from Content-Range.
 * - 200 (server ignored the range) → Content-Length is the whole object.
 * - 404 → null: the object is not there (yet).
 * - anything else → throws `R2RequestError` (with R2's `<Code>` if any), so a
 *   403 SignatureDoesNotMatch is never mistaken for "not there".
 */
export function storedSizeFromRangeProbe(
  status: number,
  headers: { contentRange: string | null; contentLength: string | null },
  body?: string | null,
): number | null {
  if (status === 206) {
    const match = /\/(\d+)\s*$/.exec(headers.contentRange ?? '');
    if (!match) throw new R2RequestError('size-check', status, 'no_content_range');
    return Number(match[1]);
  }
  if (status === 200) {
    const length = Number(headers.contentLength);
    if (!headers.contentLength || !Number.isFinite(length)) throw new R2RequestError('size-check', status, 'no_content_length');
    return length;
  }
  if (status === 404) {
    return null;
  }
  throw new R2RequestError('size-check', status, r2ErrorCode(body));
}
