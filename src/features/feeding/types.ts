/**
 * feeding — types (Spec §5.3, extended for the running-timer columns
 * `running_side` / `running_since` added by migration, see core/db/schema.ts).
 */

/** Which breast is (or was) the active side of the current live segment. */
export type FeedSide = 'left' | 'right';

/** `feeds.feed_type` — the DB enum for how the feed happened. */
export type FeedType =
  | 'breast_left'
  | 'breast_right'
  | 'breast_both'
  | 'bottle_breastmilk'
  | 'bottle_formula';

/** What was in the bottle, for `logBottle`. */
export type BottleKind = 'breastmilk' | 'formula';

/** A stored feed row, as read back from the local PowerSync database. */
export type FeedRow = {
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
  feed_type: FeedType;
  amount_ml: number | null;
  duration_left_s: number | null;
  duration_right_s: number | null;
  ended_at: string | null;
  /** 0 | 1 — SQLite has no boolean column type. */
  is_running: number;
  /** 0 | 1 — set by conflict resolution when this row lost to another running feed. */
  needs_review: number;
  running_side: FeedSide | null;
  running_since: string | null;
};
