/**
 * growth — types (Spec §5).
 *
 * `growth_measurements` has no database-level check constraints
 * (Master-Spec §5: client schema is TEXT | INTEGER | REAL only) — the
 * allowed `measured_source` values below are enforced here, same convention
 * every other table in this app follows (see diaper/types.ts).
 */

export type GrowthMeasuredSource = 'home' | 'doctor';

/** A stored growth measurement row, as read back from the local PowerSync database. */
export type GrowthMeasurementRow = {
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
  weight_g: number | null;
  length_mm: number | null;
  head_circumference_mm: number | null;
  measured_source: GrowthMeasuredSource | null;
};
