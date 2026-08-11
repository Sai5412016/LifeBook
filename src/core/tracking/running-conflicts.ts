/**
 * core/tracking/running-conflicts — shared multi-device conflict resolution
 * for any "at most one row running per child" tracking table (feeds, sleeps,
 * pumping_sessions, …). Deliberately free of any Expo / React Native /
 * PowerSync import so it runs in plain Node under Vitest.
 *
 * Two devices can each start a timer for the same child before either has
 * synced the other's row, leaving more than one `is_running = 1` row. The
 * rule, shared by every feature that has this problem: the earliest
 * `occurred_at` wins; ties are broken by the lexicographically smaller `id`,
 * using plain string operators (`<`/`>`), never `localeCompare` —
 * `localeCompare` is locale/ICU-dependent and can rank the same two strings
 * differently on different devices, which would break the "every device
 * agrees on the same winner" requirement this module exists to satisfy.
 *
 * This module only decides WHO wins — it never banks a duration or writes
 * anything. Feature-specific consequences (feeding banks elapsed duration
 * per side; sleep just stamps `ended_at`) stay in each feature's own timer.ts
 * / repository.ts, built on top of `resolveRunningConflicts` here.
 */

import { secondsBetween } from '@/core/time';

/**
 * The minimal shape needed to pick a winner. `is_running` is optional: the
 * callers that reach this module already filtered `WHERE is_running = 1` in
 * SQL, so the field carries no additional information for the algorithm —
 * it is here only so a caller whose row type happens to include it (like
 * `SleepRow`) doesn't need to strip it before calling in.
 */
export type RunningConflictCandidate = {
  id: string;
  occurred_at: string;
  is_running?: number;
};

export type RunningConflictResolution = {
  /** id of the row allowed to keep running, or null if `candidates` was empty. */
  winnerId: string | null;
  /** Every other row's id — the caller finalizes them however its table requires. */
  loserIds: string[];
};

/**
 * True when `candidates` (all rows currently `is_running = 1` for one child)
 * actually need conflict resolution — i.e. more than one is running.
 *
 * This is the gate a reactive caller must check BEFORE calling
 * `resolveRunningConflicts` and writing anything: two devices that
 * independently notice the same already-resolved state (0 or 1 running rows)
 * and write anyway would keep bumping `updated_at` back and forth through
 * sync — a state that is already consistent must never produce a write.
 */
export function hasUnresolvedRunningConflict(candidates: readonly unknown[]): boolean {
  return candidates.length > 1;
}

/**
 * Picks which of several simultaneously "running" rows for one child is
 * allowed to keep running. See the module doc comment for the winner rule.
 * Losers are only named here — never deleted or mutated; the caller finalizes
 * them (banking a duration, stamping `ended_at`, setting `needs_review`, …).
 */
export function resolveRunningConflicts(
  candidates: readonly RunningConflictCandidate[],
): RunningConflictResolution {
  if (candidates.length === 0) {
    return { winnerId: null, loserIds: [] };
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.occurred_at < b.occurred_at) return -1;
    if (a.occurred_at > b.occurred_at) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const [winner, ...rest] = sorted;
  return { winnerId: winner.id, loserIds: rest.map((candidate) => candidate.id) };
}

/**
 * True when a running segment that started at `sinceUtcIso` has been ticking
 * for at least `thresholdHours` — the "someone forgot to stop this" case.
 * `sinceUtcIso` is whatever a feature calls the start of the current live
 * segment (feeding's `running_since`, sleep's `occurred_at` since sleep has
 * no pause/resume); `null` (nothing running) is never a runaway.
 */
export function isRunaway(sinceUtcIso: string | null, jetzt: string, thresholdHours: number): boolean {
  if (!sinceUtcIso) {
    return false;
  }
  return secondsBetween(sinceUtcIso, jetzt) >= thresholdHours * 3600;
}
