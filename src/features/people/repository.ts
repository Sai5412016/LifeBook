/**
 * people — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for the
 * people roster. Portrait bytes never pass through here — ./photo moves
 * those, the same way photos/repository.ts and photos/storage.ts split that
 * work for the chronology.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { nowUtcIso } from '@/core/time';

import { sortPeople } from './logic';
import type { PersonRole, PersonRow } from './types';

/** Columns every read selects, so callers always get a complete PersonRow. */
const PEOPLE_COLUMNS = `
  id, household_id, child_id, name, role, note, photo_key,
  met_from, met_to, sort_index, created_by, created_at, updated_at, deleted_at
`;

/** Reactive roster of one child's people, in display order. */
export function usePeopleOfChild(childId: string | undefined): {
  people: PersonRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<PersonRow>(
    `SELECT ${PEOPLE_COLUMNS} FROM people
      WHERE child_id = ? AND deleted_at IS NULL
      ORDER BY sort_index ASC, created_at ASC`,
    [childId ?? ''],
  );

  // The SQL above already orders the same way — applying the pure,
  // separately-tested sort here too means the two can never quietly drift
  // apart if either one changes later.
  return { people: sortPeople(data ?? []), isLoading };
}

/** Reactive single person by id, for the detail and edit screens. */
export function usePersonById(personId: string | undefined): {
  person: PersonRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<PersonRow>(
    `SELECT ${PEOPLE_COLUMNS} FROM people WHERE id = ? AND deleted_at IS NULL`,
    [personId ?? ''],
  );

  return { person: data?.[0], isLoading };
}

export type AddPersonInput = {
  householdId: string;
  childId: string;
  userId: string;
  name: string;
  role: PersonRole;
  note: string | null;
  /** ISO-8601 UTC or null — the screen converts the "YYYY-MM-DD" input via core/time before calling this. */
  metFromUtcIso: string | null;
  metToUtcIso: string | null;
};

/**
 * Adds a person at the end of the roster (`sort_index` = current count — no
 * reordering UI exists yet, so append-in-creation-order is the whole rule).
 * `photo_key` starts NULL; the caller uploads the portrait (if any) and
 * calls `setPersonPhotoKey` afterwards, once the id below exists to build
 * the storage path from (see ./identity#buildPersonPhotoKey).
 */
export async function addPerson(db: AbstractPowerSyncDatabase, input: AddPersonInput): Promise<string> {
  const id = newId();
  const now = nowUtcIso();

  const countRows = await db.getAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM people WHERE child_id = ? AND deleted_at IS NULL',
    [input.childId],
  );
  const sortIndex = countRows[0]?.n ?? 0;

  await db.execute(
    `INSERT INTO people (
       id, household_id, child_id, name, role, note, photo_key,
       met_from, met_to, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      id,
      input.householdId,
      input.childId,
      input.name,
      input.role,
      input.note,
      input.metFromUtcIso,
      input.metToUtcIso,
      sortIndex,
      input.userId,
      now,
      now,
    ],
  );

  return id;
}

export type UpdatePersonInput = {
  name: string;
  role: PersonRole;
  note: string | null;
  metFromUtcIso: string | null;
  metToUtcIso: string | null;
};

/** Applies an edit from the person form. Does not touch `photo_key` — see `setPersonPhotoKey`. */
export async function updatePerson(
  db: AbstractPowerSyncDatabase,
  personId: string,
  input: UpdatePersonInput,
): Promise<void> {
  await db.execute(
    `UPDATE people
        SET name = ?, role = ?, note = ?, met_from = ?, met_to = ?, updated_at = ?
      WHERE id = ?`,
    [input.name, input.role, input.note, input.metFromUtcIso, input.metToUtcIso, nowUtcIso(), personId],
  );
}

/** Records the uploaded portrait's storage key, once the upload has actually succeeded. */
export async function setPersonPhotoKey(
  db: AbstractPowerSyncDatabase,
  personId: string,
  photoKey: string,
): Promise<void> {
  await db.execute('UPDATE people SET photo_key = ?, updated_at = ? WHERE id = ?', [
    photoKey,
    nowUtcIso(),
    personId,
  ]);
}

/** Soft-delete, mirroring the convention used by every other table (Spec §5.1). */
export async function softDeletePerson(db: AbstractPowerSyncDatabase, personId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE people SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    personId,
  ]);
}
