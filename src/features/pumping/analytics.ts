/**
 * pumping/analytics — the tab's whole evaluation logic, pure and testable.
 * No Expo, no React Native, no PowerSync import: runs in plain Node under
 * Vitest, per the "reine Logik von Gerätecode trennen" rule.
 *
 * GROUPED BY THE STORED `local_date`, NEVER RECOMPUTED FROM `occurred_at`
 * ------------------------------------------------------------------------
 * Every function here reads `local_date` verbatim. That field was frozen
 * once, at insert, from the timezone the session was actually recorded in
 * (repository.ts#addPumpingSession) — which is exactly what makes a 03:00
 * session stay on its own night after a move or a DST change. Deriving the
 * day here from `occurred_at` plus the device's CURRENT timezone would
 * silently re-file historic sessions the moment the family travels; that
 * is the bug the rule exists to prevent, and these functions are where it
 * would otherwise creep back in.
 *
 * A session with `amount_ml === null` counts as 0 ml: it was recorded (the
 * timer feature may create such rows later) but contributes nothing to a
 * sum. It is never treated as "no session".
 */

import { addDaysToLocalDate } from '@/core/time';

/** The only fields any evaluation here needs — deliberately narrower than `PumpingSessionRow`. */
export type PumpingAmountSession = {
  local_date: string;
  amount_ml: number | null;
};

/** One day of the chart/list: the stored day key and its summed amount. */
export type DailyTotal = {
  localDate: string;
  totalMl: number;
};

/**
 * Upper bound on how many days `dailyTotals` will ever enumerate (~5.5
 * years). Guards against a nonsensical range (a corrupted stored date, a
 * caller's arithmetic slip) turning into an unbounded loop — the screen
 * asks for 14 days.
 */
const MAX_RANGE_DAYS = 2000;

/** Sums `amount_ml` of every session filed under `localDate`. Unknown day → 0. */
export function dayTotal(sessions: readonly PumpingAmountSession[], localDate: string): number {
  let total = 0;
  for (const session of sessions) {
    if (session.local_date === localDate) {
      total += session.amount_ml ?? 0;
    }
  }
  return total;
}

/**
 * Every day from `fromLocalDate` to `toLocalDate` INCLUSIVE, oldest first,
 * with no gaps: a day nobody pumped on appears with `totalMl: 0` rather
 * than being missing. A caller can therefore render 14 rows without
 * checking which days exist — and an empty day is visibly an empty day,
 * not an absent one.
 *
 * An inverted range (`from` after `to`) yields an empty list rather than
 * counting backwards forever.
 */
export function dailyTotals(
  sessions: readonly PumpingAmountSession[],
  fromLocalDate: string,
  toLocalDate: string,
): DailyTotal[] {
  if (fromLocalDate > toLocalDate) {
    return [];
  }

  // One pass over the sessions, then a lookup per day — so the cost stays
  // linear in sessions + days even when a range is long.
  const totals = new Map<string, number>();
  for (const session of sessions) {
    totals.set(session.local_date, (totals.get(session.local_date) ?? 0) + (session.amount_ml ?? 0));
  }

  const days: DailyTotal[] = [];
  let cursor = fromLocalDate;
  for (let step = 0; step < MAX_RANGE_DAYS && cursor <= toLocalDate; step += 1) {
    days.push({ localDate: cursor, totalMl: totals.get(cursor) ?? 0 });
    cursor = addDaysToLocalDate(cursor, 1);
  }
  return days;
}

/**
 * Mean daily amount over the `days`-day window ENDING ON `endLocalDate`
 * (inclusive).
 *
 * A day with no session counts as 0 ml AND still occupies a slot in the
 * denominator — "Ø 7 Tage" means "spread over seven days", not "averaged
 * over the days that happened to have an entry". Dividing only by the
 * days with entries would report a rising average on a week where less
 * was pumped on fewer days, which is precisely the wrong signal.
 *
 * Returns an exact (unrounded) value; rounding is the screen's decision.
 * `days <= 0` returns 0 rather than dividing by zero.
 */
export function rollingAverage(
  sessions: readonly PumpingAmountSession[],
  endLocalDate: string,
  days: number,
): number {
  if (days <= 0) {
    return 0;
  }
  const startLocalDate = addDaysToLocalDate(endLocalDate, -(days - 1));
  const window = dailyTotals(sessions, startLocalDate, endLocalDate);
  const sum = window.reduce((running, day) => running + day.totalMl, 0);
  return sum / days;
}
