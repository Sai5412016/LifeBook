/**
 * diaper — types (Spec §5.3).
 *
 * `diapers` has no database-level check constraints (Master-Spec §5 client
 * schema model: TEXT | INTEGER | REAL only) — the allowed values below are
 * enforced here and in the repository, the same convention every other
 * table in this app follows.
 */

/** Pflicht. */
export type DiaperKind = 'wet' | 'dirty' | 'both';

/** Optional. */
export type DiaperConsistency = 'liquid' | 'soft' | 'formed' | 'hard';

/** Optional. */
export type DiaperColor = 'yellow' | 'green' | 'brown' | 'black' | 'red' | 'white';

/** A stored diaper row, as read back from the local PowerSync database. */
export type DiaperRow = {
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
  kind: DiaperKind;
  consistency: DiaperConsistency | null;
  color: DiaperColor | null;
  /** 0 | 1 — SQLite has no boolean column type. */
  leaked: number;
};
