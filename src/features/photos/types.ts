/**
 * photos — types (Spec §5.4, erweitert 2026-08-09).
 *
 * Spec deviation, documented rather than silent: §5.4 kept originals on the
 * device and only pushed a thumbnail to object storage. That fails the actual
 * family requirement — the other parent must be able to open the FULL photo on
 * their own phone, not just a preview. So originals are uploaded too, and the
 * row carries `original_key` / `original_uploaded_at` / `bytes`.
 */

/** Where the row came from. `device_gallery` = picked via the system picker. */
export type PhotoSource = 'device_gallery' | 'imported';

/**
 * Whether the ORIGINAL file is still reachable at `local_uri` on THIS device.
 * Irrelevant for other devices — they always read from object storage.
 */
export type PhotoAvailability = 'available' | 'missing';

/**
 * A photo the user picked, after metadata extraction but before it is stored.
 * `contentHash` is what dedupe runs on — see ./identity.
 */
export type PhotoCandidate = {
  /** file:// URI of the picked image (a cache copy on Android). */
  localUri: string;
  /** Platform media id when the picker exposes one. Unstable — never a key. */
  assetId: string | null;
  fileName: string | null;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  /** ISO-8601 UTC capture time from EXIF; null when the file carries none. */
  capturedAtUtcIso: string | null;
  /** Stable content identity, `<sha256-of-first-MB>:<bytes>`. */
  contentHash: string;
  /** Only ever filled when the user opted in to location data. */
  gps: { lat: number; lng: number } | null;
};

/** A stored photo row, as read back from the local PowerSync database. */
export type PhotoRow = {
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
  source: PhotoSource;
  local_uri: string | null;
  content_hash: string;
  captured_at: string | null;
  /**
   * Snapshot of the child's age at import time — frozen, never recomputed
   * (Spec §7's `local_date` rule). NOT used for display: a birth date/time
   * correction (see features/household#updateChild) would leave every
   * existing photo's stored value wrong, and rewriting them all is a
   * separate, expensive operation. Screens instead compute age live from
   * `children.birth_at` + the photo's own `occurred_at` — see
   * repository.ts's doc comment for the reasoning.
   */
  age_days: number | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  bytes: number | null;
  thumb_key: string | null;
  thumb_uploaded_at: string | null;
  original_key: string | null;
  original_uploaded_at: string | null;
  availability: PhotoAvailability;
};

/** One day's photos in the chronology, newest day first. */
export type PhotoDaySection = {
  /** YYYY-MM-DD in the capture timezone. */
  localDate: string;
  photos: PhotoRow[];
};

/** Result of an import run, shown to the user as a plain sentence. */
export type ImportSummary = {
  imported: number;
  /** Skipped because the exact same file is already in the album. */
  duplicates: number;
  /** Skipped because reading or thumbnailing failed. */
  failed: number;
};
