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
 * Which fallback stage actually produced `occurred_at`/`PhotoRow.occurred_at`
 * — see features/photos/media.ts#resolveOccurredAt for the fallback chain
 * this records, in order:
 * - 'exif'          — EXIF DateTimeOriginal/Digitized/DateTime.
 * - 'media_library'  — Android MediaStore's own creation time, via the
 *                      picker's assetId (only when MediaLibrary permission
 *                      already happens to be granted — never requested for
 *                      this).
 * - 'file_mtime'     — the picked file's own last-modified time.
 * - 'import_time'    — none of the above worked; the moment of import.
 * - 'user_corrected' — an explicit correction via
 *                      features/photos/repository.ts#correctPhotoOccurredAt.
 * See features/photos/identity.ts#isOccurredAtEstimated for which of these
 * count as "Datum geschätzt" on screen — everything except the first and
 * the last.
 */
export type OccurredAtSource = 'exif' | 'media_library' | 'file_mtime' | 'import_time' | 'user_corrected';

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
  /** ISO-8601 UTC capture time from EXIF specifically; null when the file carries none. Stored as-is in `captured_at`. */
  capturedAtUtcIso: string | null;
  /** The RESOLVED capture instant after the full fallback chain — never null, feeds `occurred_at`. */
  occurredAtUtcIso: string;
  /** Which stage of the chain actually produced `occurredAtUtcIso` — feeds `occurred_at_source`. */
  occurredAtSource: OccurredAtSource;
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
   * Existing rows imported before this column existed read back as NULL —
   * treated as an estimate by isOccurredAtEstimated (the honest answer:
   * we don't actually know, so it must not be trusted as measured either).
   */
  occurred_at_source: OccurredAtSource | null;
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
  /**
   * NULL for every photo imported before this column existed (2026-08-13) —
   * self-heals in the background the next time it's opened in the
   * fullscreen viewer, see features/photos/storage.ts#healMissingMedium.
   */
  medium_key: string | null;
  medium_uploaded_at: string | null;
  original_key: string | null;
  original_uploaded_at: string | null;
  availability: PhotoAvailability;
  /** User-entered caption, shown under the photo in the fullscreen viewer — see identity.ts#normalizePhotoNote. NULL for no caption, never an empty string. */
  note: string | null;
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
