/**
 * tree/identity — the one path-construction rule for a relative's portrait,
 * mirroring people/identity.ts#buildPersonPhotoKey exactly (same private
 * `photos` bucket, same "the first path segment is the household id, so it
 * must be path-safe" invariant enforced by photos/identity.ts's own check).
 */

import { assertPathSafe } from '@/features/photos/identity';

export function buildRelativePhotoKey(householdId: string, relativeId: string): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(relativeId, 'relativeId');
  return `${householdId}/relatives/${relativeId}.jpg`;
}
