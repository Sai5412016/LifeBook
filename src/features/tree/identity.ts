/**
 * tree/identity — the one path-construction rule for a relative's portrait.
 *
 * 2026-08-23, CORRECTED: this used to build a FIXED key per relative
 * (`{household}/relatives/{id}.jpg`, reused on every upload — mirroring
 * people/identity.ts#buildPersonPhotoKey), relying on the storage upload's
 * `x-upsert: true` header to overwrite it in place. Reported from the
 * device: once a relative had a portrait, it could never be replaced —
 * the write silently never took. This session had no live device or
 * Supabase project access to confirm WHY the overwrite fails there while
 * the identical pattern works for `people`, but a Storage bucket that
 * grants INSERT without also granting UPDATE on `storage.objects` is a
 * known, exactly-this-shaped failure mode: the FIRST upload to a key (a
 * plain insert) succeeds, every later upload to the SAME key (which
 * upsert quietly turns into an update) is silently refused by RLS. A key
 * that is unique per upload sidesteps that whole class of problem — every
 * upload is a plain insert, never a conflict — at the cost of leaving the
 * previous key behind as an orphan, which the caller now cleans up
 * explicitly (see repository.ts's callers of `uploadRelativePhoto`).
 */

import { assertPathSafe } from '@/features/photos/identity';

/** `uploadId` must be a fresh id per upload (see photo.ts#uploadRelativePhoto) — never reused, unlike the relative's own `id`. */
export function buildRelativePhotoKey(householdId: string, relativeId: string, uploadId: string): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(relativeId, 'relativeId');
  assertPathSafe(uploadId, 'uploadId');
  return `${householdId}/relatives/${relativeId}/${uploadId}.jpg`;
}
