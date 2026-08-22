/**
 * tree — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for the
 * "Stammbaum" tab: `relatives`, their partnerships (`relative_unions`), and
 * — Stufe 2, not built yet — `relative_photos`. `removePhotoFromAllRelatives`
 * is wired in already regardless (task requirement), even though nothing
 * writes a `relative_photos` row yet.
 *
 * WRITE ORDER: `relatives`/`relative_unions`/`relative_photos` carry no
 * real foreign keys to each other (CLAUDE.md Fallstrick 12 — a real FK
 * between two synced tables lets a child row outrun its parent row through
 * PowerSync's upload queue and wedge every later upload from that device,
 * exactly what `milestone_photos.milestone_id` did before that fix). No
 * constraint enforces it here, but this module still writes a relative
 * BEFORE any union that references it, by convention — see `addRelative`.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase, Transaction } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { nowUtcIso, toLocalDate } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';

import { DEFAULT_UNION_KIND, formatGermanDate, partnerIdFromUnion } from './logic';
import type { RelativeGender, RelativeRow, RelativeUnionRow } from './types';

const RELATIVE_COLUMNS = `
  id, household_id, child_id, given_name, family_name, birth_name, gender,
  born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
  photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
`;

const UNION_COLUMNS = `
  id, household_id, a_id, b_id, kind, since_on, until_on,
  created_by, created_at, updated_at, deleted_at, source_device_id
`;

async function loadRelativeById(db: AbstractPowerSyncDatabase, relativeId: string): Promise<RelativeRow | null> {
  const rows = await db.getAll<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives WHERE id = ? AND deleted_at IS NULL`,
    [relativeId],
  );
  return rows[0] ?? null;
}

/** Reactive: every relative of a household, in display order. */
export function useRelativesOfHousehold(householdId: string | undefined): {
  relatives: RelativeRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives
      WHERE household_id = ? AND deleted_at IS NULL
      ORDER BY sort_index ASC, created_at ASC`,
    [householdId ?? ''],
  );
  return { relatives: data ?? [], isLoading };
}

/** Reactive single relative by id, for the detail and edit screens. */
export function useRelativeById(relativeId: string | undefined): {
  relative: RelativeRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeRow>(
    `SELECT ${RELATIVE_COLUMNS} FROM relatives WHERE id = ? AND deleted_at IS NULL`,
    [relativeId ?? ''],
  );
  return { relative: data?.[0], isLoading };
}

/** Reactive: every partnership of a household — the generation graph's other edge (see logic.ts#FamilyGraphPerson). */
export function useUnionsOfHousehold(householdId: string | undefined): {
  unions: RelativeUnionRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions WHERE household_id = ? AND deleted_at IS NULL`,
    [householdId ?? ''],
  );
  return { unions: data ?? [], isLoading };
}

