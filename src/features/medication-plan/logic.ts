/**
 * medication-plan/logic — pure logic for the fixed medication plan (task
 * 2026-10-09): reading a plan out of a `reminders` row without ever trusting
 * it, deciding on which calendar days a plan is due, and recognising that a
 * plan medicine was already given on a day. Free of any Expo / React Native
 * / PowerSync import so it runs in plain Node under Vitest
 * (Architekturregel 3); the database side lives in ./repository.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * ------------------------------
 * It never suggests a dose, never offers to "catch up" a missed day and never
 * derives anything from the time of the last dose. Due-ness is one fact: the
 * number of CALENDAR days between the plan's start day and the day asked
 * about is a multiple of the interval (isPlanDueOn). A dose that was
 * accidentally quadrupled once is the reason this stays that boring.
 */

import {
  combineLocalDateAndTime,
  daysBetweenLocalDates,
  formatDayMonthLabel,
  formatTimeLabel,
  toLocalDate,
} from '@/core/time';
import type { PushPermissionStatus } from '@/core/notifications/logic';
import {
  describeDoseUnit,
  describeMedicationRoute,
  formatDoseLabel,
} from '@/features/medication/logic';
import type { MedicationFavorite, MedicationTodayEntry } from '@/features/medication/logic';
import type { MedicationDoseUnit, MedicationRoute } from '@/features/medication/types';

import type { MedicationPlan, ReminderRow } from './types';

/** `note.kind` of a `reminders` row that belongs to this feature. */
export const PLAN_KIND = 'medication_plan';

/** What the form offers; reading accepts any whole 1..365 (see parseRepeatRule). */
export const PLAN_INTERVAL_OPTIONS: readonly number[] = [1, 2];

/** Wall-clock reminder time used when the person turns the reminder on without choosing one. */
export const DEFAULT_REMIND_TIME = '08:00';

const MAX_INTERVAL_DAYS = 365;

const DOSE_UNITS: readonly MedicationDoseUnit[] = ['ie', 'drops', 'ml', 'mg', 'spoon', 'piece'];
const ROUTES: readonly MedicationRoute[] = ['oral', 'bottle', 'other'];

export type ParsedPlanNote = {
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  remind: boolean;
};

/**
 * Accepts both the app's own enum value ("drops") and its German label
 * ("Tropfen", any casing) — the task's example JSON wrote the label, the
 * medications table stores the enum value, and a plan row must read the same
 * either way.
 */
function parseDoseUnitValue(value: unknown): MedicationDoseUnit | null | 'invalid' {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return 'invalid';
  }
  const wanted = value.trim().toLowerCase();
  for (const unit of DOSE_UNITS) {
    if (wanted === unit || wanted === describeDoseUnit(unit).toLowerCase()) {
      return unit;
    }
  }
  return 'invalid';
}

function parseRouteValue(value: unknown): MedicationRoute | null {
  if (typeof value !== 'string') {
    return null;
  }
  const wanted = value.trim().toLowerCase();
  for (const route of ROUTES) {
    if (wanted === route || wanted === describeMedicationRoute(route).toLowerCase()) {
      return route;
    }
  }
  return null;
}

function parseDoseAmountValue(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(',', '.')) : NaN;
  // A dose of zero or less is nonsense, not "no dose" — see parsePlanNote.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 'invalid';
}

/**
 * Reads `reminders.note` as a medication plan, or `null` when it is not one:
 * malformed JSON, JSON that is not an object, another `kind`, a dose that is
 * present but not a positive number, or a unit that is present but unknown.
 * NEVER throws — a broken or foreign row simply is not a plan, and the rest
 * of the list keeps working.
 *
 * Deliberately strict about the dose: an unreadable dose makes the whole
 * entry unreadable instead of quietly becoming "no dose". This app logs what
 * the plan says on one tap; guessing a dose is the one thing it must not do.
 * Route and the reminder flag are lenient (unknown route -> none; `remind`
 * missing -> true, because a plan row written exactly as specified carries a
 * reminder time and means "remind me").
 */
export function parsePlanNote(note: string | null | undefined): ParsedPlanNote | null {
  if (typeof note !== 'string' || note.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(note);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.kind !== PLAN_KIND) {
    return null;
  }

  const doseAmount = parseDoseAmountValue(record.dose_amount);
  const doseUnit = parseDoseUnitValue(record.dose_unit);
  if (doseAmount === 'invalid' || doseUnit === 'invalid') {
    return null;
  }

  return {
    doseAmount,
    doseUnit,
    route: parseRouteValue(record.route),
    remind: record.remind !== false,
  };
}

