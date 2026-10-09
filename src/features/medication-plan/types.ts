/**
 * medication-plan — types.
 *
 * A plan entry is stored in the existing `reminders` table (no migration —
 * task 2026-10-09), told apart from any other future use of that table by
 * `note.kind === 'medication_plan'` (see ./logic.ts#parsePlanNote). This file
 * has the raw row as read back and the parsed, validated plan every other
 * module works with.
 */

import type { MedicationDoseUnit, MedicationRoute } from '@/features/medication/types';

/** A `reminders` row exactly as read from the local PowerSync database. */
export type ReminderRow = {
  id: string;
  household_id: string;
  child_id: string | null;
  occurred_at: string | null;
  tz: string | null;
  local_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
  note: string | null;
  title: string;
  description: string | null;
  trigger_age_days: number | null;
  trigger_at: string | null;
  repeat_rule: string | null;
  enabled: number;
  last_fired_at: string | null;
};

/**
 * A `reminders` row that IS a valid medication plan, with everything the app
 * needs already derived: the calendar start day and the wall-clock reminder
 * time come from `trigger_at` read in the ROW'S OWN `tz` (CLAUDE.md
 * Architekturregel 2: never the device's current zone).
 */
export type MedicationPlan = {
  id: string;
  householdId: string;
  childId: string | null;
  /** `reminders.title`. */
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  /** 1 = every day, 2 = every 2nd day, … — counted in CALENDAR days from `startLocalDate`. */
  intervalDays: number;
  /** First day of the plan, YYYY-MM-DD (`trigger_at` in the row's tz). */
  startLocalDate: string;
  /** Wall-clock reminder time "HH:mm" (`trigger_at` in the row's tz). */
  remindTime: string;
  /** Whether a reminder is wanted at all ("Erinnerung: aus" = false). */
  remind: boolean;
  /** `reminders.enabled` — false = paused: not due, no reminders. */
  enabled: boolean;
  /** The row's stored zone (or the fallback it was read with). */
  tz: string;
};
