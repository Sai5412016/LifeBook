/**
 * pumping — types (Spec §5).
 *
 * Mirrors `public.pumping_sessions` exactly as it exists live (verified
 * against the database 2026-08-25, including the `pump` column added the
 * same day). The event columns are the shared set every event table
 * carries — see core/db/schema.ts#eventColumns.
 */

/** `pumping_sessions.side` — which breast the session covered. */
export type PumpingSide = 'left' | 'right' | 'both';

/**
 * The pumps offered in the entry sheet. The COLUMN is free text and
 * nullable, so `PumpingSessionRow.pump` stays a plain `string | null`: a
 * value written by a future version (or by hand in the database) must
 * render, not crash a screen that expects one of two literals.
 */
export const PUMP_OPTIONS = ['Medela', 'Momcozy'] as const;
export type PumpOption = (typeof PUMP_OPTIONS)[number];

/** A stored pumping session, as read back from the local PowerSync database. */
export type PumpingSessionRow = {
  id: string;
  household_id: string;
  child_id: string;
  occurred_at: string;
  tz: string;
  /** YYYY-MM-DD in `tz`, frozen at insert — the ONLY grouping key, never recomputed. */
  local_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
  note: string | null;
  side: PumpingSide | null;
  amount_ml: number | null;
  /** SECONDS, not minutes — the column is `duration_s`. */
  duration_s: number | null;
  /**
   * 0 | 1. Belongs to the pumping TIMER (Spec §6.2), which is a separate
   * job: nothing in this feature ever sets either flag to 1.
   */
  is_running: number;
  needs_review: number;
  pump: string | null;
};

/** Everything `addPumpingSession` needs; `time`/`durationS`/`note` are optional. */
export type AddPumpingSessionInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  amountMl: number;
  side: PumpingSide;
  pump: string | null;
  /** Wall-clock "HH:mm" in `tz`; omitted means "now". */
  time?: string;
  durationS?: number | null;
  note?: string | null;
};

/** A correction to an existing session — every field optional, only what changed. */
export type EditPumpingSessionInput = {
  amountMl?: number;
  side?: PumpingSide;
  pump?: string | null;
  /** Wall-clock "HH:mm", interpreted in the session's OWN stored `tz`. */
  time?: string;
  durationS?: number | null;
  note?: string | null;
};
