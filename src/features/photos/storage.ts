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
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Network from 'expo-network';

import { ENV } from '@/core/env';
import { addSecondsToUtcIso, nowUtcIso } from '@/core/time';
import { supabase } from '@/core/supabase';
import { removePhotoFromAllShares } from '@/features/shares/repository';

import {
  PHOTO_BACKUP_ALBUM_NAME,
  advanceMediumBackfillRun,
  advancePhotoBackupRun,
  buildMediumKey,
  extensionForMime,
  isMediumBackfillRunComplete,
  isPhotoBackupRunComplete,
  isPhotoDueForCleanup,
  nextMediumBackfillId,
  nextPhotoBackupId,
  shouldResignUrl,
  startMediumBackfillRun,
  startPhotoBackupRun,
  type MediumBackfillRunState,
  type PhotoBackupRunState,
} from './identity';
import { createMediumImage, createThumbnail, deleteQuietly } from './media';
import {
  hardDeletePhoto,
  loadAllDeletedPhotos,
  loadPendingUploads,
  markMediumUploaded,
  markOriginalUploaded,
  markPhotoBackedUp,
  markThumbUploaded,
  type PhotoBackupCandidatePhoto,
} from './repository';
import { setTrashCleanupDiagnostics } from './trashDiagnostics';
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

/**
 * Remove every stored rendition of a photo.
 *
 * 2026-08-15: THROWS on failure now, no longer best-effort — its only
 * caller is `permanentlyDeletePhoto` below, where a storage failure MUST
 * stop the operation before the row is deleted (task requirement: an
 * orphaned object that nobody can attribute to anything any more is worse
 * than a trash entry that stays a little longer). When soft-delete alone
 * was still paired with this call, a swallowed failure was harmless — that
 * caller is gone (see repository.ts#softDeletePhoto's own doc comment).
 *
 * Idempotent by construction: Supabase Storage's `remove()` is a thin
 * wrapper over S3-style object deletion, which returns success for a key
 * that is already gone rather than erroring — removing the same photo's
 * files twice (e.g. two phones sweeping the trash at the same moment,
 * Aufgabe 3) is therefore not a failure case this function can even see.
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
  /** Actual size of the file at `uri`, in bytes — surfaced in the diagnostic message on failure (see share.ts). */
  bytes: number;
  /**
   * Always true now (2026-08-14): `uri` is a COPY in the sharing cache, made
   * from `local_uri` if the original is still staged, or downloaded if not
   * — see resolveOriginalForSharing's doc comment for why it is never
   * `local_uri` directly any more. Safe to delete once the share sheet has
   * the file; the staged upload (if any) is untouched, since we only ever
   * read from it here, never moved or referenced it directly.
   */
  isTemporary: boolean;
};

/**
 * Directory holding every file handed to the OS share sheet — copies of a
 * still-staged original AND downloads of an already-uploaded one alike.
 *
 * WHY EVERYTHING GOES THROUGH HERE NOW (Fehlersuche 2026-08-14)
 * ---------------------------------------------------------------
 * react-native-share's bundled Android FileProvider only declares the app's
 * CACHE directory as shareable with other apps (its
 * share_download_paths.xml: `<cache-path path="/" />`, no `<files-path>`
 * entry at all). A still-staged original lives under `Paths.document`
 * instead (media.ts#getStagingDirectory) — OUTSIDE every declared root.
 * Handing that path straight to `Share.open()` (the previous behaviour) made
 * `FileProvider.getUriForFile()` throw inside react-native-share's own
 * `RNSharePathUtil#compatUriFromFile` — which SWALLOWS that exception (only
 * a `System.out.println`, never rethrown, never reaching this app's JS) and
 * returns `null` instead. The share intent is then dispatched with a
 * missing attachment: the chooser opens, the app the user picks (WhatsApp)
 * receives nothing usable and does nothing, and nothing in JS ever sees an
 * error — exactly the reported symptom. Copying every file into THIS
 * directory first (already covered by the library's own default FileProvider
 * config) sidesteps the whole failure mode without touching react-native-
 * share or any native/manifest config — which would change the fingerprint.
 *
 * Separate from `photos-pending` (media.ts) on purpose: those are staged
 * uploads this device still owns; these are throwaway copies made purely to
 * hand to the OS share sheet, deleted right after. Built lazily for the
 * same reason as every other native-call-holding directory in this feature
 * — see media.ts#getStagingDirectory.
 */
let shareCacheDirectory: Directory | null = null;

