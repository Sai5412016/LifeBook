/**
 * medication-plan/reminder-status — what the last reconcile found on THIS
 * phone (task 2026-10-17): permission, how many plan reminders are scheduled,
 * the next one. The plan screen shows it, so a device test can tell "the plan
 * never arrived here" (empty list) from "it arrived but nothing is scheduled"
 * (list shows it, count 0, permission missing) without a debugger.
 *
 * Pure zustand state, no Expo import — written by ./notifications.ts.
 */

import { create } from 'zustand';

export type ReminderPermission = {
  status: 'granted' | 'denied' | 'undetermined';
  /** Whether the system would still show its dialog (Android: false after the second "Nicht erlauben"). */
  canAskAgain: boolean;
};

export type ReminderStatus = {
  permission: ReminderPermission | null;
  /** null = not reconciled yet in this app session. */
  scheduledCount: number | null;
  nextFireAtUtcIso: string | null;
  lastError: string | null;
};

type ReminderStatusState = ReminderStatus & { set: (patch: Partial<ReminderStatus>) => void };

export const useReminderStatusStore = create<ReminderStatusState>((set) => ({
  permission: null,
  scheduledCount: null,
  nextFireAtUtcIso: null,
  lastError: null,
  set: (patch) => set(patch),
}));

/**
 * Whether this phone should ask for the notification permission on its own
 * (task 2026-10-17, Punkt 4): only if a plan here wants a reminder, the switch
 * is on, the permission is missing, the system would still ask, and this
 * phone has not asked for it before. Once per device — never on every start.
 */
export function shouldAskForReminderPermission(input: {
  anyPlanWantsReminder: boolean;
  remindersEnabled: boolean;
  permission: ReminderPermission;
  alreadyAskedOnThisDevice: boolean;
}): boolean {
  return (
    input.anyPlanWantsReminder &&
    input.remindersEnabled &&
    input.permission.status !== 'granted' &&
    input.permission.canAskAgain &&
    !input.alreadyAskedOnThisDevice
  );
}
