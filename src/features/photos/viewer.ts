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

/**
 * Up to `radius` indices immediately before AND after `currentIndex` —
 * excludes `currentIndex` itself, which is already on screen. The fullscreen
 * viewer's prefetch neighborhood (Aufgabe 4d, 2026-08-13): a swipe can go
 * either direction from wherever the user currently is, so both sides are
 * always covered, not just whichever way the last swipe happened to go.
 */
export function neighborIndices(currentIndex: number, total: number, radius: number): number[] {
  return windowIndices(currentIndex, total, radius).filter((index) => index !== currentIndex);
}

/**
 * "14 von 90" — an unobtrusive position readout for the header.
 *
 * 2026-08-14: `rank` is already 1-based (identity.ts#chronologicalRank),
 * unlike the swipe list's own 0-based `currentIndex` this used to take —
 * the header shows the child's-life rank now, not the list position, so
 * there is no index left to add 1 to here.
 */
export function formatPositionLabel(rank: number, total: number): string {
  return `${rank} von ${total}`;
}

/**
 * The fullscreen header's subtitle line: the age label and the position
 * readout, joined together. Extracted as its OWN pure function (2026-09-10,
 * fourth pass on the age display) so the exact composition — which used to
 * live inline in app/foto/[id].tsx and therefore couldn't be unit-tested at
 * all — is verifiable directly.
 *
 * "—" (Geviertstrich), not "·", joins the two: app-wide rule since this
 * same task — "·" is reserved for separating pieces WITHIN one age label
 * (`identity.ts#formatDayAndWeekLabel`'s own "Tag N · Woche M"), so a
 * result like "Tag 34 · Woche 4 — 12 von 340" stays unambiguous about
 * which numbers belong together. Either piece may be absent (no age yet
 * resolved, or no rank because the photo isn't in the loaded chronology);
 * present pieces join with the separator, missing ones are simply omitted
 * rather than leaving a stray "—" or empty segment.
 */
export function formatFullscreenHeaderSubtitle(ageLabel: string | null, positionLabel: string | null): string {
  return [ageLabel, positionLabel].filter((part): part is string => !!part).join(' — ');
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
