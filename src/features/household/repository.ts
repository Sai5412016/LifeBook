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
import { nowUtcIso } from '@/core/time';

import type { CreateHouseholdInput, CreateHouseholdResult } from './types';

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
};

export function useActiveChild(): { child: ActiveChild | null; isLoading: boolean } {
  const { data, isLoading } = useQuery<{
    id: string;
    household_id: string;
    first_name: string;
    birth_at: string;
    birth_tz: string;
  }>(
    `SELECT id, household_id, first_name, birth_at, birth_tz
       FROM children
      WHERE deleted_at IS NULL
      ORDER BY sort_index ASC, created_at ASC
      LIMIT 1`,
  );

  const row = data?.[0];

  return {
    child: row
      ? {
          householdId: row.household_id,
          childId: row.id,
          firstName: row.first_name,
          birthAtUtcIso: row.birth_at,
          birthTz: row.birth_tz,
        }
      : null,
    isLoading,
  };
}
