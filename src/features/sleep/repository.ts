/**
 * sleep — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for
 * sleeps. Unlike feeding, a sleep segment has no pause/resume — it is either
 * running (`is_running = 1`, `ended_at` NULL) or finished — so there is no
 * per-side duration to bank and no `running_since` distinct from
 * `occurred_at`. The duration math itself is pure logic in ./timer.
 *
 * RUNNING-TIMER CONFLICT RESOLUTION — same rule as feeding (Spec §6.2,
 * needs_review deviation — see core/db/schema.ts), generalized in
 * core/tracking/running-conflicts: two devices can each start a sleep for
 * the same child before either has synced the other's row, leaving more
 * than one `is_running = 1` sleep. Every place that starts a sleep resolves
 * that first: the earliest `occurred_at` (tie-broken by the smaller `id`)
 * is kept running, and every other running sleep is finalized with
 * `ended_at = now` and `needs_review = 1` — never deleted, so a parent can
 * correct it later.
 */

import { usePowerSync, useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { useEffect } from 'react';

import { newId } from '@/core/db/ids';
import { combineLocalDateAndTime, nowUtcIso, toLocalDate } from '@/core/time';
import { hasUnresolvedRunningConflict, resolveRunningConflicts } from '@/core/tracking/running-conflicts';
import type { RunningConflictCandidate } from '@/core/tracking/running-conflicts';

import type { SleepLocation, SleepRow } from './types';

/** Columns every read selects, so callers always get a complete SleepRow. */
const SLEEP_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  ended_at, quality, location, is_running, needs_review
`;

async function loadSleepById(
  db: AbstractPowerSyncDatabase,
  sleepId: string,
): Promise<SleepRow | null> {
  const rows = await db.getAll<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleeps WHERE id = ? AND deleted_at IS NULL`,
    [sleepId],
  );
  return rows[0] ?? null;
}

/**
 * Resolves any existing multi-device conflict for a child: called
 * explicitly before a new sleep starts running, AND reactively by
 * `useRunningSleep` on every update of the running-sleep query, so a second
 * sleep that only arrived via sync doesn't sit there unresolved until
 * somebody happens to press "Schläft jetzt" again.
 *
 * `hasUnresolvedRunningConflict` (pure, tested in core/tracking) is the
 * gate: an already-consistent state (0 or 1 running sleeps) returns before
 * any query result is even considered for a write — `@powersync/react-native`
 * cannot be imported under Vitest, so this function itself cannot be
 * unit-tested directly; trusting the tested pure gate is what makes "no
 * write for an already-resolved state" verifiable at all.
 */
async function applyRunningConflictResolution(
  db: AbstractPowerSyncDatabase,
  childId: string,
  now: string,
): Promise<void> {
  const running = await db.getAll<RunningConflictCandidate>(
    `SELECT id, occurred_at FROM sleeps WHERE child_id = ? AND deleted_at IS NULL AND is_running = 1`,
    [childId],
  );

  if (!hasUnresolvedRunningConflict(running)) {
    return;
  }

  const { loserIds } = resolveRunningConflicts(running);
  if (loserIds.length === 0) {
    return;
  }

  await db.writeTransaction(async (tx) => {
    for (const loserId of loserIds) {
      await tx.execute(
        `UPDATE sleeps SET ended_at = ?, is_running = 0, needs_review = 1, updated_at = ? WHERE id = ?`,
        [now, now, loserId],
      );
    }
  });
}

export type StartSleepInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  location?: SleepLocation;
};

/**
 * Starts a new running sleep. Returns the new row's id so the caller can
 * offer the optional location chips right after, without a second query —
 * same pattern as `features/diaper/repository.ts#logDiaper`.
 */
