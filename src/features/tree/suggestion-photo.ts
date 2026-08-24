/**
 * tree/suggestion-photo — the photo attached to a guest suggestion. Lives
 * in the private `suggestions` bucket (already created outside this
 * session, see CLAUDE.md Fallstrick 15 for the whole path from a guest's
 * phone into this bucket and why). This app never WRITES into that
 * bucket — a guest's browser uploads directly via the `album` Edge
 * Function's signed upload URLs — it only reads, copies into the app's
 * own `photos` bucket on accept, and deletes on reject/consume.
 *
 * PATH SHAPE: `{share_id}/{share_device_id}/{uuid}.{ext}` — the FIRST
 * segment is the share id, exactly what the `suggestions_read`/
 * `suggestions_delete` storage policies key off of (the SAME pattern the
 * `photos` bucket uses with the household id as its first segment — see
 * core/storage/objects.ts's own `objectUrl`).
 *
 * TRUST MODEL: a guest's photo is untrusted content from a stranger. This
 * module never assumes anything about its size, aspect ratio, or that it
 * even decodes — every function here is written to fail gracefully
 * (return null / throw a catchable error) rather than crash, and the
 * caller (repository.ts, components/vorschlaege.tsx) is the one deciding
 * what "gracefully" means for that call site.
 */

import { File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';

import { newId } from '@/core/db/ids';
import { supabase } from '@/core/supabase';
import { PHOTOS_BUCKET, uploadToPhotosBucket } from '@/core/storage/objects';
import { deleteQuietly } from '@/features/photos/media';

export const SUGGESTIONS_BUCKET = 'suggestions';

/** Task's own explicit value — long enough to view/crop a photo, short enough to leak little. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** A signed, short-lived URL to DISPLAY a guest's photo — `null` on any failure (network, missing object, revoked access), never thrown, so a card can show "Bild nicht verfügbar" instead of crashing the whole screen. */
export async function signSuggestionPhotoUrl(photoKey: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(SUGGESTIONS_BUCKET)
      .createSignedUrl(photoKey, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.error('[LifeBook] Gastfoto konnte nicht signiert werden', error?.message ?? photoKey);
      return null;
    }
    return data.signedUrl;
  } catch (signError) {
    console.error('[LifeBook] Gastfoto konnte nicht signiert werden', signError);
    return null;
  }
}

/**
 * Removes a guest photo from the `suggestions` bucket — idempotent by the
 * same construction as photos/storage.ts#removeStoredObjects (Supabase
 * Storage's `remove()` succeeds for an already-missing key), so two
 * devices consuming/rejecting the same suggestion at once never race each
 * other into an error here (task's own concurrency requirement).
 */
export async function removeSuggestionPhoto(photoKey: string): Promise<void> {
  const { error } = await supabase.storage.from(SUGGESTIONS_BUCKET).remove([photoKey]);
  if (error) {
    throw new Error(`tree: Gastfoto konnte nicht gelöscht werden: ${error.message}`);
  }
}

