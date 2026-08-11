/**
 * photos/viewer — pure logic for the swipeable fullscreen viewer: finding the
 * starting position, which signed-URL window to keep loaded around it, the
 * "14 von 90" position label, and where to land after a delete. Deliberately
 * free of any Expo / React Native / PowerSync import so it runs in plain Node
 * under Vitest; the device- and screen-touching side lives in
 * src/app/foto/[id].tsx.
 */

/** Clamp an index into `[0, length - 1]`. Returns 0 for an empty list. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

/** Position of `photoId` within the chronology, or -1 while it isn't loaded (yet) or was deleted. */
export function indexOfPhoto(photos: readonly { id: string }[], photoId: string | undefined): number {
  if (!photoId) {
    return -1;
  }
  return photos.findIndex((photo) => photo.id === photoId);
}

/**
 * Indices to keep a signed URL loaded for, centered on `currentIndex` and
 * clipped to the list's bounds — "the current photo plus three each way",
 * expanding as the viewer scrolls rather than resolving the whole album at
 * once.
 */
export function windowIndices(currentIndex: number, total: number, radius: number): number[] {
  if (total <= 0) {
    return [];
  }
  const start = Math.max(0, currentIndex - radius);
  const end = Math.min(total - 1, currentIndex + radius);
  const indices: number[] = [];
  for (let index = start; index <= end; index += 1) {
    indices.push(index);
  }
  return indices;
}

/** "14 von 90" — an unobtrusive position readout for the header. */
export function formatPositionLabel(currentIndex: number, total: number): string {
  return `${currentIndex + 1} von ${total}`;
}

/**
 * Which index the viewer should land on after deleting the photo at
 * `deletedIndex`, given the list held `totalBefore` photos before the
 * delete:
 * - it wasn't the last photo → the same index (the next photo slides into
 *   the slot the deleted one left, so no visible jump is needed);
 * - it WAS the last photo, and others remain → step back to the new last
 *   index;
 * - it was the only photo → -1, meaning "there is nothing left to view,
 *   return to the Chronik".
 */
export function indexAfterDeletion(deletedIndex: number, totalBefore: number): number {
  if (totalBefore <= 1) {
    return -1;
  }
  if (deletedIndex >= totalBefore - 1) {
    return totalBefore - 2;
  }
  return deletedIndex;
}
