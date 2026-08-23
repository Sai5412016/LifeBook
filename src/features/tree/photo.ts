/**
 * tree/photo — picks and uploads a single portrait for a relative. Reuses
 * the photos feature's device code exactly like
 * people/photo.ts#uploadPersonPhoto does — same picker, same JPEG preview
 * pipeline, same private `photos` bucket — only the storage path shape
 * differs (./identity#buildRelativePhotoKey).
 *
 * NO NEW NATIVE MODULE: expo-image-picker and expo-image-manipulator are
 * already installed and configured for the photo chronology (see
 * people/photo.ts's identical note).
 *
 * UNLIKE people/photo.ts#uploadPersonPhoto, this does NOT reuse a fixed
 * key across uploads — see identity.ts's own doc comment for why (a
 * reported, unreproduced-from-this-session bug: once a relative had a
 * portrait, replacing it silently never took). Every call here gets its
 * OWN fresh key, so every upload is a plain insert; the caller is
 * responsible for deleting the previous key afterwards (see
 * repository.ts's callers).
 */

import * as ImagePicker from 'expo-image-picker';

import { newId } from '@/core/db/ids';
import { createThumbnail, deleteQuietly } from '@/features/photos/media';
import { uploadToPhotosBucket } from '@/features/photos/storage';

import { buildRelativePhotoKey } from './identity';

/** Raised when the user closed the picker without choosing a photo. */
export class RelativePhotoPickCancelledError extends Error {
  constructor() {
    super('picker cancelled');
    this.name = 'RelativePhotoPickCancelledError';
  }
}

/** Opens the same system picker as the Chronik, restricted to a single image. */
export async function pickRelativePhotoUri(): Promise<string> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    throw new RelativePhotoPickCancelledError();
  }

  return result.assets[0].uri;
}

/**
 * Renders a preview from `sourceUri` and uploads it to a FRESH storage key
 * for this relative (never a reused one — see this file's own doc
 * comment). Returns the new key to store in `relatives.photo_key`; the
 * caller still owns removing whatever key was there before.
 */
export async function uploadRelativePhoto(
  householdId: string,
  relativeId: string,
  sourceUri: string,
): Promise<string> {
  const key = buildRelativePhotoKey(householdId, relativeId, newId());
  const thumbUri = await createThumbnail(sourceUri);
  try {
    await uploadToPhotosBucket(thumbUri, key, 'image/jpeg');
  } finally {
    deleteQuietly(thumbUri);
  }
  return key;
}
