/**
 * feeding — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for feeds.
 * The timer math itself (elapsed time, multi-device conflict resolution,
 * runaway detection) is pure logic in ./timer — this module is the thin,
 * device-facing layer that loads rows, calls that logic, and writes the
 * result back.
 *
 * RUNNING-TIMER CONFLICT RESOLUTION (Spec §6.2, needs_review deviation — see
 * core/db/schema.ts)
 * -------------------------------------------------------------------------
 * Two devices can each start a timer for the same child before either has
 * synced the other's row, leaving more than one `is_running = 1` feed. Every
 * place that makes a feed start running (`startBreastFeed`, `resumeFeed`)
 * resolves that first: the earliest `occurred_at` (tie-broken by the smaller
 * `id` — see ./timer for why not `localeCompare`) is kept running, and every
 * other running feed is finalized with its elapsed time banked and
 * `needs_review = 1` — never deleted, so a parent can correct it later.
 */

import { usePowerSync, useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { useEffect } from 'react';

import { newId } from '@/core/db/ids';
import { nowUtcIso, toLocalDate } from '@/core/time';

import {
  elapsedSeconds,
  hasUnresolvedRunningConflict,
  resolveBreastFeedType,
  resolveRunningConflicts,
} from './timer';
import type { FeedConflictCandidate } from './timer';
import type { BottleKind, FeedRow, FeedSide, FeedType } from './types';

/** Columns every read selects, so callers always get a complete FeedRow. */
const FEED_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  feed_type, amount_ml, duration_left_s, duration_right_s, ended_at,
  is_running, needs_review, running_side, running_since
`;

async function loadFeedById(
  db: AbstractPowerSyncDatabase,
  feedId: string,
): Promise<FeedRow | null> {
  const rows = await db.getAll<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds WHERE id = ? AND deleted_at IS NULL`,
    [feedId],
  );
  return rows[0] ?? null;
}

/**
 * Resolves any existing multi-device conflict for a child: called
 * explicitly before a new (or resumed) timer starts running, AND reactively
 * by `useRunningFeed` on every update of the running-feeds query, so a
 * second timer that only arrived via sync doesn't sit there unresolved until
 * somebody happens to press Start again.
 *
 * `hasUnresolvedRunningConflict` (pure, tested in ./timer) is the gate: an
 * already-consistent state (0 or 1 running feeds) returns before any query
 * result is even considered for a write. That guarantee has to live in pure,
 * testable code — `@powersync/react-native` cannot be imported under Vitest
 * (confirmed: it fails to resolve outside a bundler), so this function
 * itself cannot be unit-tested directly; trusting the tested pure gate is
 * what makes "no write for an already-resolved state" verifiable at all.
 */
async function applyRunningConflictResolution(
  db: AbstractPowerSyncDatabase,
  childId: string,
  now: string,
): Promise<void> {
  const running = await db.getAll<FeedConflictCandidate>(
    `SELECT id, occurred_at, duration_left_s, duration_right_s, running_side, running_since
       FROM feeds
      WHERE child_id = ? AND deleted_at IS NULL AND is_running = 1`,
    [childId],
  );

  if (!hasUnresolvedRunningConflict(running)) {
    return;
  }

  const { losers } = resolveRunningConflicts(running, now);
  if (losers.length === 0) {
    return;
  }

  await db.writeTransaction(async (tx) => {
    for (const loser of losers) {
      await tx.execute(
        `UPDATE feeds
            SET duration_left_s = ?, duration_right_s = ?, ended_at = ?,
                is_running = 0, needs_review = 1, running_side = NULL, running_since = NULL,
                updated_at = ?
          WHERE id = ?`,
        [loser.duration_left_s, loser.duration_right_s, loser.ended_at, now, loser.id],
      );
    }
  });
}

export type StartBreastFeedInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  side: FeedSide;
};

