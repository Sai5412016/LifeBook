/**
 * photos/original-store — every decision about WHERE a photo's original lives
 * and how it gets there (PR 2 of the R2 move, 2026-11-26). Pure: no Expo,
 * React Native or Supabase import; ./storage.ts injects the real network and
 * database calls, so every branch is tested in original-store.test.ts.
 *
 * Two stores:
 *  - 'supabase' — bucket `photos`, every original up to PR 2 (499/499 on
 *    26.11.2026). Postgres default, and what a NULL means locally.
 *  - 'r2'       — Cloudflare bucket `lifebook-originals`, reached only through
 *    URLs signed by the Edge Function `media-sign`.
 *
 * The rule that keeps both phones consistent: `original_store` switches to
 * 'r2' in the SAME local UPDATE that sets `original_uploaded_at`, and only
 * after R2 has confirmed the exact byte size. Before that the row stays as
 * it is (NULL locally, 'supabase' on the server), so no reader is ever sent
 * to R2 for an object that is not there.
 */

import { assertPutHeadersMatch } from '@/core/storage/media-sign-protocol';

import { storedSizeMatches } from './upload-retry';

export type OriginalStore = 'supabase' | 'r2';

/**
 * The row's store. NULL is 'supabase': a row inserted on this phone reads
 * NULL until the server copy syncs back (core/db/schema.ts), and the
 * migration's trigger turns an inserted NULL into 'supabase'.
 */
export function originalStoreOf(row: { original_store?: string | null }): OriginalStore {
  return row.original_store === 'r2' ? 'r2' : 'supabase';
}

/* ───────────── Reading an original (share "Original senden", backup, medium self-heal) ───────────── */

export type OriginalReadSource = 'local' | 'r2' | 'supabase' | 'none';

/**
 * Where to read a photo's original from. The staged copy on this phone wins
 * (no network); otherwise the row's own store decides. A row without an
 * `original_key` has nothing to read — media-sign builds the R2 key from the
 * row's mime type, but an `original_key` of NULL means no original was ever
 * planned for it, in either store.
 */
export function originalReadSource(photo: {
  local_uri: string | null;
  original_key: string | null;
  original_store?: string | null;
}): OriginalReadSource {
  if (photo.local_uri) return 'local';
  if (!photo.original_key) return 'none';
  return originalStoreOf(photo);
}

/* ───────────── Uploading a NEW original ───────────── */

/** The fields of a pending photo the original upload needs. */
export type OriginalUploadPhoto = {
  id: string;
  local_uri: string;
  original_key: string;
  mime: string | null;
};

/** One signed R2 request, as the media-sign client returns it. */
export type SignedRequest = {
  url: string;
  method: 'GET' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
};

export type OriginalUploadDeps = {
  /** Size of the local file in bytes, read from disk now; null if unreadable. */
  localSize: (uri: string) => number | null;
  // Supabase path (switch off) — what the queue did before PR 2.
  uploadToSupabase: (uri: string, key: string, mime: string) => Promise<void>;
  supabaseStoredSize: (key: string) => Promise<number | null>;
  // R2 path (switch on).
  signPut: (photoId: string, contentType: string, bytes: number) => Promise<SignedRequest>;
  /** Throws on any non-2xx (403 SignatureDoesNotMatch, 5xx) and on network errors. */
  putFile: (uri: string, signed: SignedRequest) => Promise<void>;
  signGet: (photoId: string) => Promise<SignedRequest>;
  /** Stored size behind a signed GET URL; null = not there. Throws on refusals. */
  probeSize: (signedGet: SignedRequest) => Promise<number | null>;
  /**
   * ONE local UPDATE: original_uploaded_at (+ the staged-copy bookkeeping)
   * AND, for 'r2', original_store = 'r2'. Called only after the size check.
   */
  markUploaded: (photoId: string, store: OriginalStore) => Promise<void>;
};

/** Raised when the stored object does not have exactly the local size. */
export class OriginalNotConfirmedError extends Error {
  constructor(
    readonly store: OriginalStore,
    readonly localBytes: number | null,
    readonly storedBytes: number | null,
  ) {
    super(
      `Original nicht bestätigt (${store}: lokal ${localBytes ?? '?'} Bytes, Server ${storedBytes ?? 'nicht gefunden'})`,
    );
    this.name = 'OriginalNotConfirmedError';
  }
}

/** Default type when a row has none — same fallback the queue used before PR 2. */
export function uploadContentType(mime: string | null): string {
  return (mime ?? 'image/jpeg').toLowerCase();
}

