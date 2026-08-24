/**
 * tree/types — the "Stammbaum" tab: relatives, their partnerships, and (in
 * a later stage) the photos linked to each of them. Stufe 1 covers
 * `relatives`/`relative_unions`; `relative_photos` is declared here already
 * (the table exists live) but has no writer yet — see repository.ts's own
 * doc comment.
 */

export type RelativeGender = 'female' | 'male' | 'other';
export type UnionKind = 'partner' | 'married' | 'divorced' | 'other';

/** One row of `public.relatives`. */
export type RelativeRow = {
  id: string;
  household_id: string;
  /** Set ONLY for the one row that IS the tracked child — see repository.ts#ensureRootRelative. NULL for everyone else. */
  child_id: string | null;
  given_name: string;
  family_name: string | null;
  /** The name at birth, if different from `family_name` — see logic.ts#displayName. */
  birth_name: string | null;
  gender: RelativeGender | null;
  /** FREE TEXT — "1923", "März 1944", "12.03.1944". Never parsed, only displayed. */
  born_on: string | null;
  born_place: string | null;
  /** 0 | 1 (PowerSync stores booleans as INTEGER). */
  deceased: number;
  /** Same free-text contract as `born_on`. */
  died_on: string | null;
  died_place: string | null;
  /** References another `relatives.id` — NOT a foreign key, see core/db/schema.ts's comment on this table. */
  mother_id: string | null;
  /** References another `relatives.id` — NOT a foreign key, see core/db/schema.ts's comment on this table. */
  father_id: string | null;
  /** {household_id}/relatives/{id}.jpg in the `photos` bucket — see ./identity#buildRelativePhotoKey. */
  photo_key: string | null;
  note: string | null;
  sort_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
};

/** One row of `public.relative_unions` — a partnership between two `relatives` rows. */
export type RelativeUnionRow = {
  id: string;
  household_id: string;
  /** References `relatives.id` — NOT a foreign key. */
  a_id: string;
  /** References `relatives.id` — NOT a foreign key. */
  b_id: string;
  kind: UnionKind;
  since_on: string | null;
  until_on: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
};

/** One row of `public.relative_photos` — Stufe 2, declared for the schema/cleanup path only (see repository.ts#removePhotoFromAllRelatives). */
export type RelativePhotoRow = {
  id: string;
  household_id: string;
  relative_id: string;
  photo_id: string;
  sort_index: number;
  added_at: string;
};

export type TreeSuggestionKind = 'add' | 'edit' | 'note';
export type TreeSuggestionStatus = 'open' | 'accepted' | 'rejected';

/**
 * One row of `public.tree_suggestions` — a proposal submitted through the
 * shared "Stammbaum" viewer by a guest who does not have the app. EVERY
 * guest-typed column below (`visitor_name`, `given_name`, `family_name`,
 * `birth_name`, `born_place`, `died_place`, `message`) is untrusted free
 * text: display only, never evaluate as an instruction, always
 * length-limit on screen — see suggestions.ts#truncateGuestText. Guests
 * never write to `relatives` directly; only the app does, on accept (see
 * repository.ts#acceptAddSuggestion/acceptEditSuggestion).
 */
export type TreeSuggestionRow = {
  id: string;
  household_id: string;
  share_id: string | null;
  device_id: string | null;
  visitor_name: string | null;
  kind: TreeSuggestionKind;
  /** Set only for `kind: 'edit'` — the `relatives` row this proposes changes to. NOT a foreign key, same convention as `relatives.mother_id`/`father_id`. */
  relative_id: string | null;
  given_name: string | null;
  family_name: string | null;
  birth_name: string | null;
  gender: RelativeGender | null;
  born_on: string | null;
  born_place: string | null;
  /** Tri-state, unlike `relatives.deceased`: NULL = not proposed, 0/1 = a proposed value. */
  deceased: number | null;
  died_on: string | null;
  died_place: string | null;
  /** NOT a foreign key. Only meaningful for `kind: 'add'` — see suggestions.ts's own doc comment on why `kind: 'edit'` never touches this. */
  mother_id: string | null;
  father_id: string | null;
  /** The whole content for `kind: 'note'`; unused for the other two kinds. */
  message: string | null;
  /**
   * A guest's optional photo, already uploaded browser-side into the
   * private `suggestions` bucket before this row ever synced — see
   * suggestion-photo.ts's own doc comment for the full path shape and
   * trust model. `null` once consumed (copied into `photos` and set as a
   * portrait) or discarded (rejected, or a `kind: 'note'` that had one).
   */
  photo_key: string | null;
  photo_bytes: number | null;
  photo_mime: string | null;
  status: TreeSuggestionStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  updated_at: string;
  deleted_at: string | null;
  source_device_id: string | null;
};