/** Reactive: the id of one relative's current partner, from either side of `relative_unions` — for the edit form's "Partner" field and the detail screen's link. */
export function useRelativePartnerId(relativeId: string | undefined): {
  partnerId: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions
      WHERE (a_id = ? OR b_id = ?) AND deleted_at IS NULL
      LIMIT 1`,
    [relativeId ?? '', relativeId ?? ''],
  );
  const union = data?.[0];
  return { partnerId: union && relativeId ? partnerIdFromUnion(union, relativeId) : null, isLoading };
}

/**
 * Makes `desiredPartnerId` the one active partnership `relativeId` has,
 * replacing whatever it had before — soft-deletes the old union (if any
 * and if different) before inserting the new one (if any), all inside the
 * caller's transaction. A no-op when the desired partner already matches
 * the existing one, so an unrelated field edit never touches this table.
 */
async function reconcilePartnerUnion(
  tx: Transaction,
  relativeId: string,
  householdId: string,
  userId: string,
  desiredPartnerId: string | null,
): Promise<void> {
  const existingRows = await tx.getAll<RelativeUnionRow>(
    `SELECT ${UNION_COLUMNS} FROM relative_unions
      WHERE (a_id = ? OR b_id = ?) AND deleted_at IS NULL
      LIMIT 1`,
    [relativeId, relativeId],
  );
  const existingUnion = existingRows[0] ?? null;
  const existingPartnerId = existingUnion ? partnerIdFromUnion(existingUnion, relativeId) : null;

  if (existingPartnerId === desiredPartnerId) {
    return;
  }

  const now = nowUtcIso();
  if (existingUnion) {
    await tx.execute('UPDATE relative_unions SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      existingUnion.id,
    ]);
  }
  if (desiredPartnerId) {
    await tx.execute(
      `INSERT INTO relative_unions (
         id, household_id, a_id, b_id, kind, since_on, until_on,
         created_by, created_at, updated_at, deleted_at, source_device_id
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL)`,
      [newId(), householdId, relativeId, desiredPartnerId, DEFAULT_UNION_KIND, userId, now, now],
    );
  }
}

export type AddRelativeInput = {
  householdId: string;
  userId: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: RelativeGender | null;
  /** Free text, see types.ts#RelativeRow. */
  bornOn: string | null;
  bornPlace: string | null;
  deceased: boolean;
  diedOn: string | null;
  diedPlace: string | null;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  note: string | null;
};

/**
 * Creates a relative, at the end of the household's roster
 * (`sort_index` = current count, same convention as
 * people/repository.ts#addPerson). Throws for an empty given name — the
 * same "letztes Netz" every other required-name field in this project
 * keeps at the data layer, independent of the form's own validation.
 */
export async function addRelative(db: AbstractPowerSyncDatabase, input: AddRelativeInput): Promise<string> {
  const givenName = input.givenName.trim();
  if (givenName.length === 0) {
    throw new Error('tree: Person ohne Vornamen kann nicht gespeichert werden');
  }

  const countRows = await db.getAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM relatives WHERE household_id = ? AND deleted_at IS NULL',
    [input.householdId],
  );
  const sortIndex = countRows[0]?.n ?? 0;

  const id = newId();
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    // Relative row first, partnership second — see this module's own doc
    // comment on write order (Fallstrick 12).
    await tx.execute(
      `INSERT INTO relatives (
         id, household_id, child_id, given_name, family_name, birth_name, gender,
         born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
         photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        id,
        input.householdId,
        givenName,
        input.familyName,
        input.birthName,
        input.gender,
        input.bornOn,
        input.bornPlace,
        input.deceased ? 1 : 0,
        input.diedOn,
        input.diedPlace,
        input.motherId,
        input.fatherId,
        input.note,
        sortIndex,
        input.userId,
        now,
        now,
      ],
    );
    await reconcilePartnerUnion(tx, id, input.householdId, input.userId, input.partnerId);
  });

  return id;
}

export type UpdateRelativeInput = {
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: RelativeGender | null;
  bornOn: string | null;
  bornPlace: string | null;
  deceased: boolean;
  diedOn: string | null;
  diedPlace: string | null;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  note: string | null;
};

/**
 * Applies an edit from the relative form. Does not touch `photo_key` — see
 * `setRelativePhotoKey`. `userId` is only needed for a freshly-inserted
 * `relative_unions` row's `created_by` (see `reconcilePartnerUnion`) — this
 * function otherwise never creates a new row, unlike `addRelative`.
 *
 * LETZTES NETZ (Architekturregel 9): identisch zu
 * `people/repository.ts#updatePerson` — ein leerer Vorname ist nie eine
 * gültige Absicht.
 */
