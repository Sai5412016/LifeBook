/**
 * photos/storage — moves the actual bytes between the device and the private
 * `photos` bucket, and hands out short-lived URLs for displaying them.
 *
 * WHY NOT THE supabase-js STORAGE CLIENT FOR UPLOADS
 * --------------------------------------------------
 * supabase-js wants the file contents in JS memory (ArrayBuffer / Blob). A dozen
 * 8 MB photos in flight is enough to kill a mid-range Android app. expo-file-
 * system streams the file from disk into the request natively, so memory stays
 * flat regardless of file size. The endpoint is Supabase's ordinary Storage REST
 * API and the row-level access rules apply exactly the same — we just skip the
 * client library for this one call. Downloads and signed URLs still go through
 * supabase-js, where payloads are small.
 */

import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as Network from 'expo-network';

import { ENV } from '@/core/env';
import { addSecondsToUtcIso, nowUtcIso } from '@/core/time';
import { supabase } from '@/core/supabase';

import { buildMediumKey, extensionForMime, shouldResignUrl } from './identity';
import { createMediumImage, createThumbnail, deleteQuietly } from './media';
import {
  loadPendingUploads,
  markMediumUploaded,
  markOriginalUploaded,
  markThumbUploaded,
} from './repository';
import type { PhotoRow } from './types';

export const PHOTOS_BUCKET = 'photos';

/** How long a display URL stays valid. Long enough to scroll, short enough to leak little. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Cache-control for the three photo renditions (thumb/medium/original),
 * Aufgabe 1: their object key already contains the photo id, so the bytes
 * behind a given key never change — a one-year max-age costs nothing and
 * saves paying for the same transfer twice on every CDN edge that would
 * otherwise treat them as fresh-each-time. Deliberately NOT the default for
 * `uploadToPhotosBucket` in general: features/people overwrites its portrait
 * at the SAME key on every change, where a long cache-control would just
 * mean a stale photo sticking around.
 */
const IMMUTABLE_CACHE_CONTROL_SECONDS = 60 * 60 * 24 * 365;

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
 * Stream one local file into the bucket, overwriting any previous attempt.
 * Exported as the one shared uploader into the `photos` bucket — features/people
 * uploads a person's portrait through this same function rather than
 * duplicating the auth-header/retry-safe upload request.
 */
export async function uploadToPhotosBucket(
  localUri: string,
  key: string,
  mime: string,
  cacheControlSeconds: number = SIGNED_URL_TTL_SECONDS,
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

/** True when the device is on Wi-Fi. Errs on the side of "no" if unknown. */
export async function isOnWifi(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI && state.isConnected === true;
  } catch {
    return false;
  }
}

export type UploadRunResult = {
  thumbnails: number;
  mediums: number;
  originals: number;
  failed: number;
  /** Originals deliberately left for later because there is no Wi-Fi. */
  deferred: number;
};

let inFlight: Promise<UploadRunResult> | null = null;

/**
 * Push everything that still needs pushing.
 *
 * Order matters: the preview goes first and regardless of connection type. It is
 * ~40 KB, so it costs almost nothing on mobile data, and it is what makes the
 * photo appear on the other parent's phone within seconds. The multi-megabyte
 * original waits for Wi-Fi unless the caller says otherwise.
 *
 * Concurrent calls share one run — the screen, a manual retry and an app-resume
 * hook can all fire at once, and uploading the same photo twice wastes the
 * user's data plan.
 */