export async function startSleep(
  db: AbstractPowerSyncDatabase,
  input: StartSleepInput,
): Promise<string> {
  const now = nowUtcIso();
  await applyRunningConflictResolution(db, input.childId, now);

  const sleepId = newId();
  const localDate = toLocalDate(now, input.tz);

  await db.execute(
    `INSERT INTO sleeps (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       ended_at, quality, location, is_running, needs_review
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sleepId,
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
      null,
      null,
      input.location ?? null,
      1,
      0,
    ],
  );

  return sleepId;
}

/** Ends the given sleep: stamps `ended_at` and clears `is_running`. A no-op if it doesn't exist. */
export async function endSleep(db: AbstractPowerSyncDatabase, sleepId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute(`UPDATE sleeps SET ended_at = ?, is_running = 0, updated_at = ? WHERE id = ?`, [
    now,
    now,
    sleepId,
  ]);
}

/**
 * Clears a sleep's review flag without changing anything else — "the
 * conflict is fine as recorded, just stop asking". Mirrors
 * `features/feeding/repository.ts#acknowledgeReviewFlag`.
 */
export async function acknowledgeSleepReviewFlag(
  db: AbstractPowerSyncDatabase,
  sleepId: string,
): Promise<void> {
  await db.execute('UPDATE sleeps SET needs_review = 0, updated_at = ? WHERE id = ?', [
    nowUtcIso(),
    sleepId,
  ]);
}

export type SleepEditInput = {
  /** New "HH:mm" start time, interpreted in the sleep's own `tz`. */
  time?: string;
  /**
   * New "HH:mm" end time, interpreted in the sleep's own `tz`. Only applied
   * if the sleep has already ended (`ended_at` not null) — an open sleep has
   * no end to correct yet.
   */
  endTime?: string;
  /** `null` clears the field; `undefined` leaves it unchanged. */
  location?: SleepLocation | null;
};

/**
 * Applies a correction to an existing sleep — start time, end time, or
 * location. Used both for the "add location" prompt right after starting
 * (only `location` set) and the full edit panel opened from the day's list
 * (any field).
 *
 * A time correction re-derives BOTH `occurred_at` and `local_date` — the
 * same deliberate exception to "local_date is frozen at insert" that
 * `features/feeding/repository.ts#editFeed` documents.
 *
 * Always clears `needs_review`: unlike feeding — where a dedicated
 * review-correction path exists because it narrowly re-banks durations —
 * sleep's review correction and its general edit touch the exact same
 * fields, so there is no separate flow; opening the flagged entry here IS
 * the correction.
 */
export async function editSleep(
  db: AbstractPowerSyncDatabase,
  sleepId: string,
  input: SleepEditInput,
): Promise<void> {
  const sleep = await loadSleepById(db, sleepId);
  if (!sleep) {
    return;
  }

  let occurredAt = sleep.occurred_at;
  let localDate = sleep.local_date;
  if (input.time) {
    const combined = combineLocalDateAndTime(sleep.local_date, input.time, sleep.tz);
    if (combined) {
      occurredAt = combined;
      localDate = toLocalDate(combined, sleep.tz);
    }
  }

  let endedAt = sleep.ended_at;
  if (input.endTime && sleep.ended_at) {
    const endLocalDate = toLocalDate(sleep.ended_at, sleep.tz);
    const combined = combineLocalDateAndTime(endLocalDate, input.endTime, sleep.tz);
    if (combined) {
      endedAt = combined;
    }
  }

  const location = input.location !== undefined ? input.location : sleep.location;

  await db.execute(
    `UPDATE sleeps
        SET occurred_at = ?, local_date = ?, ended_at = ?, location = ?, needs_review = 0, updated_at = ?
      WHERE id = ?`,
    [occurredAt, localDate, endedAt, location, nowUtcIso(), sleepId],
  );
}

/** Soft-deletes a sleep, mirroring the convention used by every other table. */
export async function softDeleteSleep(db: AbstractPowerSyncDatabase, sleepId: string): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE sleeps SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, sleepId]);
}

/**
 * Reactive: the sleep currently running for a child, if any.
 *
 * Also the reactive half of running-timer conflict resolution — see
 * `applyRunningConflictResolution`. The ordering here (earliest
 * `occurred_at`, tie-broken by `id`) matches `resolveRunningConflicts`'s
 * winner exactly, so the row returned as `sleep` is correct even in the
 * brief window before an unresolved conflict's write has landed.
 */
export function useRunningSleep(childId: string | undefined): {
  sleep: SleepRow | undefined;
  isLoading: boolean;
} {
  const db = usePowerSync();
  const { data, isLoading } = useQuery<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleeps
      WHERE child_id = ? AND deleted_at IS NULL AND is_running = 1
      ORDER BY occurred_at ASC, id ASC`,
    [childId ?? ''],
  );

  useEffect(() => {
    if (!childId || !hasUnresolvedRunningConflict(data)) {
      return;
    }
    applyRunningConflictResolution(db, childId, nowUtcIso()).catch((error) => {
      console.error('[LifeBook] Schlaf-Konflikt konnte nicht aufgelöst werden', error);
    });
  }, [db, childId, data]);

  return { sleep: data?.[0], isLoading };
}

/** Reactive: the most recently completed sleep for a child (used for "Wach seit …" etc). */
export function useLastCompletedSleep(childId: string | undefined): {
  sleep: SleepRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleeps
      WHERE child_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [childId ?? ''],
  );
  return { sleep: data?.[0], isLoading };
}

/** Reactive: every sleep of one local calendar day (`local_date`, YYYY-MM-DD), oldest first. */
export function useSleepsOfDay(
  childId: string | undefined,
  localDate: string | undefined,
): { sleeps: SleepRow[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleeps
      WHERE child_id = ? AND local_date = ? AND deleted_at IS NULL
      ORDER BY occurred_at ASC`,
    [childId ?? '', localDate ?? ''],
  );
  return { sleeps: data ?? [], isLoading };
}

/** Reactive: sleeps still flagged from a running-timer conflict, newest first. */
export function useSleepsNeedingReview(childId: string | undefined): SleepRow[] {
  const { data } = useQuery<SleepRow>(
    `SELECT ${SLEEP_COLUMNS} FROM sleeps
      WHERE child_id = ? AND deleted_at IS NULL AND needs_review = 1
      ORDER BY occurred_at DESC`,
    [childId ?? ''],
  );
  return data ?? [];
}