/** The JSON stored in `reminders.note`. Enum values, not labels (see parseDoseUnitValue). */
export function serializePlanNote(note: ParsedPlanNote): string {
  return JSON.stringify({
    kind: PLAN_KIND,
    dose_amount: note.doseAmount,
    dose_unit: note.doseUnit,
    route: note.route,
    remind: note.remind,
  });
}

/**
 * Interval in days from an RFC-5545 style rule: "FREQ=DAILY;INTERVAL=2" ->
 * 2, "FREQ=DAILY" -> 1. Anything else (another FREQ, INTERVAL=0, extra
 * parts, text) -> null, so a row this feature did not write is not mistaken
 * for a plan.
 */
export function parseRepeatRule(rule: string | null | undefined): number | null {
  if (typeof rule !== 'string') {
    return null;
  }
  const match = rule.trim().toUpperCase().match(/^FREQ=DAILY(?:;INTERVAL=(\d{1,3}))?$/);
  if (!match) {
    return null;
  }
  const interval = match[1] === undefined ? 1 : Number(match[1]);
  return Number.isInteger(interval) && interval >= 1 && interval <= MAX_INTERVAL_DAYS ? interval : null;
}

export function repeatRuleForInterval(intervalDays: number): string {
  return `FREQ=DAILY;INTERVAL=${intervalDays}`;
}

/** "jeden Tag" / "jeden 2. Tag" / "jeden 3. Tag". */
export function describeRhythm(intervalDays: number): string {
  return intervalDays === 1 ? 'jeden Tag' : `jeden ${intervalDays}. Tag`;
}

