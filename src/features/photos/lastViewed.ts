/**
 * photos/lastViewed — tiny module-level bridge from the fullscreen viewer
 * back to the Chronik grid.
 *
 * WHY THIS EXISTS
 * ----------------
 * `router.back()` from foto/[id].tsx has no built-in way to tell the screen
 * it returns to WHICH photo was actually being looked at. Chronik's own
 * scroll position is untouched while the viewer is open (it stays mounted
 * underneath — see app/_layout.tsx's NavigationGate) — but if the user
 * swiped forward from the photo they tapped, that preserved position still
 * points at wherever they tapped FROM, not where they ended up. A plain
 * module-level value, written by the viewer on every photo change and
 * consumed once by Chronik on refocus (see identity.ts#locatePhotoInSections
 * for how it turns an id into a scroll target), is the same pattern already
 * used for the signed-URL cache / upload-queue lock in ./storage.ts — no
 * navigation params, no extra store.
 */

let lastViewedPhotoId: string | null = null;

/** Called by the fullscreen viewer whenever the currently shown photo changes. */
export function setLastViewedPhotoId(photoId: string | null): void {
  lastViewedPhotoId = photoId;
}

/**
 * Consumed once by Chronik when it regains focus — clears itself so a LATER
 * refocus (switching tabs and back, say, with the viewer never reopened)
 * doesn't re-trigger a scroll to a photo the user may have long since
 * scrolled away from on their own.
 */
export function takeLastViewedPhotoId(): string | null {
  const photoId = lastViewedPhotoId;
  lastViewedPhotoId = null;
  return photoId;
}
