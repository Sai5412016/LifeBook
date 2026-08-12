/**
 * household — repository (Spec §4 rule: features access data ONLY through here).
 *
 * createHouseholdWithFirstChild() is the onboarding write: it creates the
 * household, makes the creating user its 'owner' member, and adds the first
 * child — all in a single local transaction so the three rows are atomic and
 * appear together once PowerSync uploads them (Spec §6 upload semantics).
 *
 * useHasHousehold() is the reactive read the onboarding gate (src/app/_layout.tsx)
 * watches to decide "show onboarding" vs. "show the app" — it updates instantly
 * on the local write above, no network round-trip needed.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { combineLocalDateAndTime, nowUtcIso } from '@/core/time';

import type { ChildEditInput, CreateHouseholdInput, CreateHouseholdResult } from './types';

export async function createHouseholdWithFirstChild(
  db: AbstractPowerSyncDatabase,
  input: CreateHouseholdInput,
): Promise<CreateHouseholdResult> {
  const householdId = newId();
  const memberId = newId();
  const childId = newId();
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      'INSERT INTO households (id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
      [householdId, input.householdName, now, now],
    );

    await tx.execute(
      `INSERT INTO household_members
         (id, household_id, user_id, display_name, role, joined_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'owner', ?, ?, NULL)`,
      [memberId, householdId, input.userId, input.displayName, now, now],
    );

    await tx.execute(
      `INSERT INTO children
         (id, household_id, first_name, birth_at, birth_tz, sort_index, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
      [childId, householdId, input.child.firstName, input.child.birthAtUtcIso, input.child.birthTz, now, now],
    );
  });

  return { householdId, childId };
}

/** True as soon as `userId` has at least one (non-deleted) household membership. */
export function useHasHousehold(userId: string | undefined) {
  return useQuery<{ household_id: string }>(
    'SELECT household_id FROM household_members WHERE user_id = ? AND deleted_at IS NULL LIMIT 1',
    [userId ?? ''],
  );
}

/** Columns every child read selects, so callers always get a complete row. */
const CHILD_COLUMNS = `
  id, household_id, first_name, birth_at, birth_tz,
  birth_weight_g, birth_length_mm, birth_head_mm, birth_place, avatar_photo_id
`;

type ChildQueryRow = {
  id: string;
  household_id: string;
  first_name: string;
  birth_at: string;
  birth_tz: string;
  birth_weight_g: number | null;
  birth_length_mm: number | null;
  birth_head_mm: number | null;
  birth_place: string | null;
  avatar_photo_id: string | null;
};

/**
 * The child the app currently shows, plus the household it belongs to.
 *
 * Single-child assumption, deliberate and temporary: `sort_index` already orders
 * siblings, so multi-child support becomes a child picker feeding this same
 * shape rather than a rewrite. No user filter is needed — PowerSync only ever
 * syncs households the signed-in user is a member of.
 */
export type ActiveChild = {
  householdId: string;
  childId: string;
  firstName: string;
  birthAtUtcIso: string;
  birthTz: string;
  birthWeightG: number | null;
  birthLengthMm: number | null;
  birthHeadMm: number | null;
  birthPlace: string | null;
  avatarPhotoId: string | null;
};

const toActiveChild = (row: ChildQueryRow): ActiveChild => ({
  householdId: row.household_id,
  childId: row.id,
  firstName: row.first_name,
  birthAtUtcIso: row.birth_at,
  birthTz: row.birth_tz,
  birthWeightG: row.birth_weight_g,
  birthLengthMm: row.birth_length_mm,
  birthHeadMm: row.birth_head_mm,
  birthPlace: row.birth_place,
  avatarPhotoId: row.avatar_photo_id,
});

export function useActiveChild(): { child: ActiveChild | null; isLoading: boolean } {
  const { data, isLoading } = useQuery<ChildQueryRow>(
    `SELECT ${CHILD_COLUMNS}
       FROM children
      WHERE deleted_at IS NULL
      ORDER BY sort_index ASC, created_at ASC
      LIMIT 1`,
  );

  const row = data?.[0];

  return {
    child: row ? toActiveChild(row) : null,
    isLoading,
  };
}

async function loadChildById(
  db: AbstractPowerSyncDatabase,
  childId: string,
): Promise<ActiveChild | null> {
  const rows = await db.getAll<ChildQueryRow>(
    `SELECT ${CHILD_COLUMNS} FROM children WHERE id = ? AND deleted_at IS NULL`,
    [childId],
  );
  const row = rows[0];
  return row ? toActiveChild(row) : null;
}

/**
 * Applies an edit from the child-profile screen. Birth date/time are
 * recombined against the child's EXISTING `birth_tz` (editing the timezone
 * itself isn't part of this screen) via the same `combineLocalDateAndTime`
 * every other feature's time-correction uses. A malformed date/time is
 * silently ignored (keeps the previous `birth_at`) — the edit screen
 * validates the format before ever calling this, so reaching here with bad
 * input would mean a UI bug, not something to surface twice.
 *
 * Does NOT touch `photos.age_days`: see features/photos/repository.ts's
 * doc comment on why photo ages are computed live from `children.birth_at`
 * for display instead of being rewritten here.
 */
export async function updateChild(
  db: AbstractPowerSyncDatabase,
  childId: string,
  input: ChildEditInput,
): Promise<void> {
  const child = await loadChildById(db, childId);
  if (!child) {
    return;
  }

  const combined = combineLocalDateAndTime(input.birthDate, input.birthTime, child.birthTz);
  const birthAt = combined ?? child.birthAtUtcIso;

  await db.execute(
    `UPDATE children
        SET first_name = ?, birth_at = ?, birth_weight_g = ?, birth_length_mm = ?,
            birth_head_mm = ?, birth_place = ?, avatar_photo_id = ?, updated_at = ?
      WHERE id = ?`,
    [
      input.firstName,
      birthAt,
      input.birthWeightG,
      input.birthLengthMm,
      input.birthHeadMm,
      input.birthPlace,
      input.avatarPhotoId,
      nowUtcIso(),
      childId,
    ],
  );
}
