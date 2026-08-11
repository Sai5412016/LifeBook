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

import { differenceInCalendarDays, differenceInSeconds, parseISO, subHours } from 'date-fns';
import { de } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** Current instant as ISO-8601 UTC. */
export const nowUtcIso = (): string => new Date().toISOString();

/**
 * Parse an EXIF capture timestamp into ISO-8601 UTC.
 *
 * EXIF writes `YYYY:MM:DD HH:MM:SS` with NO timezone — it is the wall clock the
 * camera showed. We interpret it in `tz`, which is correct for the overwhelmingly
 * common case (photos taken where the family lives) and wrong only for pictures
 * imported after travelling. That beats the alternative of treating the wall
 * clock as UTC, which would shift every German summer photo by two hours and put
 * late-evening pictures on the wrong day.
 *
 * Returns null for a missing, malformed or impossible timestamp so callers can
 * fall back to another date rather than storing a bogus instant.
 */
export const exifWallClockToUtcIso = (
  raw: string | null | undefined,
  tz: string,
): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;

  try {
    const instant = fromZonedTime(
      `${year}-${month}-${day}T${hour}:${minute}:${second}`,
      tz,
    );
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  } catch {
    // Unknown IANA zone id — no sensible instant can be derived.
    return null;
  }
};

/** Any Date → ISO-8601 UTC string. */
export const toUtcIso = (date: Date): string => date.toISOString();

/**
 * German day heading for a stored `local_date` (YYYY-MM-DD), e.g.
 * "Mittwoch, 5. August 2026".
 *
 * Takes the already-localised date string rather than an instant, so no timezone
 * maths happens here and the label can never disagree with the grouping.
 */
export const formatDayLabel = (localDate: string): string => {
  const match = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return localDate;
  }
  const [, year, month, day] = match;
  // Constructed at UTC noon and formatted in UTC: no offset can shift the day.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  return formatInTimeZone(date, 'UTC', 'EEEE, d. MMMM yyyy', { locale: de });
};

/** Wall-clock time of a UTC instant in `tz`, e.g. "14:32" — for event-list rows. */
export const formatTimeLabel = (occurredAtUtcIso: string, tz: string): string =>
  formatInTimeZone(parseISO(occurredAtUtcIso), tz, 'HH:mm');

/**
 * Combines a calendar date (YYYY-MM-DD) and wall-clock time (HH:mm) in `tz`
 * into a UTC instant — the inverse of `formatTimeLabel`/`toLocalDate`
 * together. For correcting an event's start time: the caller supplies the
 * date the event is currently filed under and only the clock time changes,
 * mirroring what a "Uhrzeit" field can actually edit.
 *
 * Returns null for a malformed date/time or an unknown IANA zone, so callers
 * can reject the edit instead of storing a bogus instant.
 */
export const combineLocalDateAndTime = (
  localDate: string,
  time: string,
  tz: string,
): string | null => {
  const match = `${localDate}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match;

  try {
    const instant = fromZonedTime(`${year}-${month}-${day}T${hour}:${minute}:00`, tz);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  } catch {
    // Unknown IANA zone id — no sensible instant can be derived.
    return null;
  }
};

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
 * Whole seconds from `fromUtcIso` to `toUtcIso` (negative when `to` is
 * earlier than `from`). Both instants are UTC, so — unlike calendar-day math
 * — this needs no timezone and is never affected by a DST transition
 * happening to fall in between: a running timer's elapsed time is a real
 * duration, not a calendar concept.
 */
export const secondsBetween = (fromUtcIso: string, toUtcIso: string): number =>
  differenceInSeconds(parseISO(toUtcIso), parseISO(fromUtcIso));

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
