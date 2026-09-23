/**
 * growth — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Read-only so far: this app has no growth-entry screen yet (out of scope
 * for the task that added these two functions, 2026-09-25 — Wochen-/
 * Monatsbericht's "Gewicht"-Abschnitt only ever READS `growth_measurements`,
 * never writes it). Same column list as `core/db/schema.ts`'s
 * `growth_measurements` table.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import type { GrowthMeasurementRow } from './types';

/** Columns every read selects, so callers always get a complete GrowthMeasurementRow. */
const GROWTH_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  weight_g, length_mm, head_circumference_mm, measured_source
`;

/**
 * Reactive: every growth measurement with `local_date` in [fromLocalDate,
 * toLocalDate] (inclusive) — feeds features/berichte/logic.ts#berichtBerechnen.
 * Deliberately includes soft-deleted rows, same convention as
 * features/medication/repository.ts#useGabenHistorie — berichtBerechnen
 * does its OWN deleted_at filtering.
 */
export function useGrowthInRange(
  childId: string | undefined,
  fromLocalDate: string | undefined,
  toLocalDate: string | undefined,
): GrowthMeasurementRow[] {
  const { data } = useQuery<GrowthMeasurementRow>(
    `SELECT ${GROWTH_COLUMNS} FROM growth_measurements
      WHERE child_id = ? AND local_date >= ? AND local_date <= ?
      ORDER BY occurred_at ASC`,
    [childId ?? '', fromLocalDate ?? '', toLocalDate ?? ''],
  );
  return data ?? [];
}

/** Reactive: every growth measurement of one local calendar day (`local_date`, YYYY-MM-DD), oldest first — features/timeline (task 2026-09-26). */
export function useGrowthOfDay(
  childId: string | undefined,
  localDate: string | undefined,
): GrowthMeasurementRow[] {
  const { data } = useQuery<GrowthMeasurementRow>(
    `SELECT ${GROWTH_COLUMNS} FROM growth_measurements
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return data ?? [];
}

/** One-shot: every non-deleted growth measurement since `sinceLocalDate` — CSV-Export (task requirement: die gesamte Historie seit Geburt). */
export async function getGrowthForExport(
  db: AbstractPowerSyncDatabase,
  childId: string,
  sinceLocalDate: string,
): Promise<GrowthMeasurementRow[]> {
  return db.getAll<GrowthMeasurementRow>(
    `SELECT ${GROWTH_COLUMNS} FROM growth_measurements
      WHERE child_id = ? AND local_date >= ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId, sinceLocalDate],
  );
}
