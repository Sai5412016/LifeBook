/**
 * notes — types (Spec §5.3). Mirrors `core/db/schema.ts`'s `notes` table
 * exactly. No UI writes this table yet (task 2026-09-26: features/timeline
 * reads it as one of the Tagesverlauf's eight sources, read-only — same
 * "no entry screen yet" situation as features/growth/repository.ts).
 */

/** A stored note row, as read back from the local PowerSync database. */
export type NoteRow = {
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
  title: string | null;
};