/** Starts a new running breastfeed timer on the given side. */
export async function startBreastFeed(
  db: AbstractPowerSyncDatabase,
  input: StartBreastFeedInput,
): Promise<void> {
  const now = nowUtcIso();
  await applyRunningConflictResolution(db, input.childId, now);

  const feedId = newId();
  const localDate = toLocalDate(now, input.tz);
  const feedType: FeedType = input.side === 'left' ? 'breast_left' : 'breast_right';

  await db.execute(
    `INSERT INTO feeds (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       feed_type, amount_ml, duration_left_s, duration_right_s, ended_at,
       is_running, needs_review, running_side, running_since
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feedId,
      input.householdId,
      input.childId,
      now,
      input.tz,
      localDate,
      input.userId,
      now,
      now,
      null,
      null,
      null,
      feedType,
      null,
      0,
      0,
      null,
      1,
      0,
      input.side,
      now,
    ],
  );
}

/**
 * Banks the elapsed time of the currently running side into its stored
 * total and starts a fresh live segment on the other side. A no-op if the
 * feed is not currently running.
 */
export async function switchSide(db: AbstractPowerSyncDatabase, feedId: string): Promise<void> {
  const feed = await loadFeedById(db, feedId);
  if (!feed || !feed.is_running || !feed.running_side || !feed.running_since) {
    return;
  }

  const now = nowUtcIso();
  const elapsed = elapsedSeconds(feed, now);
  const nextSide: FeedSide = feed.running_side === 'left' ? 'right' : 'left';

  await db.execute(
    `UPDATE feeds
        SET duration_left_s = ?, duration_right_s = ?, running_side = ?, running_since = ?, updated_at = ?
      WHERE id = ?`,
    [elapsed.left, elapsed.right, nextSide, now, now, feedId],
  );
}

/**
 * Stops the live segment and banks its elapsed time, but leaves the feed
 * session open (no `ended_at`) and remembers `running_side` so `resumeFeed`
 * can continue the same side without being told which one. A no-op if the
 * feed is not currently running.
 */
export async function pauseFeed(db: AbstractPowerSyncDatabase, feedId: string): Promise<void> {
  const feed = await loadFeedById(db, feedId);
  if (!feed || !feed.is_running) {
    return;
  }

  const now = nowUtcIso();
  const elapsed = elapsedSeconds(feed, now);

  await db.execute(
    `UPDATE feeds
        SET duration_left_s = ?, duration_right_s = ?, is_running = 0, running_since = NULL, updated_at = ?
      WHERE id = ?`,
    [elapsed.left, elapsed.right, now, feedId],
  );
}

/**
 * Resumes a paused feed on whichever side `pauseFeed` left it on. A no-op if
 * the feed is already running or was never started (no `running_side`).
 */
export async function resumeFeed(db: AbstractPowerSyncDatabase, feedId: string): Promise<void> {
  const feed = await loadFeedById(db, feedId);
  if (!feed || feed.is_running || !feed.running_side) {
    return;
  }

  const now = nowUtcIso();
  await applyRunningConflictResolution(db, feed.child_id, now);

  await db.execute(`UPDATE feeds SET is_running = 1, running_since = ?, updated_at = ? WHERE id = ?`, [
    now,
    now,
    feedId,
  ]);
}

/**
 * Ends a feed: banks any still-running elapsed time, clears the running
 * state, stamps `ended_at`, and — for a breastfeed — recomputes `feed_type`
 * from the final left/right split (never touches a bottle feed's type).
 */
export async function endFeed(db: AbstractPowerSyncDatabase, feedId: string): Promise<void> {
  const feed = await loadFeedById(db, feedId);
  if (!feed) {
    return;
  }

  const now = nowUtcIso();
  const elapsed = feed.is_running
    ? elapsedSeconds(feed, now)
    : { left: feed.duration_left_s ?? 0, right: feed.duration_right_s ?? 0 };
  const feedType = feed.feed_type.startsWith('breast_')
    ? resolveBreastFeedType(elapsed.left, elapsed.right)
    : feed.feed_type;

  await db.execute(
    `UPDATE feeds
        SET duration_left_s = ?, duration_right_s = ?, is_running = 0,
            running_side = NULL, running_since = NULL, ended_at = ?, feed_type = ?, updated_at = ?
      WHERE id = ?`,
    [elapsed.left, elapsed.right, now, feedType, now, feedId],
  );
}

/**
 * Clears a feed's review flag without changing anything else — "the
 * conflict is fine as recorded, just stop asking".
 */
export async function acknowledgeReviewFlag(
  db: AbstractPowerSyncDatabase,
  feedId: string,
): Promise<void> {
  await db.execute('UPDATE feeds SET needs_review = 0, updated_at = ? WHERE id = ?', [
    nowUtcIso(),
    feedId,
  ]);
}

/**
 * Corrects a flagged feed's per-side durations (a parent fixing what
 * conflict resolution banked) and clears the review flag. Recomputes
 * `feed_type` from the corrected split for a breastfeed; leaves a bottle
 * feed's type untouched.
 */
export async function correctFeedDurations(
  db: AbstractPowerSyncDatabase,
  feedId: string,
  input: { durationLeftS: number; durationRightS: number },
): Promise<void> {
  const feed = await loadFeedById(db, feedId);
  if (!feed) {
    return;
  }

  const feedType = feed.feed_type.startsWith('breast_')
    ? resolveBreastFeedType(input.durationLeftS, input.durationRightS)
    : feed.feed_type;

  await db.execute(
    `UPDATE feeds
        SET duration_left_s = ?, duration_right_s = ?, feed_type = ?, needs_review = 0, updated_at = ?
      WHERE id = ?`,
    [input.durationLeftS, input.durationRightS, feedType, nowUtcIso(), feedId],
  );
}

export type LogBottleInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  amountMl: number;
  kind: BottleKind;
};

/** Logs a completed bottle feed immediately — no timer involved. */
export async function logBottle(db: AbstractPowerSyncDatabase, input: LogBottleInput): Promise<void> {
  const now = nowUtcIso();
  const localDate = toLocalDate(now, input.tz);
  const feedId = newId();
  const feedType: FeedType = input.kind === 'breastmilk' ? 'bottle_breastmilk' : 'bottle_formula';

  await db.execute(
    `INSERT INTO feeds (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       feed_type, amount_ml, duration_left_s, duration_right_s, ended_at,
       is_running, needs_review, running_side, running_since
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feedId,
      input.householdId,
      input.childId,
      now,
      input.tz,
      localDate,
      input.userId,
      now,
      now,
      null,
      null,
      null,
      feedType,
      input.amountMl,
      null,
      null,
      now,
      0,
      0,
      null,
      null,
    ],
  );
}