/**
 * Uploads ONE pending original and returns the store it landed in.
 *
 * Throws on every failure — the caller (storage.ts#executeUploadQueue) feeds
 * that into the existing retry record, and because `markUploaded` is never
 * reached, `original_uploaded_at` stays NULL, `original_store` stays
 * untouched, and the staged copy in photos-pending is kept.
 *
 * R2 order (task 2026-11-26):
 *  1. size read from the file itself, now (not the row's `bytes`);
 *  2. media-sign put with that size — the signature binds it;
 *  3. the answer must carry exactly that length and type;
 *  4. PUT with exactly those headers;
 *  5. media-sign get + one-byte ranged GET → stored size;
 *  6. only if stored == local: markUploaded(…, 'r2').
 */
export async function uploadOriginal(
  photo: OriginalUploadPhoto,
  toR2: boolean,
  deps: OriginalUploadDeps,
): Promise<OriginalStore> {
  const contentType = uploadContentType(photo.mime);

  if (!toR2) {
    await deps.uploadToSupabase(photo.local_uri, photo.original_key, contentType);
    // 2026-11-11: confirmed on the server BEFORE it counts as uploaded — the
    // staged file may be the only copy left.
    const localBytes = deps.localSize(photo.local_uri);
    const storedBytes = await deps.supabaseStoredSize(photo.original_key);
    if (!storedSizeMatches(localBytes, storedBytes)) {
      throw new OriginalNotConfirmedError('supabase', localBytes, storedBytes);
    }
    await deps.markUploaded(photo.id, 'supabase');
    return 'supabase';
  }

  const bytes = deps.localSize(photo.local_uri);
  if (bytes === null || bytes <= 0) {
    throw new Error('Original: Dateigröße nicht lesbar');
  }
  const signedPut = await deps.signPut(photo.id, contentType, bytes);
  assertPutHeadersMatch(signedPut, bytes, contentType);
  await deps.putFile(photo.local_uri, signedPut);

  const signedGet = await deps.signGet(photo.id);
  const storedBytes = await deps.probeSize(signedGet);
  if (!storedSizeMatches(bytes, storedBytes)) {
    throw new OriginalNotConfirmedError('r2', bytes, storedBytes);
  }
  await deps.markUploaded(photo.id, 'r2');
  return 'r2';
}

/* ───────────── Sharing: the medium by default ───────────── */

export type ShareVariant = 'medium' | 'original';

export type MediumShareSource =
  /** Staged original on this phone → render a fresh medium from it (no network). */
  | 'render_from_local'
  /** Medium is on the server → download it. */
  | 'download_medium'
  /** Legacy photo without a medium → read the original (either store) and render one. */
  | 'render_from_original'
  | 'none';

/** Where the 1600-px medium for sharing comes from. */
export function mediumShareSource(photo: {
  local_uri: string | null;
  medium_key: string | null;
  medium_uploaded_at: string | null;
  original_key: string | null;
}): MediumShareSource {
  if (photo.local_uri) return 'render_from_local';
  if (photo.medium_key && photo.medium_uploaded_at) return 'download_medium';
  if (photo.original_key) return 'render_from_original';
  return 'none';
}

/* ───────────── Fullscreen viewer: sign only what may actually be shown ───────────── */

/**
 * The storage keys the fullscreen viewer (and the start screen's hero image)
 * must sign for one photo. Before PR 2 this was always medium AND original
 * (foto/[id].tsx), although the original is only ever DISPLAYED for a legacy
 * photo without a medium (identity.ts#resolveFullscreenUri). Now:
 *  - staged locally → nothing (the local file is shown);
 *  - medium planned → only the medium;
 *  - no medium at all → the original, but only from Supabase: an R2 original
 *    cannot be signed by Supabase Storage, and every R2 photo has a medium
 *    (the queue uploads the medium before the original).
 */
export function fullscreenKeysToSign(photo: {
  local_uri: string | null;
  medium_key: string | null;
  original_key: string | null;
  original_store?: string | null;
}): string[] {
  if (photo.local_uri) return [];
  if (photo.medium_key) return [photo.medium_key];
  if (photo.original_key && originalStoreOf(photo) === 'supabase') return [photo.original_key];
  return [];
}

/* ───────────── Permanent delete: the R2 copy ───────────── */

/**
 * Whether a permanent delete also has to remove an R2 object. Supabase
 * objects (thumb, medium, and an original that may still sit there after
 * PR 3's copy) are removed as before either way — removing a missing key is
 * a no-op there.
 */
export function needsR2Delete(photo: { original_key: string | null; original_store?: string | null }): boolean {
  return !!photo.original_key && originalStoreOf(photo) === 'r2';
}