function extensionOf(key: string): string {
  const match = key.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'jpg';
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Copies a guest's suggestion photo into the `photos` bucket, at a FRESH
 * key under `relativeId` — never a reused one (identity.ts's own doc
 * comment on the identical rule for a directly-uploaded portrait: the
 * same key returning a cached OLD image already happened once,
 * 2026-08-23 — this task's own report repeats the exact same failure
 * mode for a REUSED key here).
 *
 * Tries a same-request cross-bucket copy first — supabase-js 2.x's
 * `copy(from, to, { destinationBucket })` exists in the version this
 * project has installed (checked in node_modules — a real client-side
 * capability, not assumed). Whether the DEPLOYED Supabase Storage server
 * actually honours `destinationBucket` could not be confirmed from this
 * sandboxed session (no live project access) — task's own "prüfen, nicht
 * annehmen". So this never trusts the attempt blindly: ANY error from
 * `copy()` falls back to an explicit download-then-upload, the
 * unconditionally-correct path, rather than surfacing a copy failure to
 * the user.
 */
export async function copySuggestionPhotoToRelative(
  sourceKey: string,
  photoMime: string | null,
  householdId: string,
  relativeId: string,
): Promise<string> {
  const extension = (photoMime && EXTENSION_BY_MIME[photoMime]) || extensionOf(sourceKey);
  const destinationKey = `${householdId}/${relativeId}/portrait-${newId()}.${extension}`;

  const { error: copyError } = await supabase.storage
    .from(SUGGESTIONS_BUCKET)
    .copy(sourceKey, destinationKey, { destinationBucket: PHOTOS_BUCKET });

  if (!copyError) {
    return destinationKey;
  }

  console.error(
    '[LifeBook] Direktes Kopieren zwischen Buckets fehlgeschlagen, weiche auf Herunterladen/Hochladen aus',
    copyError.message,
  );

  const signedUrl = await signSuggestionPhotoUrl(sourceKey);
  if (!signedUrl) {
    throw new Error('tree: Gastfoto konnte weder kopiert noch heruntergeladen werden — vermutlich bereits entfernt');
  }

  const tempFile = new File(Paths.cache, `suggestion-photo-${newId()}.${extension}`);
  try {
    await File.downloadFileAsync(signedUrl, tempFile, { idempotent: true });
    await uploadToPhotosBucket(tempFile.uri, destinationKey, photoMime ?? 'image/jpeg');
  } finally {
    deleteQuietly(tempFile.uri);
  }

  return destinationKey;
}

/** A guest photo downloaded locally and decoded once, ready for portrait-cropper.tsx — its natural pixel size comes from THIS decode, since (unlike a device-picked photo) nothing handed it to us upfront. */
export type DownloadedSuggestionPhoto = { uri: string; width: number; height: number };

/**
 * Downloads a suggestion's guest photo and decodes it once via
 * expo-image-manipulator — the SAME decode step buildPortraitPreview
 * already trusts, reused here to also serve as the validity check: a
 * corrupt file or a format the device cannot decode (HEIC/HEIF can slip
 * through the browser's own canvas re-encode, see Fallstrick 15) throws
 * here rather than reaching the cropper with nothing to show. Caller owns
 * deleting the returned local file once done with it (deleteQuietly).
 */
export async function downloadSuggestionPhotoForCropping(
  photoKey: string,
  photoMime: string | null,
): Promise<DownloadedSuggestionPhoto> {
  const signedUrl = await signSuggestionPhotoUrl(photoKey);
  if (!signedUrl) {
    throw new Error('tree: Gastfoto konnte nicht geladen werden');
  }

  const extension = (photoMime && EXTENSION_BY_MIME[photoMime]) || extensionOf(photoKey);
  const tempFile = new File(Paths.cache, `suggestion-crop-${newId()}.${extension}`);
  await File.downloadFileAsync(signedUrl, tempFile, { idempotent: true });

  try {
    const decoded = await ImageManipulator.manipulate(tempFile.uri).renderAsync();
    return { uri: tempFile.uri, width: decoded.width, height: decoded.height };
  } catch (decodeError) {
    deleteQuietly(tempFile.uri);
    throw new Error(
      `tree: Gastfoto konnte nicht gelesen werden (nicht unterstütztes Format?): ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`,
    );
  }
}

/**
 * Best-effort count of files sitting in the `suggestions` bucket under
 * `shareIds` that no longer belong to any known `photo_key` — task 5,
 * "melden, nicht automatisch löschen". Two-level listing
 * (`{share_id}/{share_device_id}/...`), since Supabase Storage's `list()`
 * is not recursive. NEVER throws: a listing failure (e.g. this session
 * could not confirm the `suggestions_read` policy actually permits
 * listing folders the way it permits reading known keys — see this
 * repository's own report) simply reports 0 rather than breaking the
 * screen that calls it.
 */
export async function findOrphanedSuggestionPhotoCount(
  shareIds: readonly string[],
  knownPhotoKeys: ReadonlySet<string>,
): Promise<number> {
  let orphaned = 0;
  try {
    for (const shareId of shareIds) {
      const { data: deviceFolders, error: listError } = await supabase.storage.from(SUGGESTIONS_BUCKET).list(shareId);
      if (listError || !deviceFolders) {
        continue;
      }
      for (const deviceFolder of deviceFolders) {
        // A real file at this level (no further folder) would show up as
        // an entry with no `id` in some Storage versions — skip those,
        // this bucket's own path shape never has files directly under a
        // share id.
        const devicePath = `${shareId}/${deviceFolder.name}`;
        const { data: files, error: filesError } = await supabase.storage.from(SUGGESTIONS_BUCKET).list(devicePath);
        if (filesError || !files) {
          continue;
        }
        for (const file of files) {
          const fullPath = `${devicePath}/${file.name}`;
          if (!knownPhotoKeys.has(fullPath)) {
            orphaned += 1;
          }
        }
      }
    }
  } catch (sweepError) {
    console.error('[LifeBook] Aufräumen des Gästefoto-Speichers konnte nicht geprüft werden', sweepError);
    return 0;
  }
  return orphaned;
}
