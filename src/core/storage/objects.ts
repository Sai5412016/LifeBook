/**
 * core/storage/objects — low-level upload/remove against the private
 * `photos` bucket. Lives in `core/`, not `features/photos/`, for exactly
 * one reason: BOTH `features/photos/storage.ts` and the "Stammbaum"/
 * "Menschen" portrait code (features/tree/*, and indirectly
 * features/people/*) need it, while `features/photos/storage.ts` itself
 * depends on `features/tree/repository.ts` (removePhotoFromAllRelatives).
 * Before 2026-08-25 the tree feature imported `removeStoredObjects`
 * straight from `features/photos/storage.ts`, which made that a genuine
 * IMPORT CYCLE: repository.ts → storage.ts → repository.ts. Metro bundles
 * ESM for a release build, not CommonJS — unlike a dev/Metro-server
 * session, a cycle there is not guaranteed to resolve in an order where
 * every binding is already assigned by the time it's read, so a release
 * build could hand back `undefined` for an import that worked fine in
 * every debug run. "Only ever call the other side's export from inside a
 * function body, never at module-evaluation time" was this project's
 * first attempt at making that safe — rejected on further thought: it
 * relies on every future edit to either module (including one written a
 * year from now, by someone who never read this comment) keeping that
 * invariant, for code that DELETES FILES. A layering rule enforced by
 * directory structure — nothing in `core/` may import from `features/`,
 * full stop — is the version that cannot regress by accident.
 *
 * WHY NOT THE supabase-js STORAGE CLIENT FOR UPLOADS
 * ----------------------------------------------------
 * supabase-js wants the file contents in JS memory (ArrayBuffer / Blob). A
 * dozen 8 MB photos in flight is enough to kill a mid-range Android app.
 * expo-file-system streams the file from disk into the request natively,
 * so memory stays flat regardless of file size. The endpoint is
 * Supabase's ordinary Storage REST API and the row-level access rules
 * apply exactly the same — we just skip the client library for this one
 * call.
 */

import { File, UploadType } from 'expo-file-system';

import { ENV } from '@/core/env';
import { supabase } from '@/core/supabase';

export const PHOTOS_BUCKET = 'photos';

/** Default cache-control for an upload that doesn't specify its own — one hour, matching the signed-URL lifetime elsewhere in this feature (not imported from there, to keep this module free of any features/ dependency). */
const DEFAULT_CACHE_CONTROL_SECONDS = 60 * 60;

export class StorageUploadError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`storage upload failed with HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'StorageUploadError';
  }
}

/**
 * Build the REST URL for an object key. Each path SEGMENT is encoded separately
 * so the slashes that separate household / photo / filename survive — encoding
 * the whole key would turn them into %2F and break the folder layout the access
 * rules match on.
 */
const objectUrl = (key: string): string =>
  `${ENV.SUPABASE_URL}/storage/v1/object/${PHOTOS_BUCKET}/` +
  key.split('/').map(encodeURIComponent).join('/');

async function requireAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('photos: not signed in — cannot upload');
  }
  return token;
}

/**
 * Stream one local file into the `photos` bucket, overwriting any previous
 * attempt. The one shared uploader into this bucket — features/tree and
 * features/people upload a portrait through this same function rather
 * than duplicating the auth-header/retry-safe upload request, and
 * features/photos/storage.ts's own upload queue uses it too.
 */
export async function uploadToPhotosBucket(
  localUri: string,
  key: string,
  mime: string,
  cacheControlSeconds: number = DEFAULT_CACHE_CONTROL_SECONDS,
): Promise<void> {
  const token = await requireAccessToken();
  const file = new File(localUri);

  if (!file.info().exists) {
    throw new Error(`photos: local file vanished before upload (${key})`);
  }

  const response = await file.upload(objectUrl(key), {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: mime,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': mime,
      // Retries must not fail on "object already exists" — an upload that timed
      // out client-side may well have landed server-side.
      'x-upsert': 'true',
      'cache-control': `max-age=${cacheControlSeconds}`,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new StorageUploadError(response.status, response.body);
  }
}

/**
 * Remove every given key from the `photos` bucket.
 *
 * THROWS on failure — its callers rely on that: features/photos/storage.ts
 * #permanentlyDeletePhoto must stop before deleting the row if the storage
 * side failed (an orphaned object nobody can attribute to anything any
 * more is worse than a trash entry that stays a little longer), and a
 * caller cleaning up a just-replaced portrait treats this as best-effort
 * itself by wrapping the call in its own try/catch — the choice belongs
 * to the caller, not this function.
 *
 * Idempotent by construction: Supabase Storage's `remove()` is a thin
 * wrapper over S3-style object deletion, which returns success for a key
 * that is already gone rather than erroring — removing the same photo's
 * files twice (e.g. two phones sweeping the trash at the same moment, or
 * two devices accepting the same guest suggestion at once) is therefore
 * not a failure case this function can even see.
 */
export async function removeStoredObjects(
  thumbKey: string | null,
  mediumKey: string | null,
  originalKey: string | null,
): Promise<void> {
  const keys = [thumbKey, mediumKey, originalKey].filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(keys);
  if (error) {
    throw new Error(`photos: Speicherobjekte konnten nicht entfernt werden: ${error.message}`);
  }
}
