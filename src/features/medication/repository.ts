/**
 * medication — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for
 * medications. No timer, no multi-device conflict — a dose is logged once,
 * corrected or soft-deleted afterwards, same shape as diaper/repository.ts.
 * The date/time and favorite math is pure logic in ./logic; this module is
 * the thin, device-facing layer that calls it and writes the result back.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { nowUtcIso } from '@/core/time';

import { resolveGabeOccurredAt } from './logic';
import type { MedicationDoseUnit, MedicationRoute, MedicationRow } from './types';

/** Columns every read selects, so callers always get a complete MedicationRow. */
const MEDICATION_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  name, dose_amount, dose_unit, route, reason
`;

async function loadMedicationById(
  db: AbstractPowerSyncDatabase,
  medicationId: string,
): Promise<MedicationRow | null> {
  const rows = await db.getAll<MedicationRow>(
    `SELECT ${MEDICATION_COLUMNS} FROM medications WHERE id = ? AND deleted_at IS NULL`,
    [medicationId],
  );
  return rows[0] ?? null;
}

export type GabeEintragenInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  /** Local wall-clock date (YYYY-MM-DD) the dose was given, in `tz` — "jetzt" by default, but changeable (Nachtragen). */
  localDate: string;
  /** Local wall-clock time ("HH:mm") the dose was given, in `tz`. */
  time: string;
  note: string | null;
};

/**
 * Logs a dose — used both by a quick-button tap (`localDate`/`time` already
 * resolved to "now" by the caller) and by the "+ Neue Gabe" form (whichever
 * date/time was chosen there, possibly yesterday). `occurred_at` and
 * `local_date` are resolved together, once, via `resolveGabeOccurredAt` —
 * see that function's doc comment for why this is Regel 2's default
 * behaviour, not its correction exception. Returns the new row's id, or
 * `null` if the date/time couldn't be resolved (malformed input — the form
 * validates before calling this, so reaching here would mean a UI bug).
 */
export async function gabeEintragen(
  db: AbstractPowerSyncDatabase,
  input: GabeEintragenInput,
): Promise<string | null> {
  const resolved = resolveGabeOccurredAt(input.localDate, input.time, input.tz);
  if (!resolved) {
    return null;
  }

  const id = newId();
  const now = nowUtcIso();

  await db.execute(
    `INSERT INTO medications (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       name, dose_amount, dose_unit, route, reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.householdId,
      input.childId,
      resolved.occurredAtUtcIso,
      input.tz,
      resolved.localDate,
      input.userId,
      now,
      now,
      null,
      null,
      input.note,
      input.name,
      input.doseAmount,
      input.doseUnit,
      input.route,
      null,
    ],
  );

  return id;
}

export type GabeAendernInput = {
  /** New local wall-clock date + time, in the entry's own `tz` — both or neither; a lone field is ignored. */
  localDate?: string;
  time?: string;
  name?: string;
  doseAmount?: number | null;
  doseUnit?: MedicationDoseUnit | null;
  route?: MedicationRoute | null;
  /** `null` clears the note; `undefined` leaves it unchanged. */
  note?: string | null;
};

/**
 * Applies a correction to an existing entry — the same panel serves both
 * "add details right after logging" (only some fields set) and the full
 * edit opened from the day's list (any field), same convention as
 * diaper/repository.ts#editDiaper. A date/time change re-derives BOTH
 * `occurred_at` and `local_date` via `resolveGabeOccurredAt` — the
 * deliberate Architekturregel 2 exception, since this IS an explicit
 * correction of an already-stored row (unlike ./logic.ts#resolveGabeOccurredAt's
 * OWN doc comment, which describes the creation path).
 */
export async function gabeAendern(
  db: AbstractPowerSyncDatabase,
  medicationId: string,
  input: GabeAendernInput,
): Promise<void> {
  const medication = await loadMedicationById(db, medicationId);
  if (!medication) {
    return;
  }

  let occurredAt = medication.occurred_at;
  let localDate = medication.local_date;
  if (input.localDate && input.time) {
    const resolved = resolveGabeOccurredAt(input.localDate, input.time, medication.tz);
    if (resolved) {
      occurredAt = resolved.occurredAtUtcIso;
      localDate = resolved.localDate;
    }
  }

  const name = input.name ?? medication.name;
  const doseAmount = input.doseAmount !== undefined ? input.doseAmount : medication.dose_amount;
  const doseUnit = input.doseUnit !== undefined ? input.doseUnit : medication.dose_unit;
  const route = input.route !== undefined ? input.route : medication.route;
  const note = input.note !== undefined ? input.note : medication.note;

  await db.execute(
    `UPDATE medications
        SET occurred_at = ?, local_date = ?, name = ?, dose_amount = ?, dose_unit = ?, route = ?, note = ?, updated_at = ?
      WHERE id = ?`,
    [occurredAt, localDate, name, doseAmount, doseUnit, route, note, nowUtcIso(), medicationId],
  );
}

/** Soft-deletes a medication entry, mirroring the convention used by every other table. */
export async function gabeLoeschen(db: AbstractPowerSyncDatabase, medicationId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE medications SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    medicationId,
  ]);
}

/** Reactive: every dose of one local calendar day (`local_date`, YYYY-MM-DD), oldest first. */
export function useGabenDesTages(
  childId: string | undefined,
  localDate: string | undefined,
): { gaben: MedicationRow[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<MedicationRow>(
    `SELECT ${MEDICATION_COLUMNS} FROM medications
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return { gaben: data ?? [], isLoading };
}

/**
 * Reactive: a child's full medication history, newest first — feeds
 * `favoritenAusVerlauf` (logic.ts). Deliberately includes soft-deleted rows:
 * `favoritenAusVerlauf` does its OWN deleted_at filtering (task requirement,
 * and independently tested), so this is what actually exercises that rule
 * at runtime instead of leaving it as dead code behind a redundant SQL
 * filter.
 */
export function useGabenHistorie(childId: string | undefined): MedicationRow[] {
  const { data } = useQuery<MedicationRow>(
    `SELECT ${MEDICATION_COLUMNS} FROM medications
      WHERE child_id = ?
      ORDER BY occurred_at DESC`,
    [childId ?? ''],
  );
  return data ?? [];
}
