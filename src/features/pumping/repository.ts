/**
 * pumping — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Every read and write for the "Abpumpen" tab against the LOCAL PowerSync
 * database — never a network call, never `supabase` directly: the tab has
 * to work at 03:00 in a flat with no signal, and sync carries the rows up
 * afterwards (core/sync/connector.ts).
 *
 * `local_date` IS SET ONCE, HERE, AT INSERT
 * -------------------------------------------
 * `addPumpingSession` derives it from the session's own `occurred_at` and
 * `tz` and writes it in the same statement. Nothing else ever recomputes
 * it — analytics.ts groups by the stored value verbatim. That is what
 * keeps a 03:00 session on its own night across a move or a DST change.
 * The ONE exception is an explicit user correction of the time
 * (`editPumpingSession`), which re-derives `occurred_at` AND `local_date`
 * together, in one write, from the row's OWN stored `tz` — the sanctioned
 * exception in CLAUDE.md's rule 2, and the same shape
 * features/feeding#editFeed already uses.
 *
 * `is_running` and `needs_review` are written as 0 and never touched
 * again: they belong to the pumping timer (Spec §6.2), a separate job.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { addDaysToLocalDate, combineLocalDateAndTime, formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';

import { isBackdatedToYesterday } from './entry-time';
import type {
  AddPumpingSessionInput,
  EditPumpingSessionInput,
  PumpingSessionRow,
} from './types';

/** Columns every read selects, so callers always get a complete `PumpingSessionRow`. */
const PUMPING_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source_device_id, note,
  side, amount_ml, duration_s, is_running, needs_review, pump
`;

async function loadSessionById(
  db: AbstractPowerSyncDatabase,
  sessionId: string,
): Promise<PumpingSessionRow | null> {
  const rows = await db.getAll<PumpingSessionRow>(
    `SELECT ${PUMPING_COLUMNS} FROM pumping_sessions WHERE id = ? AND deleted_at IS NULL`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/**
 * Records one completed pumping session and returns its id (the caller's
 * optimistic update needs it to roll the row back out again on failure).
 *
 * The id is generated HERE, on the device (`newId()`, UUIDv7 like every
 * other feature) — the database assigns none, and offline there is no
 * database to ask.
 *
 * `input.time` ("HH:mm") lets the parent correct the clock time before
 * saving. Left out — the normal case — the session happened "now". Given,
 * it is interpreted on the CURRENT local day UNLESS it is LATER than the
 * current wall-clock time, in which case it can only mean yesterday — see
 * ./entry-time#isBackdatedToYesterday's own doc comment for why a
 * heuristic and not a date picker. Either way `local_date` is still
 * derived exactly once, from whichever `occurredAt` this resolves to —
 * the exception only feeds the right DAY into that one derivation, it
 * does not add a second one.
 */
export async function addPumpingSession(
  db: AbstractPowerSyncDatabase,
  input: AddPumpingSessionInput,
): Promise<string> {
  const now = nowUtcIso();
  const todayLocalDate = toLocalDate(now, input.tz);
  // A malformed time can never silently become "now" in the OTHER
  // direction either: combineLocalDateAndTime returns null, and we fall
  // back to the actual current instant rather than storing a guess.
  let occurredAt = now;
  if (input.time) {
    const nowHhMm = formatTimeLabel(now, input.tz);
    const targetLocalDate = isBackdatedToYesterday(input.time, nowHhMm)
      ? addDaysToLocalDate(todayLocalDate, -1)
      : todayLocalDate;
    occurredAt = combineLocalDateAndTime(targetLocalDate, input.time, input.tz) ?? now;
  }
  const sessionId = newId();

  await db.execute(
    `INSERT INTO pumping_sessions (
       id, household_id, child_id, occurred_at, tz, local_date, created_by,
       created_at, updated_at, deleted_at, source_device_id, note,
       side, amount_ml, duration_s, is_running, needs_review, pump
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      input.householdId,
      input.childId,
      occurredAt,
      input.tz,
      // Frozen here, once — see this module's own doc comment.
      toLocalDate(occurredAt, input.tz),
      input.userId,
      now,
      now,
      null,
      null,
      input.note ?? null,
      input.side,
      input.amountMl,
      input.durationS ?? null,
      0,
      0,
      input.pump,
    ],
  );

  return sessionId;
}

/**
 * Applies a parent's correction to an existing session. Only the fields
 * present in `input` change; everything else keeps its stored value.
 *
 * A time correction re-derives `occurred_at` and `local_date` TOGETHER,
 * from the row's own `tz` (never the device's current one) — see the
 * module doc comment.
 */
export async function editPumpingSession(
  db: AbstractPowerSyncDatabase,
  sessionId: string,
  input: EditPumpingSessionInput,
): Promise<void> {
  const existing = await loadSessionById(db, sessionId);
  if (!existing) {
    return;
  }

  let occurredAt = existing.occurred_at;
  let localDate = existing.local_date;
  if (input.time) {
    const combined = combineLocalDateAndTime(existing.local_date, input.time, existing.tz);
    if (combined) {
      occurredAt = combined;
      localDate = toLocalDate(combined, existing.tz);
    }
  }

  await db.execute(
    `UPDATE pumping_sessions
        SET occurred_at = ?, local_date = ?, amount_ml = ?, side = ?, pump = ?,
            duration_s = ?, note = ?, updated_at = ?
      WHERE id = ?`,
    [
      occurredAt,
      localDate,
      input.amountMl ?? existing.amount_ml,
      input.side ?? existing.side,
      input.pump !== undefined ? input.pump : existing.pump,
      input.durationS !== undefined ? input.durationS : existing.duration_s,
      input.note !== undefined ? input.note : existing.note,
      nowUtcIso(),
      sessionId,
    ],
  );
}

/**
 * Soft-deletes a session — sets `deleted_at`, never removes the row, the
 * same convention every other table follows (a hard delete could not sync
 * a deletion to the other parent's phone reliably, and nothing here is
 * worth losing).
 */
export async function softDeletePumpingSession(
  db: AbstractPowerSyncDatabase,
  sessionId: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE pumping_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    sessionId,
  ]);
}

/**
 * Reactive: every session of this child filed on or after `fromLocalDate`,
 * newest first. One query feeds the whole screen — today's total, the
 * 7-day average and the 14-day list all derive from this same list in
 * analytics.ts, so they can never disagree with each other. Reactive
 * means a save (or a row arriving from the other phone) re-renders the
 * total without any manual reload.
 */
export function usePumpingSessionsSince(
  childId: string | undefined,
  fromLocalDate: string,
): { sessions: PumpingSessionRow[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<PumpingSessionRow>(
    `SELECT ${PUMPING_COLUMNS} FROM pumping_sessions
      WHERE child_id = ? AND deleted_at IS NULL AND local_date >= ?
      ORDER BY occurred_at DESC`,
    [childId ?? '', fromLocalDate],
  );
  return { sessions: data ?? [], isLoading };
}