export async function updateRelative(
  db: AbstractPowerSyncDatabase,
  relativeId: string,
  userId: string,
  input: UpdateRelativeInput,
): Promise<void> {
  const givenName = input.givenName.trim();
  if (givenName.length === 0) {
    throw new Error('tree: Person ohne Vornamen kann nicht gespeichert werden');
  }

  const relative = await loadRelativeById(db, relativeId);
  if (!relative) {
    return;
  }
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE relatives
          SET given_name = ?, family_name = ?, birth_name = ?, gender = ?,
              born_on = ?, born_place = ?, deceased = ?, died_on = ?, died_place = ?,
              mother_id = ?, father_id = ?, note = ?, updated_at = ?
        WHERE id = ?`,
      [
        givenName,
        input.familyName,
        input.birthName,
        input.gender,
        input.bornOn,
        input.bornPlace,
        input.deceased ? 1 : 0,
        input.diedOn,
        input.diedPlace,
        input.motherId,
        input.fatherId,
        input.note,
        now,
        relativeId,
      ],
    );
    await reconcilePartnerUnion(tx, relativeId, relative.household_id, userId, input.partnerId);
  });
}

/** Records the uploaded portrait's storage key, once the upload has actually succeeded — mirrors people/repository.ts#setPersonPhotoKey. */
export async function setRelativePhotoKey(
  db: AbstractPowerSyncDatabase,
  relativeId: string,
  photoKey: string,
): Promise<void> {
  await db.execute('UPDATE relatives SET photo_key = ?, updated_at = ? WHERE id = ?', [
    photoKey,
    nowUtcIso(),
    relativeId,
  ]);
}

/** Soft-delete, mirroring the convention used by every other table (Spec §5.1). */
export async function softDeleteRelative(db: AbstractPowerSyncDatabase, relativeId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE relatives SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, relativeId]);
}

/**
 * The one relatives row that IS the tracked child (`child_id` set) —
 * created once, the first time the "Stammbaum" tab is opened, from the
 * `children` row already on screen (given name, and `born_on` seeded as
 * "TT.MM.JJJJ" from `birth_at`/`birth_tz` — free text from then on, never
 * recomputed, same as every other `born_on`). Idempotent: checked first,
 * so opening the tab twice — or on both parents' phones — never creates a
 * second root row. No confirmation prompt (task requirement); the row is
 * ordinary and editable afterwards like any other.
 */
export async function ensureRootRelative(
  db: AbstractPowerSyncDatabase,
  child: Pick<ActiveChild, 'householdId' | 'childId' | 'firstName' | 'birthAtUtcIso' | 'birthTz'>,
  userId: string,
): Promise<string> {
  const existing = await db.getAll<{ id: string }>(
    `SELECT id FROM relatives WHERE household_id = ? AND child_id = ? AND deleted_at IS NULL LIMIT 1`,
    [child.householdId, child.childId],
  );
  if (existing[0]) {
    return existing[0].id;
  }

  const id = newId();
  const now = nowUtcIso();
  const bornOn = formatGermanDate(toLocalDate(child.birthAtUtcIso, child.birthTz));

  await db.execute(
    `INSERT INTO relatives (
       id, household_id, child_id, given_name, family_name, birth_name, gender,
       born_on, born_place, deceased, died_on, died_place, mother_id, father_id,
       photo_key, note, sort_index, created_by, created_at, updated_at, deleted_at, source_device_id
     ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?, ?, NULL, NULL)`,
    [id, child.householdId, child.childId, child.firstName, bornOn, userId, now, now],
  );
  return id;
}

/**
 * Removes a photo from every relative it was ever linked to — the last
 * step of a PERMANENT photo delete
 * (features/photos/storage.ts#permanentlyDeletePhoto), called AFTER the
 * photo's own row is already gone. Wired in ahead of Stufe 2 (task
 * requirement): nothing writes a `relative_photos` row yet, so this is
 * currently always a no-op, but the cleanup path exists from the start
 * rather than being retrofitted once photos actually get linked.
 */
export async function removePhotoFromAllRelatives(db: AbstractPowerSyncDatabase, photoId: string): Promise<void> {
  await db.execute('DELETE FROM relative_photos WHERE photo_id = ?', [photoId]);
}
