/**
 * medication-plan — repository (Spec §4 rule: features access data ONLY
 * through here).
 *
 * A plan entry lives in the existing `reminders` table — no migration (task
 * 2026-10-09). Verified against the live database that day: RLS on with
 * household-member read / writable-member write policies, REPLICA IDENTITY
 * FULL, in the `powersync` publication, no foreign keys or triggers, and
 * `sync-rules.yaml` lists the table. Nothing else in this app writes to
 * `reminders` yet (features/reminders is an empty stub), but the table is
 * meant for other uses too (age-based reminders, `trigger_age_days`), so:
 *
 *  - every READ keeps only rows ./logic.ts#planFromReminderRow accepts, and
 *  - every WRITE first loads the row and refuses to touch it unless it IS a
 *    medication plan — a foreign `reminders` row can neither be edited,
 *    paused nor deleted through here.
 *
 * Column mapping (task): title = medicine name; note = JSON
 * {kind:'medication_plan', dose_amount, dose_unit, route, remind};
 * repeat_rule = "FREQ=DAILY;INTERVAL=n"; trigger_at = start day + reminder
 * time as ISO-UTC; tz = device zone at creation; enabled = 1/0 (0 = paused).
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { useMemo } from 'react';

import { newId } from '@/core/db/ids';
import { nowUtcIso } from '@/core/time';

import { buildPlanRowValues, planFromReminderRow } from './logic';
import type { PlanFormValues } from './logic';
import type { MedicationPlan, ReminderRow } from './types';

const REMINDER_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  title, description, trigger_age_days, trigger_at, repeat_rule, enabled, last_fired_at
`;

/**
 * `note LIKE` only narrows what is read; whether a row really is a plan is
 * decided in JS by planFromReminderRow, which tolerates any formatting of the
 * JSON.
 */
const PLAN_ROWS_WHERE = `child_id = ? AND deleted_at IS NULL AND note LIKE '%medication_plan%'`;

/**
 * Reactive: the child's medication plans, oldest first. Rows that are not
 * valid plans (foreign `kind`, malformed JSON, unreadable rule/instant) are
 * silently left out — one bad row never hides the others.
 */
export function useMedicationPlans(
  childId: string | undefined,
  fallbackTz: string,
): { plans: MedicationPlan[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<ReminderRow>(
    `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE ${PLAN_ROWS_WHERE} ORDER BY created_at ASC, id ASC`,
    [childId ?? ''],
  );

  const plans = useMemo(
    () =>
      (data ?? [])
        .map((row) => planFromReminderRow(row, fallbackTz))
        .filter((plan): plan is MedicationPlan => plan !== null),
    [data, fallbackTz],
  );

  return { plans, isLoading };
}

/** The row, only if it exists, is alive AND is a medication plan. */
async function loadPlanRow(
  db: AbstractPowerSyncDatabase,
  planId: string,
  fallbackTz: string,
): Promise<ReminderRow | null> {
  const rows = await db.getAll<ReminderRow>(
    `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ? AND deleted_at IS NULL`,
    [planId],
  );
  const row = rows[0];
  return row && planFromReminderRow(row, fallbackTz) ? row : null;
}

export type AddPlanContext = {
  householdId: string;
  childId: string;
  userId: string;
  /** The device's zone — stored as the row's own `tz`. */
  tz: string;
};

/** Creates a plan entry. Returns its id, or `null` when the values cannot form a plan (the form validates first). */
export async function addMedicationPlan(
  db: AbstractPowerSyncDatabase,
  ctx: AddPlanContext,
  values: PlanFormValues,
): Promise<string | null> {
  const built = buildPlanRowValues(values, ctx.tz);
  if (!built) {
    return null;
  }

  const id = newId();
  const now = nowUtcIso();

  await db.execute(
    `INSERT INTO reminders (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       title, description, trigger_age_days, trigger_at, repeat_rule, enabled, last_fired_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, 1, NULL)`,
    [
      id,
      ctx.householdId,
      ctx.childId,
      built.occurred_at,
      ctx.tz,
      built.local_date,
      ctx.userId,
      now,
      now,
      built.note,
      built.title,
      built.trigger_at,
      built.repeat_rule,
    ],
  );

  return id;
}

/**
 * Applies an edit. The start instant and `local_date` are re-derived
 * TOGETHER from the new start day + time and the row's OWN stored `tz`
 * (never the device's current zone) — the Architekturregel 2 exception for
 * an explicit user correction, same shape as photos' correctPhotoOccurredAt.
 * Does not touch `enabled` (pausing is its own action). Returns false when
 * nothing was written (unknown id, not a plan, unusable values).
 */
export async function updateMedicationPlan(
  db: AbstractPowerSyncDatabase,
  planId: string,
  values: PlanFormValues,
  fallbackTz: string,
): Promise<boolean> {
  const row = await loadPlanRow(db, planId, fallbackTz);
  if (!row) {
    return false;
  }
  const built = buildPlanRowValues(values, row.tz && row.tz.length > 0 ? row.tz : fallbackTz);
  if (!built) {
    return false;
  }

  await db.execute(
    `UPDATE reminders
        SET title = ?, note = ?, repeat_rule = ?, trigger_at = ?, occurred_at = ?, local_date = ?, updated_at = ?
      WHERE id = ?`,
    [built.title, built.note, built.repeat_rule, built.trigger_at, built.occurred_at, built.local_date, nowUtcIso(), planId],
  );
  return true;
}

/** Pauses (`false`) or resumes (`true`) a plan. A paused plan is neither due nor reminded. */
export async function setMedicationPlanEnabled(
  db: AbstractPowerSyncDatabase,
  planId: string,
  enabled: boolean,
  fallbackTz: string,
): Promise<boolean> {
  const row = await loadPlanRow(db, planId, fallbackTz);
  if (!row) {
    return false;
  }
  await db.execute('UPDATE reminders SET enabled = ?, updated_at = ? WHERE id = ?', [
    enabled ? 1 : 0,
    nowUtcIso(),
    planId,
  ]);
  return true;
}

/** Removes a plan (soft delete, like every table). Already given doses are untouched. */
export async function deleteMedicationPlan(
  db: AbstractPowerSyncDatabase,
  planId: string,
  fallbackTz: string,
): Promise<boolean> {
  const row = await loadPlanRow(db, planId, fallbackTz);
  if (!row) {
    return false;
  }
  const now = nowUtcIso();
  await db.execute('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, planId]);
  return true;
}
