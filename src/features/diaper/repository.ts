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
import { combineLocalDateAndTime, nowUtcIso, resolveLogOccurredAt, toLocalDate } from '@/core/time';

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
  /**
   * Explicit local date + time to log at instead of "jetzt" — Alltag's day
   * selector, for backdating (Nachtragen) to a past day. Omitted (or a
   * malformed pair) falls back to `nowUtcIso()`, exactly the previous
   * behaviour — see core/time#resolveLogOccurredAt.
   */
  localDate?: string;
  time?: string;
};

export type LoggedDiaper = { id: string; occurredAtUtcIso: string; localDate: string };

/**
 * Logs a diaper change immediately, with no details — the common case that
 * must work one-handed without a follow-up question. Returns the new row's
 * id (plus the resolved occurred_at/local_date, for schnelleingabe's
 * snackbar — task 2026-09-23) so the caller can offer to add details right
 * after, without a second query.
 */
export async function logDiaper(
  db: AbstractPowerSyncDatabase,
  input: LogDiaperInput,
): Promise<LoggedDiaper> {
  const { occurredAtUtcIso, localDate } = resolveLogOccurredAt(
    input.tz,
    input.localDate && input.time ? { localDate: input.localDate, time: input.time } : undefined,
  );
  const now = nowUtcIso();
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
      occurredAtUtcIso,
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

  return { id: diaperId, occurredAtUtcIso, localDate };
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

/**
 * Reactive: every diaper entry with `local_date` in [fromLocalDate,
 * toLocalDate] (inclusive) — feeds features/berichte/logic.ts#berichtBerechnen.
 * Deliberately includes soft-deleted rows: berichtBerechnen does its OWN
 * deleted_at filtering (same convention as
 * features/medication/repository.ts#useGabenHistorie), so this is what
 * actually exercises that rule at runtime instead of leaving it dead code
 * behind a redundant SQL filter.
 */
export function useDiapersInRange(
  childId: string | undefined,
  fromLocalDate: string | undefined,
  toLocalDate: string | undefined,
): DiaperRow[] {
  const { data } = useQuery<DiaperRow>(
    `SELECT ${DIAPER_COLUMNS} FROM diapers
      WHERE child_id = ? AND local_date >= ? AND local_date <= ?
      ORDER BY occurred_at ASC`,
    [childId ?? '', fromLocalDate ?? '', toLocalDate ?? ''],
  );
  return data ?? [];
}

/** One-shot: every non-deleted diaper entry since `sinceLocalDate` — CSV-Export (task requirement: die gesamte Historie seit Geburt, nicht nur der angezeigte Zeitraum). */
export async function getDiapersForExport(
  db: AbstractPowerSyncDatabase,
  childId: string,
  sinceLocalDate: string,
): Promise<DiaperRow[]> {
  return db.getAll<DiaperRow>(
    `SELECT ${DIAPER_COLUMNS} FROM diapers
      WHERE child_id = ? AND local_date >= ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId, sinceLocalDate],
  );
}
