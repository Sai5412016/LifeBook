/**
 * events/types — the "Ereignisse" tab: special moments with a date, a text
 * and photos. Stored in the pre-existing `milestones` table (see
 * repository.ts's own doc comment for why the name doesn't match the
 * table) plus the new `milestone_photos` junction table.
 */

/** One row of `public.milestones`, as this feature uses it. */
export type EventRow = {
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
  /** The event's text — reuses the generic `note` column every event table has. */
  note: string | null;
  title: string;
  /** The title image — always the first row of `milestone_photos`, kept redundantly for a cheap list-row lookup. */
  photo_id: string | null;
};

/** One row of `public.milestone_photos` — one photo linked to one event, in display order. */
export type EventPhotoRow = {
  id: string;
  milestone_id: string;
  photo_id: string;
  sort_index: number;
  added_at: string;
};

/** The list screen's row: an event plus just enough of its title photo to draw a thumbnail. */
export type EventSummaryRow = EventRow & {
  title_thumb_key: string | null;
  title_local_uri: string | null;
};
