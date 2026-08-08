/**
 * core/time — UTC + IANA timezone helpers (Master-Spec §7).
 *
 * Rules:
 * - All instants are stored as ISO-8601 UTC.
 * - `local_date` is derived once at insert from `occurred_at` + `tz` and NEVER
 *   recomputed, so "the night of the 3rd" stays stable across moves / DST.
 * - The dashboard "day" runs 06:00 → 06:00 local (configurable). An event at
 *   02:00 belongs to the previous calendar day.
 *
 * These functions are PURE: the timezone is always passed in, never read from the
 * device here. Device timezone access lives in ./device.ts (imports expo), so this
 * module stays unit-testable in plain Node. No `new Date()` leaks into feature code —
 * this module is the single allowed place for time construction.
 */

import { differenceInCalendarDays, parseISO, subHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/** Current instant as ISO-8601 UTC. */
export const nowUtcIso = (): string => new Date().toISOString();

/** Any Date → ISO-8601 UTC string. */
export const toUtcIso = (date: Date): string => date.toISOString();

/**
 * Derive the DST-safe local calendar date (YYYY-MM-DD) of a UTC instant in `tz`.
 * Use this to fill `local_date` at insert time.
 */
export const toLocalDate = (occurredAtUtcIso: string, tz: string): string =>
  formatInTimeZone(parseISO(occurredAtUtcIso), tz, 'yyyy-MM-dd');

/**
 * The dashboard day a UTC instant belongs to, given a day-start hour (default 06:00
 * local). Events before the day-start hour roll into the previous calendar day.
 *
 * Implemented by shifting the instant back by `dayStartHour` and taking the local
 * date in `tz`: 02:00 local − 6h → previous evening → previous date; 06:00 local −
 * 6h → local midnight → same date.
 */
export const toDashboardDate = (
  occurredAtUtcIso: string,
  tz: string,
  dayStartHour = 6,
): string =>
  formatInTimeZone(subHours(parseISO(occurredAtUtcIso), dayStartHour), tz, 'yyyy-MM-dd');

/**
 * Age in whole days of an event relative to birth, evaluated in `tz`.
 * 0 on the birth day (matches Spec §8 `differenceInCalendarDays`).
 * Reduced to local date strings first so DST transitions can't shift the count.
 */
export const ageInDays = (
  eventUtcIso: string,
  birthUtcIso: string,
  tz: string,
): number =>
  differenceInCalendarDays(
    parseISO(toLocalDate(eventUtcIso, tz)),
    parseISO(toLocalDate(birthUtcIso, tz)),
  );
