/**
 * people/identity — pure logic for a person's storage path. Device- and
 * network-touching upload code lives in ./photo; this stays importable
 * under Vitest.
 */

import { assertPathSafe } from '@/features/photos/identity';

/**
 * Storage path of a person's portrait, in the SAME private `photos` bucket
 * the photo chronology uses. Layout: {householdId}/people/{personId}.jpg —
 * one fixed key per person (no separate thumb/original — this is already a
 * preview-quality image, see ./photo#uploadPersonPhoto), always JPEG since
 * that is the only format the preview renderer produces.
 *
 * The first path segment MUST stay the household id — that is what the
 * storage access rules match on (see CLAUDE.md's Speichermodell). Reuses
 * photos/identity.ts's path-safety check rather than re-implementing it, so
 * this bucket's one real invariant can't drift between the two features.
 */
export function buildPersonPhotoKey(householdId: string, personId: string): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(personId, 'personId');
  return `${householdId}/people/${personId}.jpg`;
}