export function runUploadQueue(
  db: AbstractPowerSyncDatabase,
  options: { wifiOnly?: boolean } = {},
): Promise<UploadRunResult> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = executeUploadQueue(db, options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function executeUploadQueue(
  db: AbstractPowerSyncDatabase,
  options: { wifiOnly?: boolean },
): Promise<UploadRunResult> {
  const wifiOnly = options.wifiOnly ?? true;
  const allowOriginals = wifiOnly ? await isOnWifi() : true;
  const pending = await loadPendingUploads(db);

  const result: UploadRunResult = {
    thumbnails: 0,
    mediums: 0,
    originals: 0,
    failed: 0,
    deferred: 0,
  };

  for (const photo of pending) {
    if (!photo.local_uri) {
      continue;
    }

    try {
      if (!photo.thumb_uploaded_at && photo.thumb_key) {
        // Regenerated from the staged original rather than cached from import:
        // the import-time preview lives in the OS cache and may be long gone.
        const thumbUri = await createThumbnail(photo.local_uri);
        try {
          await uploadToPhotosBucket(thumbUri, photo.thumb_key, 'image/jpeg', IMMUTABLE_CACHE_CONTROL_SECONDS);
          await markThumbUploaded(db, photo.id);
          result.thumbnails += 1;
        } finally {
          deleteQuietly(thumbUri);
        }
      }

      // Between thumb and original ON PURPOSE: a failure here throws and
      // skips the original upload below for this run (same as a thumb
      // failure already did) — that keeps `local_uri` intact until the
      // medium has actually landed, so the fullscreen viewer's fallback
      // chain (identity.ts#resolveFullscreenUri) never needs to reach past
      // a local file into a medium object that doesn't exist yet.
      if (!photo.medium_uploaded_at && photo.medium_key) {
        const mediumUri = await createMediumImage(
          photo.local_uri,
          photo.width && photo.height ? { width: photo.width, height: photo.height } : null,
        );
        try {
          await uploadToPhotosBucket(mediumUri, photo.medium_key, 'image/jpeg', IMMUTABLE_CACHE_CONTROL_SECONDS);
          await markMediumUploaded(db, photo.id, photo.medium_key);
          result.mediums += 1;
        } finally {
          deleteQuietly(mediumUri);
        }
      }

      if (!photo.original_uploaded_at && photo.original_key) {
        if (!allowOriginals) {
          result.deferred += 1;
          continue;
        }
        await uploadToPhotosBucket(
          photo.local_uri,
          photo.original_key,
          photo.mime ?? 'image/jpeg',
          IMMUTABLE_CACHE_CONTROL_SECONDS,
        );
        await markOriginalUploaded(db, photo.id);
        // Only now is it safe to drop the staged copy: the bytes exist elsewhere.
        deleteQuietly(photo.local_uri);
        result.originals += 1;
      }
    } catch (error) {
      result.failed += 1;
      // Loud but non-fatal: one unreadable file must not stop the queue. The row
      // keeps its NULL timestamps and is retried on the next run.
      console.error('[LifeBook] Foto-Upload fehlgeschlagen', {
        photoId: photo.id,
        key: photo.original_key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Short-lived display URLs for a batch of object keys.
 * Returns a map keyed by object key; keys that failed are simply absent, so the
 * caller renders a placeholder instead of crashing.
 */
export async function createSignedUrls(keys: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(keys.filter((key): key is string => Boolean(key)))];

  if (unique.length === 0) {
    return urls;
  }

  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error('[LifeBook] Signierte Foto-URLs fehlgeschlagen', error.message);
    return urls;
  }

  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) {
      urls.set(entry.path, entry.signedUrl);
    }
  }

  return urls;
}

/**
 * Aufgabe 4a, 2026-08-13: signed URLs cached at MODULE scope, not per-screen
 * state. Before this, every hook instance (i.e. every screen mount) started
 * from an empty cache and re-signed everything it needed — and since
 * expo-image caches by URI, a freshly re-signed URL for the same object
 * counted as a brand new image and reloaded it from scratch. A module-level
 * `Map` survives remounts, so navigating Chronik → Vollbild → back → Vollbild
 * again re-signs nothing that hasn't actually expired.
 */
const signedUrlCache = new Map<string, { url: string; expiresAtUtcIso: string }>();

/** Safety window for `shouldResignUrl` — see its own doc comment in ./identity.ts. */
const SIGNED_URL_SAFETY_MARGIN_SECONDS = 60;

/**
 * Like `createSignedUrls`, but backed by the shared module cache above: only
 * keys that are missing or expiring within the safety margin actually reach
 * Supabase. Keys that fail to sign are simply left out of both the result
 * and the cache, so the next call retries them — same "absent, not thrown"
 * contract as `createSignedUrls`.
 */
export async function getCachedSignedUrls(keys: readonly string[]): Promise<Map<string, string>> {
  const now = nowUtcIso();
  const result = new Map<string, string>();
  const stale: string[] = [];

  for (const key of keys) {
    const cached = signedUrlCache.get(key);
    if (cached && !shouldResignUrl(cached.expiresAtUtcIso, now, SIGNED_URL_SAFETY_MARGIN_SECONDS)) {
      result.set(key, cached.url);
    } else {
      stale.push(key);
    }
  }

  if (stale.length > 0) {
    const fetched = await createSignedUrls(stale);
    const expiresAtUtcIso = addSecondsToUtcIso(now, SIGNED_URL_TTL_SECONDS);
    fetched.forEach((url, key) => {
      signedUrlCache.set(key, { url, expiresAtUtcIso });
      result.set(key, url);
    });
  }

  return result;
}

/** Remove every stored rendition of a photo. Best-effort — a leftover object is cleaned up later. */
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
    console.error('[LifeBook] Fotodateien konnten nicht gelöscht werden', error.message);
  }
}

