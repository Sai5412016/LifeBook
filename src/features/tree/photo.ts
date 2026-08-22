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
 */

import * as ImagePicker from 'expo-image-picker';

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
 * Renders a preview from `sourceUri` and uploads it to this relative's
 * fixed storage key, overwriting any earlier portrait. Returns the key to
 * store in `relatives.photo_key`.
 */
export async function uploadRelativePhoto(
  householdId: string,
  relativeId: string,
  sourceUri: string,
): Promise<string> {
  const key = buildRelativePhotoKey(householdId, relativeId);
  const thumbUri = await createThumbnail(sourceUri);
  try {
    await uploadToPhotosBucket(thumbUri, key, 'image/jpeg');
  } finally {
    deleteQuietly(thumbUri);
  }
  return key;
}
