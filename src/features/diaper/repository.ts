/**
 * diaper — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for
 * diapers. No timer, no multi-device conflict to resolve — a diaper change
 * is logged once, instantly, and only ever corrected afterwards.
 *
 * `diapers` has no database-level check constraints on `kind` / `consistency`
 * / `color` (Master-Spec §5: client schema is TEXT | INTEGER | REAL only) —
 * the allowed values live in ./types and are enforced here, same as every
 * other table.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { combineLocalDateAndTime, nowUtcIso, toLocalDate } from '@/core/time';

import type { DiaperColor, DiaperConsistency, DiaperKind, DiaperRow } from './types';

/** Columns every read selects, so callers always get a complete DiaperRow. */
const DIAPER_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  kind, consistency, color, leaked
`;

async function loadDiaperById(
  db: AbstractPowerSyncDatabase,
  diaperId: string,
): Promise<DiaperRow | null> {
  const rows = await db.getAll<DiaperRow>(
    `SELECT ${DIAPER_COLUMNS} FROM diapers WHERE id = ? AND deleted_at IS NULL`,
    [diaperId],
  );
  return rows[0] ?? null;
}

export type LogDiaperInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  kind: DiaperKind;
};

/**
 * Logs a diaper change immediately, at the current time, with no details —
 * the common case that must work one-handed without a follow-up question.
 * Returns the new row's id so the caller can offer to add details right
 * after, without a second query.
 */
export async function logDiaper(
  db: AbstractPowerSyncDatabase,
  input: LogDiaperInput,
): Promise<string> {
  const now = nowUtcIso();
  const localDate = toLocalDate(now, input.tz);
  const diaperId = newId();

  await db.execute(
    `INSERT INTO diapers (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       kind, consistency, color, leaked
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      diaperId,
      input.householdId,
      input.childId,
      now,
      input.tz,
      localDate,
      input.userId,
      now,
      now,
      null,
      null,
      null,
      input.kind,
      null,
      null,
      0,
    ],
  );

  return diaperId;
}

export type DiaperEditInput = {
  /** New "HH:mm" wall-clock time, interpreted in the entry's own `tz`. */
  time?: string;
  kind?: DiaperKind;
  /** `null` clears the field; `undefined` leaves it unchanged. */
  consistency?: DiaperConsistency | null;
  color?: DiaperColor | null;
  leaked?: number;
};

/**
 * Applies a correction to an existing diaper entry — start time, kind, or
 * any of the optional details. Used both for the "add details" prompt right
 * after logging (only `consistency`/`color`/`leaked` set) and the full edit
 * panel opened from the day's list (any field). Fields left `undefined` are
 * unchanged; `null` explicitly clears an optional field.
 *
 * A time correction re-derives BOTH `occurred_at` and `local_date` — the
 * same deliberate exception to "local_date is frozen at insert" that
 * `features/feeding/repository.ts#editFeed` documents: an explicit
 * correction, not passive drift.
 */
export async function editDiaper(
  db: AbstractPowerSyncDatabase,
  diaperId: string,
  input: DiaperEditInput,
): Promise<void> {
  const diaper = await loadDiaperById(db, diaperId);
  if (!diaper) {
    return;
  }

  let occurredAt = diaper.occurred_at;
  let localDate = diaper.local_date;
  if (input.time) {
    const combined = combineLocalDateAndTime(diaper.local_date, input.time, diaper.tz);
    if (combined) {
      occurredAt = combined;
      localDate = toLocalDate(combined, diaper.tz);
    }
  }

  const kind = input.kind ?? diaper.kind;
  const consistency = input.consistency !== undefined ? input.consistency : diaper.consistency;
  const color = input.color !== undefined ? input.color : diaper.color;
  const leaked = input.leaked ?? diaper.leaked;

  await db.execute(
    `UPDATE diapers
        SET occurred_at = ?, local_date = ?, kind = ?, consistency = ?, color = ?, leaked = ?, updated_at = ?
      WHERE id = ?`,
    [occurredAt, localDate, kind, consistency, color, leaked, nowUtcIso(), diaperId],
  );
}

/** Soft-deletes a diaper entry, mirroring the convention used by every other table. */
export async function softDeleteDiaper(
  db: AbstractPowerSyncDatabase,
  diaperId: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE diapers SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    diaperId,
  ]);
}

/** Reactive: every diaper entry of one local calendar day (`local_date`, YYYY-MM-DD), oldest first. */
export function useDiapersOfDay(
  childId: string | undefined,
  localDate: string | undefined,
): { diapers: DiaperRow[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<DiaperRow>(
    `SELECT ${DIAPER_COLUMNS} FROM diapers
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return { diapers: data ?? [], isLoading };
}