/* ────────────────────────────── Sharing ────────────────────────────── */

/** The subset of a photo row `resolveOriginalForSharing` needs. */
export type ShareableOriginal = {
  id: string;
  local_uri: string | null;
  original_key: string | null;
  mime: string | null;
};

export type ResolvedShareFile = {
  uri: string;
  /**
   * True when `uri` was downloaded into the sharing cache and must be
   * deleted once the share sheet has been handed the file. False when `uri`
   * IS `local_uri` — the same file this device is still holding for its own
   * pending upload — which must never be deleted here; only the upload
   * queue (storage.ts#executeUploadQueue) retires that file, once the bytes
   * are confirmed safe in object storage.
   */
  isTemporary: boolean;
};

/**
 * Directory holding originals fetched only for a share operation. Separate
 * from `photos-pending` (media.ts) on purpose: those files are staged
 * uploads this device still owns; these are throwaway copies of photos this
 * device does NOT hold locally, fetched purely to hand to the OS share
 * sheet and deleted right after. Built lazily for the same reason as every
 * other native-call-holding directory in this feature — see
 * media.ts#getStagingDirectory.
 */
let shareCacheDirectory: Directory | null = null;

function getShareCacheDirectory(): Directory {
  if (!shareCacheDirectory) {
    shareCacheDirectory = new Directory(Paths.cache, 'photos-sharing');
  }
  return shareCacheDirectory;
}

/**
 * Resolve a local file path for a photo's ORIGINAL, ready to hand to the OS
 * share sheet. If the original is still staged on this device (`local_uri`
 * set — not yet uploaded, or the upload just hasn't finished), that file is
 * used directly, no network needed. Otherwise it is downloaded from object
 * storage into the sharing cache.
 *
 * `signal` lets a caller abort an in-progress download when the user cancels
 * the loading screen (see ./sharing's `formatShareProgressLabel` and the
 * screens that show it).
 */
