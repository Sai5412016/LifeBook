/**
 * medication-plan/reconcile — the pure half of the reminder reconciler (task
 * 2026-10-17): "which plan notifications SHOULD this phone have" and "what
 * has to change to get there". ./notifications.ts (device code) only carries
 * the result out. No Expo / React Native import, so it runs under Vitest.
 *
 * WHY A RECONCILER, NOT "SCHEDULE WHEN SAVED"
 * --------------------------------------------
 * A plan is created on ONE phone and reaches the other through PowerSync.
 * The other phone never runs the plan form, so anything tied to saving would
 * never ring there. The reconciler instead derives the wanted notifications
 * from the LOCAL `reminders` rows every time — no matter who wrote them, on
 * which device — and is run on app start, on returning to the foreground and
 * whenever those rows change (the live query also fires for rows that just
 * arrived by sync). See components/plan-reminders-effect.tsx.
 *
 * IDEMPOTENT BY CONSTRUCTION
 * --------------------------
 * Every notification has a deterministic id (`medplan:<planId>:<day>`) and a
 * signature (fire time + texts). reconcileReminders compares what is
 * scheduled with what is wanted and returns only the difference: running it
 * twice in a row returns nothing to do the second time, so starting the app
 * five times never leaves five notifications for the same dose.
 */

import type { MedicationTodayEntry } from '@/features/medication/logic';

import { planFromReminderRow } from './logic';
import { givenPlanIds, isPlanNotificationId, planReminders } from './schedule';
import type { PlannedReminder } from './schedule';
import type { MedicationPlan, ReminderRow } from './types';

/** What the phone reports for one scheduled notification of ours. */
export type ScheduledSnapshot = { identifier: string; signature: string | null };

/** Changes when anything the person would notice changes: the moment, the title or the text. */
export function reminderSignature(reminder: Pick<PlannedReminder, 'fireAtUtcIso' | 'title' | 'body'>): string {
  return `${reminder.fireAtUtcIso}|${reminder.title}|${reminder.body}`;
}

/** Rows of `reminders` that are live medication plans — foreign `reminders` rows are never touched (CLAUDE.md Fallstrick 17). */
export function plansFromRows(rows: readonly ReminderRow[], fallbackTz: string): MedicationPlan[] {
  return rows
    .map((row) => planFromReminderRow(row, fallbackTz))
    .filter((plan): plan is MedicationPlan => plan !== null);
}

export type WantedRemindersInput = {
  /** Every local `reminders` row of the household — not only the child on screen. */
  rows: readonly ReminderRow[];
  /** Today's doses (all children); `child_id` keeps one child's dose from silencing another child's plan. */
  todaysDoses: readonly (MedicationTodayEntry & { child_id?: string })[];
  childNames: ReadonlyMap<string, string>;
  todayLocalDate: string;
  nowUtcIso: string;
  deviceTz: string;
  /** The per-device switch "Erinnerungen auf diesem Handy". Off = nothing is wanted. */
  remindersEnabled: boolean;
  horizonDays?: number;
};

/** The notifications this phone should have right now (paused, deleted, silent and already-given plans excluded). */
export function wantedReminders(input: WantedRemindersInput): PlannedReminder[] {
  if (!input.remindersEnabled) {
    return [];
  }
  const plans = plansFromRows(input.rows, input.deviceTz);
  return planReminders({
    plans,
    childFirstName: '',
    childNames: input.childNames,
    todayLocalDate: input.todayLocalDate,
    nowUtcIso: input.nowUtcIso,
    deviceTz: input.deviceTz,
    givenTodayPlanIds: givenPlanIds(plans, input.todaysDoses, input.todayLocalDate),
    horizonDays: input.horizonDays,
  });
}

export type ReconcilePlan = {
  /** Identifiers to cancel: ours that are no longer wanted, or wanted with a different moment/text. */
  cancel: string[];
  /** Reminders to (re)schedule: wanted and missing, or changed. */
  schedule: PlannedReminder[];
};

/**
 * The difference between what is scheduled and what is wanted. Only ever
 * touches identifiers with our prefix — every other notification of the app
 * (or of a future feature) is left alone.
 */
export function reconcileReminders(
  scheduled: readonly ScheduledSnapshot[],
  wanted: readonly PlannedReminder[],
): ReconcilePlan {
  const wantedById = new Map(wanted.map((reminder) => [reminder.identifier, reminder]));
  // Grouped by id: cancelling an id removes every notification with it, so a
  // (theoretical) duplicate must be cancelled AND scheduled again once,
  // never "kept once, cancelled once".
  const signaturesById = new Map<string, (string | null)[]>();
  for (const entry of scheduled) {
    if (isPlanNotificationId(entry.identifier)) {
      signaturesById.set(entry.identifier, [...(signaturesById.get(entry.identifier) ?? []), entry.signature]);
    }
  }

  const keep = new Set<string>();
  const cancel: string[] = [];
  for (const [identifier, signatures] of signaturesById) {
    const target = wantedById.get(identifier);
    if (target && signatures.length === 1 && signatures[0] === reminderSignature(target)) {
      keep.add(identifier);
    } else {
      // Not wanted any more, changed (time, dose, name), or duplicated.
      cancel.push(identifier);
    }
  }

  const schedule = wanted.filter((reminder) => !keep.has(reminder.identifier));
  return { cancel, schedule };
}
