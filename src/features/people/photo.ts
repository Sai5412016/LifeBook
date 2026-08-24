/**
 * people/photo — picks and uploads a single portrait for a person. Reuses
 * the photos feature's device code (system picker, thumbnail rendering,
 * bucket upload, deletion) rather than duplicating it: same picker, same
 * JPEG preview pipeline, same private `photos` bucket — only the storage
 * path shape differs (./identity#buildPersonPhotoKey vs.
 * photos/identity.ts#buildThumbKey).
 *
 * NO NEW NATIVE MODULE: expo-image-picker and expo-image-manipulator are
 * already installed and configured for the photo chronology — this file
 * adds no dependency, so it ships over a normal EAS Update (see CLAUDE.md
 * Fallstrick 5).
 */

import * as ImagePicker from 'expo-image-picker';

import { uploadToPhotosBucket } from '@/core/storage/objects';
import { createThumbnail, deleteQuietly } from '@/features/photos/media';

import { buildPersonPhotoKey } from './identity';

/** Raised when the user closed the picker without choosing a photo. */
export class PersonPhotoPickCancelledError extends Error {
  constructor() {
    super('picker cancelled');
    this.name = 'PersonPhotoPickCancelledError';
  }
}

/** A freshly picked, not-yet-cropped image and its natural pixel size — the size the picker already knows, so the crop step (features/tree/components/portrait-cropper.tsx, shared between both features) never needs a separate probe. */
export type PickedPortrait = { uri: string; width: number; height: number };

/**
 * Opens the same system picker as the Chronik, restricted to a single
 * image. Returns the RAW picked image — 2026-08-24: callers must now run
 * it through features/tree/components/portrait-cropper.tsx before treating
 * it as the new portrait (task requirement: the picked photo must never
 * reach the bucket unchanged, see that file's own doc comment for why).
 */
export async function pickPersonPhoto(): Promise<PickedPortrait> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    throw new PersonPhotoPickCancelledError();
  }

  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Renders a preview from `sourceUri` and uploads it to this person's fixed
 * storage key, overwriting any earlier portrait. Returns the key to store
 * in `people.photo_key`.
 */
export async function uploadPersonPhoto(
  householdId: string,
  personId: string,
  sourceUri: string,
): Promise<string> {
  const key = buildPersonPhotoKey(householdId, personId);
  const thumbUri = await createThumbnail(sourceUri);
  try {
    await uploadToPhotosBucket(thumbUri, key, 'image/jpeg');
  } finally {
    deleteQuietly(thumbUri);
  }
  return key;
}
