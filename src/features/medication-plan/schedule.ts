/**
 * medication-plan/schedule — pure planning of the local reminders (task
 * 2026-10-09, Teil C). Decides WHICH notifications should exist right now;
 * ./notifications.ts (device code, expo-notifications) makes the phone match
 * that list. No Expo / React Native import here, so it runs under Vitest.
 *
 * The rules, all of them testable below:
 *  - only plans that are on, due that day, and have a reminder wanted;
 *  - a bounded window (the next 14 days), recomputed at app start and after
 *    every change — never an open-ended series;
 *  - the reminder for TODAY disappears once the medicine is already entered
 *    today (also when the other phone entered it, as soon as that has synced);
 *  - nothing for a moment that already passed;
 *  - the text never names a dose to give beyond the plan's own dose and never
 *    suggests catching up: it only asks "schon gegeben?".
 */

import { addDaysToLocalDate, combineLocalDateAndTime, secondsBetween } from '@/core/time';
import type { MedicationTodayEntry } from '@/features/medication/logic';

import { gabeFuerPlan, formatPlanDose, isPlanDueOn } from './logic';
import type { MedicationPlan } from './types';

/** How many days ahead notifications are scheduled (today + 13 more). */
export const SCHEDULE_HORIZON_DAYS = 14;

/** Identifier prefix of every notification this feature schedules — and the only ones it ever cancels. */
export const NOTIFICATION_ID_PREFIX = 'medplan:';

/** Moments closer than this are skipped: scheduling "now" would just fire immediately or be dropped by the OS. */
const MIN_LEAD_SECONDS = 30;

export type PlannedReminder = {
  /** Deterministic: `medplan:<planId>:<localDate>`. */
  identifier: string;
  planId: string;
  localDate: string;
  fireAtUtcIso: string;
  title: string;
  body: string;
};

export function isPlanNotificationId(identifier: string): boolean {
  return identifier.startsWith(NOTIFICATION_ID_PREFIX);
}

/** "1 Tropfen fällig - schon gegeben? Antippen zum Abhaken." / "Fällig - schon …" without a dose. */
export function formatReminderBody(plan: Pick<MedicationPlan, 'doseAmount' | 'doseUnit'>): string {
  const dose = formatPlanDose(plan);
  return `${dose ? `${dose} fällig` : 'Fällig'} - schon gegeben? Antippen zum Abhaken.`;
}

/** "Marina: Vitamin D3" (just the medicine name when the child's name is unknown). */
export function formatReminderTitle(childFirstName: string, planName: string): string {
  const child = childFirstName.trim();
  return child ? `${child}: ${planName}` : planName;
}

/**
 * Ids of the plans whose medicine has a non-deleted entry on `localDate` —
 * the input for "cancel today's reminder if it was already given".
 */
export function givenPlanIds(
  plans: readonly MedicationPlan[],
  entries: readonly MedicationTodayEntry[],
  localDate: string,
): Set<string> {
  const given = new Set<string>();
  for (const plan of plans) {
    if (gabeFuerPlan(entries, plan.name, localDate)) {
      given.add(plan.id);
    }
  }
  return given;
}

export type ReminderScheduleInput = {
  plans: readonly MedicationPlan[];
  childFirstName: string;
  /** "Today" in the DEVICE's zone. */
  todayLocalDate: string;
  nowUtcIso: string;
  /** The device's zone — the reminder time is a wall-clock time wherever the phone is. */
  deviceTz: string;
  /** Plans already given today (see givenPlanIds). Only affects `todayLocalDate`. */
  givenTodayPlanIds: ReadonlySet<string>;
  horizonDays?: number;
};

/**
 * The notifications that should be scheduled, earliest first.
 *
 * The reminder time is the plan's wall-clock time ("08:00", read in the
 * plan's own stored zone — see planFromReminderRow) applied on each due day
 * in the zone the phone is in NOW. Due-ness itself is pure calendar-day
 * counting (isPlanDueOn); the clock change on 2026-10-25 therefore moves the
 * instant by an hour (06:00Z -> 07:00Z) and nothing else.
 */
export function planReminders(input: ReminderScheduleInput): PlannedReminder[] {
  const horizon = input.horizonDays ?? SCHEDULE_HORIZON_DAYS;
  const planned: PlannedReminder[] = [];

  for (let offset = 0; offset < horizon; offset += 1) {
    const localDate = addDaysToLocalDate(input.todayLocalDate, offset);

    for (const plan of input.plans) {
      if (!plan.remind || !isPlanDueOn(plan, localDate)) {
        continue;
      }
      if (offset === 0 && input.givenTodayPlanIds.has(plan.id)) {
        continue;
      }
      const fireAtUtcIso = combineLocalDateAndTime(localDate, plan.remindTime, input.deviceTz);
      if (!fireAtUtcIso || secondsBetween(input.nowUtcIso, fireAtUtcIso) < MIN_LEAD_SECONDS) {
        continue;
      }
      planned.push({
        identifier: `${NOTIFICATION_ID_PREFIX}${plan.id}:${localDate}`,
        planId: plan.id,
        localDate,
        fireAtUtcIso,
        title: formatReminderTitle(input.childFirstName, plan.name),
        body: formatReminderBody(plan),
      });
    }
  }

  return planned.sort((a, b) => (a.fireAtUtcIso === b.fireAtUtcIso ? 0 : a.fireAtUtcIso < b.fireAtUtcIso ? -1 : 1));
}
