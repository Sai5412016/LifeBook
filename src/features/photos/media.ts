/**
 * photos/media — everything that touches the device: picking, hashing, EXIF and
 * thumbnailing. Kept apart from ./identity so that module stays unit-testable.
 *
 * WHY THE SYSTEM PICKER AND NOT FULL GALLERY ACCESS
 * -------------------------------------------------
 * expo-image-picker opens the OS photo picker. On Android 13+ that runs in a
 * separate system process and hands back only the chosen files, so the app never
 * requests READ_MEDIA_IMAGES and the user never sees a "allow access to all your
 * photos?" dialog. Less permission, less scare, less to justify under GDPR —
 * data minimisation by construction rather than by promise.
 *
 * The trade-off is that we cannot auto-scan for new photos. A later step can add
 * expo-media-library (already configured in app.json) behind an explicit opt-in.
 */

import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { exifWallClockToUtcIso } from '@/core/time';

import { HASH_SAMPLE_BYTES, composeContentHash } from './identity';
import type { PhotoCandidate } from './types';

/** Longest edge of the generated preview, in pixels. */
const THUMB_MAX_EDGE = 640;
/** JPEG quality of the preview. 0.6 lands around 30–50 KB at 640 px. */
const THUMB_QUALITY = 0.6;

/** Raised when the user closed the picker without choosing anything. */
export class PickCancelledError extends Error {
  constructor() {
    super('picker cancelled');
    this.name = 'PickCancelledError';
  }
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * SHA-256 over the first megabyte of the file, combined with its exact size.
 *
 * Reads through a file handle rather than loading the whole image: a 12 MP HEIC
 * is ~8 MB, and pulling a dozen of those into JS memory at once is how an import
 * of 200 photos turns into an out-of-memory crash on a mid-range phone.
 */
export async function computeContentHash(uri: string): Promise<{ hash: string; bytes: number }> {
  const file = new File(uri);
  const handle = file.open();

  try {
    const bytes = handle.size ?? 0;
    const sample = handle.readBytes(Math.min(HASH_SAMPLE_BYTES, Math.max(bytes, 1)));
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, sample);
    return { hash: composeContentHash(toHex(digest), bytes), bytes };
  } finally {
    handle.close();
  }
}

/**
 * Pull the capture timestamp out of an EXIF block, preferring the tag the camera
 * wrote at the moment of the shot over later ones added by editing software.
 * Actual parsing lives in core/time — this module must not construct instants.
 */
export function exifCapturedAt(
  exif: Record<string, unknown> | null | undefined,
  tz: string,
): string | null {
  const raw =
    (exif?.DateTimeOriginal as string | undefined) ??
    (exif?.DateTimeDigitized as string | undefined) ??
    (exif?.DateTime as string | undefined);

  return exifWallClockToUtcIso(raw, tz);
}

/**
 * Open the system picker and return the chosen images with metadata already
 * extracted. Throws PickCancelledError when the user backs out.
 *
 * `exif: true` is what gives us the real capture date — without it the only date
 * available is "when the file landed in the cache", which would put every
 * imported photo on today's date and destroy the chronology.
 */
export async function pickPhotos(tz: string): Promise<PhotoCandidate[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    exif: true,
    // No re-encoding: quality/allowsEditing would rewrite the file and cost us
    // both image quality and the original EXIF.
    quality: 1,
  });

  if (result.canceled) {
    throw new PickCancelledError();
  }

  const candidates: PhotoCandidate[] = [];

  for (const asset of result.assets) {
    const { hash, bytes } = await computeContentHash(asset.uri);

    candidates.push({
      localUri: asset.uri,
      assetId: asset.assetId ?? null,
      fileName: asset.fileName ?? null,
      mime: asset.mimeType ?? 'image/jpeg',
      width: asset.width,
      height: asset.height,
      bytes: asset.fileSize ?? bytes,
      capturedAtUtcIso: exifCapturedAt(asset.exif, tz),
      contentHash: hash,
      // Location stays out of the database unless the user opts in; the original
      // file itself is stored untouched, GPS tags included (see repository docs).
      gps: null,
    });
  }

  return candidates;
}

/**
 * Render a small JPEG preview into the cache directory and return its path.
 * The caller uploads it and may then delete it — it is a cache artefact, not
 * something the user's device needs to keep.
 */
export async function createThumbnail(sourceUri: string): Promise<string> {
  const context = ImageManipulator.manipulate(sourceUri);
  const rendered = await context.resize({ width: THUMB_MAX_EDGE }).renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: THUMB_QUALITY,
  });
  return saved.uri;
}

/**
 * Directory holding photos that are picked but not yet safely in the cloud.
 *
 * WHY THIS EXISTS
 * ---------------
 * The system picker hands back a copy in the OS CACHE directory, which Android
 * may delete at any moment when storage runs low. If the upload had not finished
 * yet, that photo would be gone — we would hold a database row pointing at
 * nothing, with the picture existing only in the user's gallery and no way for
 * us to know which one it was. So every picked file is staged into the app's
 * document directory (which the OS does not purge) and deleted again the moment
 * its original is confirmed uploaded. Net device storage cost afterwards: zero.
 *
 * Built lazily, on first use, rather than as a module-level `const`: `new
 * Directory(...)` and `Paths.document` call into native code, and ANY native
 * call at module scope runs the instant something imports this file — before
 * the root layout has had a chance to catch and display a failure. A crash
 * there is invisible on a release build (no red screen, no log), which is
 * exactly the failure mode this file must not risk.
 */
let stagingDirectory: Directory | null = null;

function getStagingDirectory(): Directory {
  if (!stagingDirectory) {
    stagingDirectory = new Directory(Paths.document, 'photos-pending');
  }
  return stagingDirectory;
}

/**
 * Copy a picked file into persistent staging and return the new URI.
 * Named by photo id, so a retried import cannot collide with itself.
 */
export async function stagePickedPhoto(
  sourceUri: string,
  photoId: string,
  extension: string,
): Promise<string> {
  const directory = getStagingDirectory();
  if (!directory.info().exists) {
    directory.create({ intermediates: true });
  }

  const destination = new File(directory, `${photoId}.${extension}`);
  if (destination.info().exists) {
    destination.delete();
  }

  await new File(sourceUri).copy(destination);
  return destination.uri;
}

/** Best-effort cleanup of a cache artefact. Never throws. */
export function deleteQuietly(uri: string | null | undefined): void {
  if (!uri) {
    return;
  }
  try {
    const file = new File(uri);
    if (file.info().exists) {
      file.delete();
    }
  } catch {
    // A leftover file in the OS cache directory is harmless — the system
    // reclaims it. Never let cleanup failure break an import.
  }
}

/**
 * Cache directory this feature writes into. Exposed for diagnostics.
 * A function, not a `const`, for the same reason as `getStagingDirectory`
 * above — `Paths.cache` must not resolve at module scope.
 */
export const photoCacheDirectory = (): string => Paths.cache.uri;
