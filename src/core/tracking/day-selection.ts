/**
 * core/tracking/day-selection — shared logic for "which day is the Alltag
 * tab currently showing" (task 2026-09-24: view and backfill any day, not
 * only today). Used both by the day-navigation header itself and by every
 * tracking section's quick-log actions, so a backdated entry defaults to
 * noon of the chosen day instead of "now". Deliberately free of any Expo /
 * React Native / PowerSync import so it runs in plain Node under Vitest —
 * like core/time, this module never constructs a `Date` of its own; every
 * comparison is plain string comparison on YYYY-MM-DD `local_date` values
 * (lexical order == chronological order for that format).
 */

import { addDaysToLocalDate, formatDayLabel, formatDayMonthLabel } from '@/core/time';

/**
 * The day-navigation header's label: "Heute · <Datum>" / "Gestern · <Datum>"
 * / just the date for anything older. `<Datum>` is `formatDayLabel`'s full
 * "Wochentag, D. Monat JAHR" form — the same label Chronik and every other
 * day heading in this app already uses, for one consistent date format
 * app-wide rather than a second, shorter one invented just for this header.
 */
export function formatDayNavigationLabel(selectedLocalDate: string, todayLocalDate: string): string {
  const dateLabel = formatDayLabel(selectedLocalDate);
  if (selectedLocalDate === todayLocalDate) {
    return `Heute · ${dateLabel}`;
  }
  if (selectedLocalDate === addDaysToLocalDate(todayLocalDate, -1)) {
    return `Gestern · ${dateLabel}`;
  }
  return dateLabel;
}

/** No future days — the header's right arrow is only live while the selected day is still before today. */
export function canGoToNextDay(selectedLocalDate: string, todayLocalDate: string): boolean {
  return selectedLocalDate < todayLocalDate;
}

/** The date picker's valid range: not before `earliestLocalDate` (the child's birth day), not after today. */
export function isSelectableDay(
  localDate: string,
  earliestLocalDate: string,
  todayLocalDate: string,
): boolean {
  return localDate >= earliestLocalDate && localDate <= todayLocalDate;
}

/**
 * The default time a quick-log write backdates to: "jetzt" (task
 * requirement: unchanged from before day selection existed) while the
 * selected day IS today, otherwise 12:00 mittags of that day. `nowTimeLabel`
 * is the caller's already-resolved "HH:mm" for the current instant
 * (`formatTimeLabel(nowUtcIso(), tz)`) — never computed in here, see file
 * header.
 */
export function defaultLogTime(
  selectedLocalDate: string,
  todayLocalDate: string,
  nowTimeLabel: string,
): string {
  return selectedLocalDate === todayLocalDate ? nowTimeLabel : '12:00';
}

/** Running entries (Stillen, Abpumpen, …) may only be STARTED on today — never backdated. */
export function canStartRunningEntry(selectedLocalDate: string, todayLocalDate: string): boolean {
  return selectedLocalDate === todayLocalDate;
}

/** "Du trägst für den 21. September nach." — shown while a PAST day is selected. */
export function formatBackfillHint(selectedLocalDate: string): string {
  return `Du trägst für den ${formatDayMonthLabel(selectedLocalDate)} nach.`;
}
