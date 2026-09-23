/**
 * temperature — types (Spec §5.3). Mirrors `core/db/schema.ts`'s
 * `temperatures` table exactly. No UI writes this table yet (task
 * 2026-09-26: features/timeline reads it as one of the Tagesverlauf's eight
 * sources, read-only, same "no entry screen yet" situation as
 * features/growth — see that feature's own repository.ts doc comment).
 */

/** Optional — how the temperature was taken. */
export type TemperatureMethod = 'axillary' | 'rectal' | 'ear' | 'forehead' | 'oral';

/** A stored temperature row, as read back from the local PowerSync database. */
export type TemperatureRow = {
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
  value_c: number | null;
  method: TemperatureMethod | null;
  symptoms: string | null;
};
