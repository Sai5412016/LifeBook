/**
 * sleep/timer — pure logic for sleep tracking: segment duration, the day's
 * tally, awake time since the last sleep, and display formatting.
 * Deliberately free of any Expo / React Native / PowerSync import so it runs
 * in plain Node under Vitest; the device- and database-touching side lives
 * in ./repository.
 *
 * Unlike feeding, a sleep entry has no pause/resume — `occurred_at` IS the
 * start of the (only) live segment, and `ended_at` is null while running.
 * Multi-device conflict resolution and runaway detection for sleep are the
 * shared primitives in core/tracking/running-conflicts, used directly by
 * ./repository and the UI (sleep needs no feature-specific wrapper the way
 * feeding does, since there is no duration banking to add on top).
 */

import { formatDuration, secondsBetween } from '@/core/time';

import type { SleepLocation } from './types';

/** The subset of a sleep row the duration math needs. */
export type SleepTimerState = {
  occurred_at: string;
  ended_at: string | null;
};

/**
 * Elapsed seconds of a sleep segment, live if still running (`ended_at`
 * null): the seconds since `occurred_at` up to `jetzt`. Once ended, it is
 * just the stored span — no live delta.
 */
export function sleepDurationSeconds(sleep: SleepTimerState, jetzt: string): number {
  return secondsBetween(sleep.occurred_at, sleep.ended_at ?? jetzt);
}

/** German label for a sleep location. */
export function describeSleepLocation(location: SleepLocation): string {
  switch (location) {
    case 'bed':
      return 'Bett';
    case 'stroller':
      return 'Kinderwagen';
    case 'arms':
      return 'Arm';
    case 'car':
      return 'Auto';
    case 'other':
      return 'Sonstiger Ort';
  }
}

export type SleepDaySummary = { totalSeconds: number; count: number };

/**
 * Tally for the day: total sleep (a still-running segment counts its live
 * elapsed time up to `jetzt`) and how many segments made it up.
 */
export function summarizeSleepOfDay(
  sleeps: readonly SleepTimerState[],
  jetzt: string,
): SleepDaySummary {
  let totalSeconds = 0;
  for (const sleep of sleeps) {
    totalSeconds += sleepDurationSeconds(sleep, jetzt);
  }
  return { totalSeconds, count: sleeps.length };
}

/** "Heute: 14 h 20 min in 7 Abschnitten" — the daily tally, German-pluralized. */
export function formatSleepSummaryLabel(summary: SleepDaySummary): string {
  const unit = summary.count === 1 ? 'Abschnitt' : 'Abschnitten';
  return `Heute: ${formatDuration(summary.totalSeconds)} in ${summary.count} ${unit}`;
}

/** "Schläft seit 42 min" — time since a running sleep started. */
export function formatSleepingSince(occurredAtUtcIso: string, jetzt: string): string {
  return `Schläft seit ${formatDuration(secondsBetween(occurredAtUtcIso, jetzt))}`;
}

/** "Wach seit 1 h 10 min" — time since the last sleep ended. */
export function formatAwakeSince(lastSleepEndedAtUtcIso: string, jetzt: string): string {
  return `Wach seit ${formatDuration(secondsBetween(lastSleepEndedAtUtcIso, jetzt))}`;
}
