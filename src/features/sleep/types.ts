/**
 * sleep — types (Spec §5.3).
 *
 * `sleeps` has no database-level check constraints (Master-Spec §5 client
 * schema model: TEXT | INTEGER | REAL only) — the allowed values below are
 * enforced here and in the repository, the same convention every other
 * table in this app follows. `quality` (1..5) exists in the schema but is
 * unused at this stage — no UI reads or writes it yet.
 */

/** Optional. */
export type SleepLocation = 'bed' | 'stroller' | 'arms' | 'car' | 'other';

/** A stored sleep row, as read back from the local PowerSync database. */
export type SleepRow = {
  id: string;
  household_id: string;
  child_id: string;
  occurred_at: string;
  tz: string;
  local_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
  note: string | null;
  ended_at: string | null;
  quality: number | null;
  location: SleepLocation | null;
  /** 0 | 1 — SQLite has no boolean column type. */
  is_running: number;
  /** 0 | 1 — set by running-timer conflict resolution (see core/tracking/running-conflicts). */
  needs_review: number;
};
