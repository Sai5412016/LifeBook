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
import { File, UploadType } from 'expo-file-system';
import * as Network from 'expo-network';

import { ENV } from '@/core/env';
import { supabase } from '@/core/supabase';

import { createThumbnail, deleteQuietly } from './media';
import { loadPendingUploads, markOriginalUploaded, markThumbUploaded } from './repository';

export const PHOTOS_BUCKET = 'photos';

/** How long a display URL stays valid. Long enough to scroll, short enough to leak little. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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

/** Stream one local file into the bucket, overwriting any previous attempt. */
async function putObject(localUri: string, key: string, mime: string): Promise<void> {
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
      'cache-control': `max-age=${SIGNED_URL_TTL_SECONDS}`,
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
          await putObject(thumbUri, photo.thumb_key, 'image/jpeg');
          await markThumbUploaded(db, photo.id);
          result.thumbnails += 1;
        } finally {
          deleteQuietly(thumbUri);
        }
      }

      if (!photo.original_uploaded_at && photo.original_key) {
        if (!allowOriginals) {
          result.deferred += 1;
          continue;
        }
        await putObject(photo.local_uri, photo.original_key, photo.mime ?? 'image/jpeg');
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

/** Remove both objects of a photo. Best-effort — a leftover object is cleaned up later. */
export async function removeStoredObjects(
  thumbKey: string | null,
  originalKey: string | null,
): Promise<void> {
  const keys = [thumbKey, originalKey].filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(keys);
  if (error) {
    console.error('[LifeBook] Fotodateien konnten nicht gelöscht werden', error.message);
  }
}