/**
 * Reactive: the feed currently running for a child, if any.
 *
 * Also the reactive half of running-timer conflict resolution: every time
 * this query's result changes (a manual action on this device, or a row
 * arriving from sync), it checks whether more than one feed is running and,
 * if so, resolves it — see `applyRunningConflictResolution`. The ordering
 * here (earliest `occurred_at`, tied-broken by `id`) matches
 * `resolveRunningConflicts`'s winner exactly, so the row returned as `feed`
 * is correct even in the brief window before an unresolved conflict's write
 * has landed.
 */
export function useRunningFeed(childId: string | undefined): {
  feed: FeedRow | undefined;
  isLoading: boolean;
} {
  const db = usePowerSync();
  const { data, isLoading } = useQuery<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds
      WHERE child_id = ? AND deleted_at IS NULL AND is_running = 1
      ORDER BY occurred_at ASC, id ASC`,
    [childId ?? ''],
  );

  useEffect(() => {
    if (!childId || !hasUnresolvedRunningConflict(data)) {
      return;
    }
    applyRunningConflictResolution(db, childId, nowUtcIso()).catch((error) => {
      console.error('[LifeBook] Timer-Konflikt konnte nicht aufgelöst werden', error);
    });
  }, [db, childId, data]);

  return { feed: data?.[0], isLoading };
}

/**
 * Reactive: the feed session still open (started, not yet ended) for a
 * child — running OR paused. `ended_at IS NULL` alone distinguishes this
 * from both a finished breastfeed and a bottle feed (`logBottle` sets
 * `ended_at` immediately, since there is no timer to keep open). This is
 * what a screen uses to decide "show the timer controls" vs "show the three
 * start buttons" — `useRunningFeed` above answers a narrower question (is
 * something *actively ticking*, for conflict resolution), which a paused
 * feed deliberately does not match.
 */
export function useOpenFeed(childId: string | undefined): {
  feed: FeedRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds
      WHERE child_id = ? AND deleted_at IS NULL AND ended_at IS NULL
      ORDER BY occurred_at ASC, id ASC
      LIMIT 1`,
    [childId ?? ''],
  );
  return { feed: data?.[0], isLoading };
}

/** Reactive: the most recently completed feed for a child (used for "vor 2 h 15 min" etc). */
export function useLastCompletedFeed(childId: string | undefined): {
  feed: FeedRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds
      WHERE child_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [childId ?? ''],
  );
  return { feed: data?.[0], isLoading };
}

/** Reactive: every feed of one local calendar day (`local_date`, YYYY-MM-DD), oldest first. */
export function useFeedsOfDay(
  childId: string | undefined,
  localDate: string | undefined,
): { feeds: FeedRow[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return { feeds: data ?? [], isLoading };
}

/** Reactive: feeds still flagged from a running-timer conflict, newest first. */
export function useFeedsNeedingReview(childId: string | undefined): FeedRow[] {
  const { data } = useQuery<FeedRow>(
    `SELECT ${FEED_COLUMNS} FROM feeds
      WHERE child_id = ? AND deleted_at IS NULL AND needs_review = 1
      ORDER BY occurred_at DESC`,
    [childId ?? ''],
  );
  return data ?? [];
}