function getShareCacheDirectory(): Directory {
  if (!shareCacheDirectory) {
    shareCacheDirectory = new Directory(Paths.cache, 'photos-sharing');
  }
  return shareCacheDirectory;
}

/**
 * Verifies the file actually exists and has real content before it is ever
 * handed to the share sheet — Vermutung 1 from the Fehlersuche: a failed
 * fetch must not silently hand over a missing or empty file. Throws with the
 * exact path in the message either way, so a failure here is diagnosable
 * from the error text alone.
 */
function requireResolvedShareFile(uri: string, isTemporary: boolean): ResolvedShareFile {
  const info = new File(uri).info();
  if (!info.exists) {
    throw new Error(`photos: Datei für das Teilen fehlt: ${uri}`);
  }
  const bytes = info.size ?? 0;
  if (bytes === 0) {
    throw new Error(`photos: Datei für das Teilen ist leer: ${uri}`);
  }
  return { uri, bytes, isTemporary };
}

/**
 * Resolve a local file path for a photo's ORIGINAL, ready to hand to the OS
 * share sheet — always a fresh copy inside `getShareCacheDirectory()` (see
 * its own doc comment for why). If the original is still staged on this
 * device (`local_uri` set), that file is copied with no network needed;
 * otherwise it is downloaded from object storage.
 *
 * `signal` lets a caller abort an in-progress download when the user cancels
 * the loading screen (see ./sharing's `formatShareProgressLabel` and the
 * screens that show it).
 */
