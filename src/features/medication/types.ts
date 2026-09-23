/**
 * medication — types (Spec §5).
 *
 * `medications` has no database-level check constraints (Master-Spec §5:
 * client schema is TEXT | INTEGER | REAL only) — the allowed unit/route
 * values below are enforced here and in the repository, the same convention
 * every other table in this app follows (see diaper/types.ts).
 */

/** Optional — a quick button can be logged with no dose recorded at all. */
export type MedicationDoseUnit = 'ie' | 'drops' | 'ml' | 'mg' | 'spoon' | 'piece';

/** Optional. */
export type MedicationRoute = 'oral' | 'bottle' | 'other';

/** A stored medication row, as read back from the local PowerSync database. */
export type MedicationRow = {
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
  name: string;
  dose_amount: number | null;
  dose_unit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  /** Not surfaced by this feature's UI yet — column exists, form doesn't ask for it. */
  reason: string | null;
};
