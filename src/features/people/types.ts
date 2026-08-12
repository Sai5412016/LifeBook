// people — types. Roster of humans who accompanied the child (Hebamme,
// Ärztin/Arzt, Familie, …) — new feature, database already migrated.

export type PersonRole = 'midwife' | 'doctor' | 'nurse' | 'family' | 'godparent' | 'other';

/** A stored person row, as read back from the local PowerSync database. */
export type PersonRow = {
  id: string;
  household_id: string;
  child_id: string;
  name: string;
  role: PersonRole;
  note: string | null;
  /** {household_id}/people/{id}.jpg in the `photos` bucket — see ./identity. */
  photo_key: string | null;
  /** ISO-8601 UTC, optional start of the period this person accompanied the child. */
  met_from: string | null;
  /** ISO-8601 UTC, optional end of that period. */
  met_to: string | null;
  sort_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