export async function resolveOriginalForSharing(
  photo: ShareableOriginal,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedShareFile> {
  const directory = getShareCacheDirectory();
  if (!directory.info().exists) {
    directory.create({ intermediates: true });
  }
  const destination = new File(directory, `${photo.id}.${extensionForMime(photo.mime)}`);
  if (destination.info().exists) {
    destination.delete();
  }

  if (photo.local_uri) {
    await new File(photo.local_uri).copy(destination);
    return requireResolvedShareFile(destination.uri, true);
  }

  if (!photo.original_key) {
    throw new Error(`photos: no original available to share for photo ${photo.id}`);
  }

  const urls = await createSignedUrls([photo.original_key]);
  const signedUrl = urls.get(photo.original_key);
  if (!signedUrl) {
    throw new Error(`photos: could not sign the original to share for photo ${photo.id}`);
  }

  const downloaded = await File.downloadFileAsync(signedUrl, destination, {
    idempotent: true,
    signal: options.signal,
  });

  return requireResolvedShareFile(downloaded.uri, true);
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
 *
 * Returns which of three things happened, for callers that DO care (the
 * batch run below counts them): `'healed'` — actually produced and
 * uploaded a medium; `'skipped'` — none of the above conditions applied
 * (already had one, no original, WLAN unavailable, or another heal was
 * already in flight) — nothing was attempted, so it isn't a failure;
 * `'failed'` — an attempt was made and it threw.
 */
export async function healMissingMedium(
  db: AbstractPowerSyncDatabase,
  photo: Pick<
    PhotoRow,
    'id' | 'household_id' | 'local_uri' | 'original_key' | 'medium_key' | 'mime' | 'width' | 'height'
  >,
): Promise<'healed' | 'skipped' | 'failed'> {
  if (photo.medium_key || !photo.original_key || healInFlight) {
    return 'skipped';
  }
  if (!(await isOnWifi())) {
    return 'skipped';
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
    return 'healed';
  } catch (error) {
    console.error('[LifeBook] Mittlere Fassung konnte nicht nachträglich erzeugt werden', {
      photoId: photo.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  } finally {
    if (resolved) {
      cleanupSharedFiles([resolved]);
    }
    healInFlight = false;
  }
}

/* ────────────────────────────── Batch backfill ("Alle Fotos vorbereiten") ────────────────────────────── */

export type MediumBackfillRunResult = {
  healed: number;
  failed: number;
  /**
   * True when the run stopped before every candidate was attempted —
   * cancelled, backgrounded (cancelMediumBackfillRun), or Wi-Fi dropped
   * mid-run. Everything counted in `healed` stays healed either way; the
   * remaining candidates simply aren't in this run's queue any more, and
   * the NEXT run (medium_key IS NULL, re-queried fresh) picks them back up.
   */
  stoppedEarly: boolean;
};

let backfillAbortController: AbortController | null = null;

/** Whether a batch run is currently in progress — the "Alle Fotos vorbereiten" button reads this to refuse a second start. */
export function isMediumBackfillRunning(): boolean {
  return backfillAbortController !== null;
}

/**
 * Stops an in-progress batch run at the next item boundary — never
 * mid-photo. Safe to call even when no run is active.
 */
export function cancelMediumBackfillRun(): void {
  backfillAbortController?.abort();
}

/**
 * Runs `healMissingMedium` — the SAME function the opportunistic
 * fullscreen-viewer heal already uses, not a second implementation — over
 * every photo in `photos`, one at a time. Sequential on purpose: a hundred
 * photos at several MB each run in parallel would overrun both memory and
 * the connection.
 *
 * The actual queue/progress bookkeeping is identity.ts's
 * MediumBackfillRunState — this function is only the async loop around it,
 * deciding nothing on its own beyond "keep going until the pure state says
 * stop, or an outside condition says stop instead". Wi-Fi is rechecked
 * before every single item (same `isOnWifi()` the ordinary upload queue
 * gates on) rather than only once at the start, so losing Wi-Fi mid-run
 * ends the run cleanly instead of grinding through the rest as silent
 * no-ops. A `'skipped'` outcome from `healMissingMedium` (lock contention
 * with a concurrent opportunistic heal, most likely) is counted as
 * `failed` here for this run's bookkeeping — rare, and the photo simply
 * stays a candidate for the next run either way.
 *
 * Throws if a run is already active — the caller (the button) is expected
 * to prevent this in the first place; this is the second line of defence.
 */
export async function runMediumBackfill(
  db: AbstractPowerSyncDatabase,
  photos: readonly Pick<
    PhotoRow,
    'id' | 'household_id' | 'local_uri' | 'original_key' | 'medium_key' | 'mime' | 'width' | 'height'
  >[],
  onProgress?: (state: MediumBackfillRunState) => void,
): Promise<MediumBackfillRunResult> {
  if (backfillAbortController) {
    throw new Error('photos: Sammellauf zum Vorbereiten läuft bereits');
  }

  const controller = new AbortController();
  backfillAbortController = controller;
  const byId = new Map(photos.map((photo) => [photo.id, photo]));

  let state = startMediumBackfillRun(photos.map((photo) => photo.id));
  onProgress?.(state);

  try {
    while (!isMediumBackfillRunComplete(state)) {
      if (controller.signal.aborted || !(await isOnWifi())) {
        return { healed: state.succeeded, failed: state.failed, stoppedEarly: true };
      }

      const id = nextMediumBackfillId(state);
      const photo = id ? byId.get(id) : undefined;
      const outcome = photo ? await healMissingMedium(db, photo) : 'failed';
      state = advanceMediumBackfillRun(state, outcome === 'healed' ? 'healed' : 'failed');
      onProgress?.(state);
    }
    return { healed: state.succeeded, failed: state.failed, stoppedEarly: false };
  } finally {
    backfillAbortController = null;
  }
}

/* ────────────────────────────── Papierkorb (Aufgabe 2/3, 2026-08-15) ────────────────────────────── */

/** Every field a permanent delete needs for one photo. */
export type PermanentlyDeletablePhoto = Pick<
  PhotoRow,
  'id' | 'thumb_key' | 'medium_key' | 'original_key' | 'local_uri'
>;

/**
 * Removes one photo for good: task's exact order, and the reasoning for
 * it —
 *
 * 1. Storage files (thumb/medium/original) — `removeStoredObjects` now
 *    THROWS on failure (see its own doc comment), so a storage error
 *    aborts right here, before anything else happens: the row below is
 *    NOT deleted, and this photo simply stays in the trash to be retried
 *    later (by the user, or by the next automatic sweep). Skipping this
 *    and deleting the row anyway would leave an object in storage that no
 *    row, on either phone, could ever point back to again.
 * 2. The locally staged copy, if this device still has one — best-effort
 *    (`deleteQuietly` never throws), same as every other cache cleanup in
 *    this feature; a leftover in the OS-managed staging directory is
 *    reclaimed eventually and is not worth aborting a delete over.
 * 3. The row itself, hard — only reachable once step 1 succeeded.
 * 4. Any `share_photos` entries referencing this photo, in whichever
 *    share(s) it was part of — this is a separate Supabase table with no
 *    foreign key back to `photos` (it isn't PowerSync-synced at all, see
 *    features/shares/repository.ts's own doc comment), so nothing removes
 *    these rows automatically once the photo is gone.
 */
export async function permanentlyDeletePhoto(
  db: AbstractPowerSyncDatabase,
  photo: PermanentlyDeletablePhoto,
): Promise<void> {
  await removeStoredObjects(photo.thumb_key, photo.medium_key, photo.original_key);
  deleteQuietly(photo.local_uri);
  await hardDeletePhoto(db, photo.id);
  await removePhotoFromAllShares(photo.id);
}

export type TrashSweepResult = { removed: number; failed: number };

/**
 * Runs `permanentlyDeletePhoto` over `photos`, one at a time — sequential,
 * never parallel (task requirement for Aufgabe 3; also just correct for
 * Aufgabe 2's "Papierkorb leeren", which reuses this same loop). A single
 * photo's failure is caught, logged and counted, never stops the rest —
 * mirrors every other batch loop in this module (see `executeUploadQueue`,
 * `runMediumBackfill`).
 */
async function deletePhotosPermanently(
  db: AbstractPowerSyncDatabase,
  photos: readonly PermanentlyDeletablePhoto[],
): Promise<TrashSweepResult> {
  let removed = 0;
  let failed = 0;

  for (const photo of photos) {
    try {
      await permanentlyDeletePhoto(db, photo);
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error('[LifeBook] Foto konnte nicht endgültig gelöscht werden', {
        photoId: photo.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { removed, failed };
}

/**
 * The trash screen's "Papierkorb leeren" — permanently deletes EVERY photo
 * currently in `photos` (the screen's own already-loaded trash list),
 * regardless of how long it has been there. Distinct from the automatic
 * sweep below only in that it skips the `isPhotoDueForCleanup` filter —
 * the user asked for all of it, now.
 */
export async function emptyTrash(
  db: AbstractPowerSyncDatabase,
  photos: readonly PermanentlyDeletablePhoto[],
): Promise<TrashSweepResult> {
  return deletePhotosPermanently(db, photos);
}

/**
 * The automatic 30-day sweep's actual work: load every soft-deleted photo
 * in the local database, keep only the ones `isPhotoDueForCleanup` says
 * are actually overdue, and permanently delete those — sequentially, same
 * as `emptyTrash`. Photos not yet due are left untouched and simply
 * re-evaluated the next time this runs.
 */
export async function runTrashCleanupSweep(db: AbstractPowerSyncDatabase): Promise<TrashSweepResult> {
  const now = nowUtcIso();
  const deletedPhotos = await loadAllDeletedPhotos(db);
  const due = deletedPhotos.filter((photo) => isPhotoDueForCleanup(photo.deleted_at, now));
  return deletePhotosPermanently(db, due);
}

/**
 * The startup entry point (Aufgabe 3) — called once per signed-in app
 * start from src/app/_layout.tsx#TrashCleanupEffect, the same pattern as
 * PushRegistrationEffect (CLAUDE.md Architekturregel 8). NEVER throws and
 * NEVER blocks the start: every outcome is recorded in ./trashDiagnostics
 * instead, which Einstellungen reads — including the case where the sweep
 * couldn't even start (e.g. the initial query itself failed), which is
 * exactly the kind of failure a bare `console.error` would otherwise make
 * invisible (see trashDiagnostics.ts's own doc comment).
 */
export async function runStartupTrashCleanup(db: AbstractPowerSyncDatabase): Promise<void> {
  setTrashCleanupDiagnostics({ runStatus: 'running' });
  try {
    const result = await runTrashCleanupSweep(db);
    setTrashCleanupDiagnostics({
      runStatus: 'done',
      removed: result.removed,
      failed: result.failed,
      lastError: null,
      lastRunAtUtcIso: nowUtcIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LifeBook] Automatisches Papierkorb-Aufräumen fehlgeschlagen', error);
    setTrashCleanupDiagnostics({ runStatus: 'failed', lastError: message, lastRunAtUtcIso: nowUtcIso() });
  }
}

/* ────────────────────────────── "Alle Fotos sichern" (Original-Backup aufs Gerät, 2026-08-16) ────────────────────────────── */

let backupAbortController: AbortController | null = null;

/** Whether a backup run is currently in progress — the "Alle Fotos sichern" button reads this to refuse a second start. */
export function isPhotoBackupRunning(): boolean {
  return backupAbortController !== null;
}

/** Stops an in-progress backup run at the next item boundary — never mid-photo. Safe to call even when no run is active. */
export function cancelPhotoBackupRun(): void {
  backupAbortController?.abort();
}

/**
 * Copies one photo's original into the device's own gallery album
 * (identity.ts#PHOTO_BACKUP_ALBUM_NAME) — creating the album on the first
 * photo, adding to it after that. `copy: false` on both calls:
 * `createAssetAsync` already places the file in the library's default
 * location, so adding it to the album with a COPY (the API's own default)
 * would leave two entries for the same picture (see
 * createAlbumAsync/addAssetsToAlbumAsync's own docs) — moving instead
 * keeps exactly one.
 */
async function saveOriginalToDeviceAlbum(localUri: string): Promise<void> {
  const asset = await MediaLibrary.createAssetAsync(localUri);
  const existingAlbum = await MediaLibrary.getAlbumAsync(PHOTO_BACKUP_ALBUM_NAME);
  if (existingAlbum) {
    await MediaLibrary.addAssetsToAlbumAsync([asset], existingAlbum, false);
  } else {
    await MediaLibrary.createAlbumAsync(PHOTO_BACKUP_ALBUM_NAME, asset, false);
  }
}

/**
 * Resolves ONE photo's original — local copy if still staged, otherwise
 * downloaded — via `resolveOriginalForSharing`, the SAME resolution the OS
 * share sheet already uses (task requirement: reuse it rather than a
 * second download path; it already prefers `local_uri` over a fresh
 * download, exactly what "Fotos, deren Original noch lokal vorliegt,
 * direkt von dort speichern" asked for) — then saves it into the device
 * album, then cleans up the temporary file either way.
 */
async function backUpOnePhoto(photo: PhotoBackupCandidatePhoto): Promise<void> {
  const resolved = await resolveOriginalForSharing(photo);
  try {
    await saveOriginalToDeviceAlbum(resolved.uri);
  } finally {
    cleanupSharedFiles([resolved]);
  }
}

export type PhotoBackupRunResult = {
  saved: number;
  failed: number;
  stoppedEarly: boolean;
};

/**
 * Runs the "Alle Fotos sichern" batch: one photo at a time (task
 * requirement — sequential, never parallel), WLAN-gated (`isOnWifi()`,
 * the SAME check the ordinary upload queue and the medium backfill
 * already gate on, rechecked before every item so losing WLAN mid-run
 * ends the run cleanly instead of grinding through the rest as silent
 * failures), cancellable between items, and never letting one bad photo
 * stop the rest — mirrors `runMediumBackfill` closely, both being thin
 * async loops around the SAME shared `SequentialRunState` engine
 * (identity.ts) rather than two separate implementations of the same
 * Ablaufsteuerung.
 *
 * The write-to-gallery permission is requested HERE, the very first thing
 * once a run actually begins — never at app start (task requirement).
 *
 * Throws if a run is already active — the caller (the button) is expected
 * to prevent this in the first place; this is the second line of defence,
 * same convention as `runMediumBackfill`.
 */
export async function runPhotoBackup(
  db: AbstractPowerSyncDatabase,
  photos: readonly PhotoBackupCandidatePhoto[],
  onProgress?: (state: PhotoBackupRunState) => void,
): Promise<PhotoBackupRunResult> {
  if (backupAbortController) {
    throw new Error('photos: Sammellauf zum Sichern läuft bereits');
  }

  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error('photos: Berechtigung für die Fotogalerie wurde nicht erteilt');
  }

  const controller = new AbortController();
  backupAbortController = controller;
  const byId = new Map(photos.map((photo) => [photo.id, photo]));

  let state = startPhotoBackupRun(photos.map((photo) => photo.id));
  onProgress?.(state);

  try {
    while (!isPhotoBackupRunComplete(state)) {
      if (controller.signal.aborted || !(await isOnWifi())) {
        return { saved: state.succeeded, failed: state.failed, stoppedEarly: true };
      }

      const id = nextPhotoBackupId(state);
      const photo = id ? byId.get(id) : undefined;
      let outcome: 'saved' | 'failed' = 'failed';
      if (photo) {
        try {
          await backUpOnePhoto(photo);
          await markPhotoBackedUp(db, photo.id);
          outcome = 'saved';
        } catch (error) {
          console.error('[LifeBook] Foto konnte nicht gesichert werden', {
            photoId: photo.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      state = advancePhotoBackupRun(state, outcome);
      onProgress?.(state);
    }
    return { saved: state.succeeded, failed: state.failed, stoppedEarly: false };
  } finally {
    backupAbortController = null;
  }
}