export async function resolveOriginalForSharing(
  photo: ShareableOriginal,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedShareFile> {
  if (photo.local_uri) {
    return { uri: photo.local_uri, isTemporary: false };
  }
  if (!photo.original_key) {
    throw new Error(`photos: no original available to share for photo ${photo.id}`);
  }

  const urls = await createSignedUrls([photo.original_key]);
  const signedUrl = urls.get(photo.original_key);
  if (!signedUrl) {
    throw new Error(`photos: could not sign the original to share for photo ${photo.id}`);
  }

  const directory = getShareCacheDirectory();
  if (!directory.info().exists) {
    directory.create({ intermediates: true });
  }

  const destination = new File(directory, `${photo.id}.${extensionForMime(photo.mime)}`);
  const downloaded = await File.downloadFileAsync(signedUrl, destination, {
    idempotent: true,
    signal: options.signal,
  });

  return { uri: downloaded.uri, isTemporary: true };
}

/** Deletes only the files this share operation itself downloaded — never a staged upload. */
export function cleanupSharedFiles(files: readonly ResolvedShareFile[]): void {
  for (const file of files) {
    if (file.isTemporary) {
      deleteQuietly(file.uri);
    }
  }
}

export type ShareBatchProgress = { current: number; total: number };

export type ShareBatchResult = {
  files: ResolvedShareFile[];
  /** How many photos in the batch could not be resolved — reported to the user, never silent. */
  failedCount: number;
  /** True when `signal` was aborted before every photo was processed. */
  cancelled: boolean;
};

/**
 * Resolves every photo in `photos` to a local file, one at a time so
 * `onProgress` can drive a "Bild X von Y wird geladen …" display.
 *
 * A single photo that fails to load (network hiccup, missing original, …)
 * is skipped and counted, never lets the whole batch abort — mirrors
 * `executeUploadQueue`'s per-item try/catch above. Checked BEFORE and AFTER
 * each fetch so an abort during the slow part (the download itself) stops
 * the loop promptly instead of finishing the batch regardless.
 */
export async function prepareShareBatch(
  photos: readonly ShareableOriginal[],
  options: { signal?: AbortSignal; onProgress?: (progress: ShareBatchProgress) => void } = {},
): Promise<ShareBatchResult> {
  const files: ResolvedShareFile[] = [];
  let failedCount = 0;

  for (let index = 0; index < photos.length; index += 1) {
    if (options.signal?.aborted) {
      return { files, failedCount, cancelled: true };
    }

    options.onProgress?.({ current: index + 1, total: photos.length });

    try {
      const file = await resolveOriginalForSharing(photos[index], { signal: options.signal });
      files.push(file);
    } catch (error) {
      if (options.signal?.aborted) {
        return { files, failedCount, cancelled: true };
      }
      failedCount += 1;
      console.error('[LifeBook] Foto konnte für das Teilen nicht geladen werden', {
        photoId: photos[index].id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { files, failedCount, cancelled: false };
}

/* ────────────────────────────── Self-heal (Aufgabe 3, 2026-08-13) ────────────────────────────── */

/** At most one photo healed at a time (task requirement) — a plain module-level flag. */
let healInFlight = false;

/**
 * Generates and uploads the missing mid-size rendition for a photo that
 * predates the `medium_key` column, entirely in the background. Called from
 * the fullscreen viewer right after a photo without a medium is shown; on
 * the NEXT time that same photo is opened, `resolveFullscreenUri` finds a
 * medium and the viewer loads instantly instead of the multi-MB original.
 *
 * Every condition below is from the task, not a guess:
 * - WLAN only — reuses `isOnWifi()`, the exact same check the ordinary
 *   upload queue already gates originals on, rather than inventing a
 *   second network-type check that could drift from it.
 * - At most one photo at a time — the module-level flag above. A call that
 *   arrives while one is already running simply no-ops; swiping fast
 *   through many un-healed photos heals them one at a time, whichever one
 *   happens to be open the next time the flag is free.
 * - Fully silent and never throws: every failure is caught and logged
 *   here, not left for the caller — a flaky connection must not surface as
 *   an error state on a screen whose only job was to show a photo.
 */
export async function healMissingMedium(
  db: AbstractPowerSyncDatabase,
  photo: Pick<
    PhotoRow,
    'id' | 'household_id' | 'local_uri' | 'original_key' | 'medium_key' | 'mime' | 'width' | 'height'
  >,
): Promise<void> {
  if (photo.medium_key || !photo.original_key || healInFlight) {
    return;
  }
  if (!(await isOnWifi())) {
    return;
  }

  healInFlight = true;
  let resolved: ResolvedShareFile | null = null;
  try {
    resolved = await resolveOriginalForSharing(photo);
    const mediumUri = await createMediumImage(
      resolved.uri,
      photo.width && photo.height ? { width: photo.width, height: photo.height } : null,
    );
    try {
      const mediumKey = buildMediumKey(photo.household_id, photo.id);
      await uploadToPhotosBucket(mediumUri, mediumKey, 'image/jpeg', IMMUTABLE_CACHE_CONTROL_SECONDS);
      await markMediumUploaded(db, photo.id, mediumKey);
    } finally {
      deleteQuietly(mediumUri);
    }
  } catch (error) {
    console.error('[LifeBook] Mittlere Fassung konnte nicht nachträglich erzeugt werden', {
      photoId: photo.id,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (resolved) {
      cleanupSharedFiles([resolved]);
    }
    healInFlight = false;
  }
}