/** The same wording as a button label: "Jeden Tag" / "Jeden 2. Tag". */
export function describeRhythmButton(intervalDays: number): string {
  const text = describeRhythm(intervalDays);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A `reminders` row as a medication plan, or `null` when it is not one (see
 * parsePlanNote / parseRepeatRule), is soft-deleted, has no name, or has a
 * start instant / zone that cannot be read. `fallbackTz` is used only when
 * the row stores no `tz` at all.
 */
export function planFromReminderRow(row: ReminderRow, fallbackTz: string): MedicationPlan | null {
  if (row.deleted_at) {
    return null;
  }
  const note = parsePlanNote(row.note);
  const intervalDays = parseRepeatRule(row.repeat_rule);
  const name = typeof row.title === 'string' ? row.title.trim() : '';
  if (!note || intervalDays === null || name.length === 0 || !row.trigger_at) {
    return null;
  }

  const tz = row.tz && row.tz.length > 0 ? row.tz : fallbackTz;
  let startLocalDate: string;
  let remindTime: string;
  try {
    startLocalDate = toLocalDate(row.trigger_at, tz);
    remindTime = formatTimeLabel(row.trigger_at, tz);
  } catch {
    // Unparseable instant or unknown zone id.
    return null;
  }

  return {
    id: row.id,
    householdId: row.household_id,
    childId: row.child_id,
    name,
    doseAmount: note.doseAmount,
    doseUnit: note.doseUnit,
    route: note.route,
    intervalDays,
    startLocalDate,
    remindTime,
    remind: note.remind,
    enabled: Number(row.enabled) !== 0,
    tz,
  };
}

/**
 * Whether `plan` is due on `localDate` (YYYY-MM-DD): not paused, not before
 * the start day, and a whole number of intervals after it. Counted in
 * calendar days (core/time#daysBetweenLocalDates) — NOT from the last dose,
 * so a late or missed dose never shifts the rhythm, and not in hours, so the
 * 25-hour day of the clock change counts as one day.
 */
export function isPlanDueOn(plan: MedicationPlan, localDate: string): boolean {
  if (!plan.enabled) {
    return false;
  }
  try {
    const days = daysBetweenLocalDates(plan.startLocalDate, localDate);
    return days >= 0 && days % plan.intervalDays === 0;
  } catch {
    return false;
  }
}

/** The plans due on `localDate`, earliest reminder time first, then by name. */
export function duePlansOn(plans: readonly MedicationPlan[], localDate: string): MedicationPlan[] {
  return plans
    .filter((plan) => isPlanDueOn(plan, localDate))
    .sort((a, b) =>
      a.remindTime === b.remindTime ? a.name.localeCompare(b.name, 'de') : a.remindTime < b.remindTime ? -1 : 1,
    );
}

/**
 * The latest non-deleted dose of the plan's medicine on `localDate`, or null.
 * Matches on the NAME only (trimmed, case-insensitive), not on the dose: if
 * "Vitamin D3" was already given today in any amount, the plan row must show
 * "given" rather than offer an unticked box for a second dose. (The existing
 * medication/logic.ts#letzteGabeHeute also compares the dose — right for its
 * quick buttons, too lax for a checklist whose whole point is "once a day".)
 */
export function gabeFuerPlan<T extends MedicationTodayEntry>(
  entries: readonly T[],
  planName: string,
  localDate: string,
): T | null {
  const wanted = planName.trim().toLowerCase();
  let latest: T | null = null;
  for (const entry of entries) {
    if (entry.deleted_at || entry.local_date !== localDate) {
      continue;
    }
    if (entry.name.trim().toLowerCase() !== wanted) {
      continue;
    }
    if (!latest || entry.occurred_at > latest.occurred_at) {
      latest = entry;
    }
  }
  return latest;
}

/** "1 Tropfen" / "2.5 ml" / "" when the plan has no dose. */
export function formatPlanDose(plan: Pick<MedicationPlan, 'doseAmount' | 'doseUnit'>): string {
  return formatDoseLabel(plan.doseAmount, plan.doseUnit);
}

/** "Vitamin D3 · 1 Tropfen" (or just the name when there is no dose). */
export function formatPlanTitle(plan: Pick<MedicationPlan, 'name' | 'doseAmount' | 'doseUnit'>): string {
  const dose = formatPlanDose(plan);
  return dose ? `${plan.name} · ${dose}` : plan.name;
}

/** The plan as the quick-entry's `MedicationFavorite`, so the existing write path (schnellMedikament) is reused unchanged. */
export function planAsFavorite(plan: MedicationPlan): MedicationFavorite {
  return { name: plan.name, doseAmount: plan.doseAmount, doseUnit: plan.doseUnit, route: plan.route };
}

function favoriteKey(favorite: Pick<MedicationFavorite, 'name' | 'doseAmount' | 'doseUnit'>): string {
  // Same key favoritenAusVerlauf groups by.
  return `${favorite.name.trim().toLowerCase()}|${favorite.doseAmount ?? ''}|${favorite.doseUnit ?? ''}`;
}

/**
 * Favorites derived from history, minus those that are the very same
 * medicine + dose as a plan entry — the plan button already stands first,
 * a second identical one underneath would only invite a second tap.
 */
export function withoutPlanDuplicates(
  favorites: readonly MedicationFavorite[],
  plans: readonly MedicationPlan[],
): MedicationFavorite[] {
  const planKeys = new Set(plans.map((plan) => favoriteKey(planAsFavorite(plan))));
  return favorites.filter((favorite) => !planKeys.has(favoriteKey(favorite)));
}

/** Form text -> dose: "" -> null, "1,5" -> 1.5, junk or <= 0 -> 'invalid'. */
export function parsePlanDoseText(text: string): number | null | 'invalid' {
  return parseDoseAmountValue(text.trim());
}

/** "HH:mm", 00:00–23:59. */
export function isValidClockTime(time: string): boolean {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/** What the plan form hands to the repository. */
export type PlanFormValues = {
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  intervalDays: number;
  /** First day, YYYY-MM-DD, as a wall-clock date in the plan's zone. */
  startLocalDate: string;
  remind: boolean;
  /** "HH:mm". Kept even when `remind` is false, so turning the reminder back on remembers the time. */
  remindTime: string;
};

/** The `reminders` columns a plan write sets (everything else is bookkeeping the repository adds). */
export type PlanRowValues = {
  title: string;
  note: string;
  repeat_rule: string;
  trigger_at: string;
  occurred_at: string;
  local_date: string;
};

/**
 * Form values -> reminders columns, or `null` when they cannot form a plan
 * (no name, a bad start day / time, an unusable interval, an unknown zone).
 *
 * `trigger_at` = start day + reminder time read in `tz`; `occurred_at` is the
 * same instant and `local_date` is derived FROM it in the same call — the
 * one-call, one-answer shape of core/time#applyOccurredAtCorrection, so the
 * two can never be written apart. `tz` must be the plan row's own stored zone
 * on an edit (Architekturregel 2) and the device zone only on creation.
 */
export function buildPlanRowValues(values: PlanFormValues, tz: string): PlanRowValues | null {
  const name = values.name.trim();
  if (
    name.length === 0 ||
    !isValidClockTime(values.remindTime) ||
    !Number.isInteger(values.intervalDays) ||
    values.intervalDays < 1 ||
    values.intervalDays > MAX_INTERVAL_DAYS
  ) {
    return null;
  }
  if (values.doseAmount !== null && !(Number.isFinite(values.doseAmount) && values.doseAmount > 0)) {
    return null;
  }

  const triggerAt = combineLocalDateAndTime(values.startLocalDate, values.remindTime, tz);
  if (!triggerAt) {
    return null;
  }
  let localDate: string;
  try {
    localDate = toLocalDate(triggerAt, tz);
  } catch {
    return null;
  }

  return {
    title: name,
    note: serializePlanNote({
      doseAmount: values.doseAmount,
      doseUnit: values.doseUnit,
      route: values.route,
      remind: values.remind,
    }),
    repeat_rule: repeatRuleForInterval(values.intervalDays),
    trigger_at: triggerAt,
    occurred_at: triggerAt,
    local_date: localDate,
  };
}

/**
 * The per-device switch "Erinnerungen auf diesem Handy" as stored in
 * AsyncStorage: on unless it was explicitly switched off. A missing or
 * unreadable value means "on" — the documented default.
 */
export function parseRemindersSetting(stored: string | null | undefined): boolean {
  return stored !== '0';
}

export function serializeRemindersSetting(enabled: boolean): string {
  return enabled ? '1' : '0';
}

/** What the plan form must do about the notification permission before saving. */
export type PermissionStep = 'none' | 'ask' | 'denied';

/**
 * The permission is asked for ONLY when a reminder is actually being created
 * (task 2026-10-09: "erst beim ersten Anlegen einer Erinnerung erfragen, mit
 * einem Satz Begründung vorher") — never at app start by this feature.
 * 'ask' = never decided yet, explain and ask; 'denied' = the system will not
 * ask again (Android allows one refusal), tell the person where to change it.
 */
export function permissionStepForSave(remind: boolean, status: PushPermissionStatus): PermissionStep {
  if (!remind || status === 'granted') {
    return 'none';
  }
  return status === 'undetermined' ? 'ask' : 'denied';
}

/** The one sentence shown before the system dialog. */
export const PERMISSION_REASON =
  'Damit LifeBook dich zur eingestellten Uhrzeit erinnern kann, braucht es die Erlaubnis, dir Benachrichtigungen zu schicken.';

/** Shown after saving when the person declined our own "Nicht jetzt" — nothing is decided yet, the system will still be asked. */
export const PERMISSION_LATER_HINT =
  'Gespeichert. Erinnerungen kommen erst an, wenn du Benachrichtigungen erlaubst — das fragt LifeBook beim nächsten Speichern mit Erinnerung wieder.';

/** Shown after saving when the system itself has refused (it will not ask again). */
export const PERMISSION_DENIED_HINT =
  'Gespeichert. Benachrichtigungen sind für LifeBook ausgeschaltet — Erinnerungen kommen erst an, wenn du sie in den Android-Einstellungen erlaubst.';

/**
 * The plan's one-line summary for the list: everything the person set, in the
 * order they set it — "Vitamin D3 · 1 Tropfen · jeden Tag · 08:00" (without
 * the time when no reminder is wanted). Task 2026-10-09: the chosen Rhythmus
 * must be readable at a glance in the entry itself.
 */
export function describePlanListLine(
  plan: Pick<MedicationPlan, 'name' | 'doseAmount' | 'doseUnit' | 'intervalDays' | 'remind' | 'remindTime'>,
): string {
  const parts = [formatPlanTitle(plan), describeRhythm(plan.intervalDays)];
  if (plan.remind) {
    parts.push(plan.remindTime);
  }
  return parts.join(' · ');
}

/**
 * Second line of a plan row: "jeden Tag · Erinnerung 08:00",
 * "jeden 2. Tag · ohne Erinnerung", "Pausiert · jeden Tag · …", and
 * "· ab 12. Oktober" while the start day is still ahead.
 */
export function describePlanSchedule(plan: MedicationPlan, todayLocalDate: string): string {
  const parts = [describeRhythm(plan.intervalDays), plan.remind ? `Erinnerung ${plan.remindTime}` : 'ohne Erinnerung'];
  if (plan.startLocalDate > todayLocalDate) {
    parts.push(`ab ${formatDayMonthLabel(plan.startLocalDate)}`);
  }
  if (!plan.enabled) {
    parts.unshift('Pausiert');
  }
  return parts.join(' · ');
}

/**
 * What the list adds under describePlanListLine: only the states that change
 * whether the medicine shows up — "Pausiert", "ab 12. Oktober". `null` when
 * there is nothing to add (the line above already says everything).
 */
export function describePlanStatus(
  plan: Pick<MedicationPlan, 'enabled' | 'startLocalDate'>,
  todayLocalDate: string,
): string | null {
  const parts: string[] = [];
  if (!plan.enabled) {
    parts.push('Pausiert');
  }
  if (plan.startLocalDate > todayLocalDate) {
    parts.push(`ab ${formatDayMonthLabel(plan.startLocalDate)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
