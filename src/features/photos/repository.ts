/**
 * photos — repository (Spec §4 rule: features access data ONLY through here).
 *
 * Holds every read and write against the local PowerSync database for photos.
 * Binary data never passes through here — PowerSync syncs the metadata rows, and
 * ./upload moves the actual bytes to object storage. The two meet in the columns
 * `thumb_key` / `original_key` and their `*_uploaded_at` timestamps.
 *
 * A NOTE ON LOCATION DATA (GDPR, data minimisation)
 * -------------------------------------------------
 * `gps_lat` / `gps_lng` stay NULL. Coordinates only ever enter the database when
 * the user explicitly opts in to a location feature, because a filled column is
 * queryable, syncable, exportable data about where a child lives. The original
 * file is stored byte-identical, EXIF included — re-encoding it to strip tags
 * would degrade the photo the family wants to keep, and the file sits in a
 * private bucket only their own household can read.
 */

import { useQuery } from '@powersync/react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { newId } from '@/core/db/ids';
import { ageInDays, nowUtcIso, toLocalDate } from '@/core/time';

import { buildOriginalKey, buildThumbKey, groupPhotosByDay } from './identity';
import type { PhotoCandidate, PhotoDaySection, PhotoRow } from './types';

/** Columns every read selects, so callers always get a complete PhotoRow. */
const PHOTO_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source, local_uri, content_hash,
  captured_at, age_days, width, height, mime, bytes,
  thumb_key, thumb_uploaded_at, original_key, original_uploaded_at, availability
`;

/**
 * Every content hash already stored for a household.
 *
 * Loaded in full rather than queried per candidate: a family album is thousands
 * of rows, not millions, and one scan beats N round-trips through the SQLite
 * bridge during an import of 200 photos.
 */
export async function loadKnownHashes(
  db: AbstractPowerSyncDatabase,
  householdId: string,
): Promise<Set<string>> {
  const rows = await db.getAll<{ content_hash: string }>(
    'SELECT content_hash FROM photos WHERE household_id = ? AND deleted_at IS NULL',
    [householdId],
  );
  return new Set(rows.map((row) => row.content_hash));
}

export type InsertPhotosInput = {
  householdId: string;
  childId: string;
  userId: string;
  tz: string;
  /** Birth instant of the child, for the per-photo age. */
  birthAtUtcIso: string | null;
  /** Candidates paired with the persistent staging URI of each file. */
  entries: { photoId: string; candidate: PhotoCandidate; stagedUri: string; thumbKey: string }[];
};

/**
 * Insert freshly imported photos in one local transaction, so an interrupted
 * import never leaves half an album behind.
 *
 * `occurred_at` prefers the EXIF capture time and falls back to "now" — a photo
 * with no capture tag still belongs somewhere in the chronology, and today is the
 * only honest guess. `local_date` and `age_days` are frozen here and never
 * recomputed (Spec §7), so the timeline stays stable across moves and DST.
 */
export async function insertPhotos(
  db: AbstractPowerSyncDatabase,
  input: InsertPhotosInput,
): Promise<void> {
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    for (const { photoId, candidate, stagedUri, thumbKey } of input.entries) {
      const occurredAt = candidate.capturedAtUtcIso ?? now;
      const localDate = toLocalDate(occurredAt, input.tz);
      const age = input.birthAtUtcIso
        ? ageInDays(occurredAt, input.birthAtUtcIso, input.tz)
        : null;

      await tx.execute(
        `INSERT INTO photos (
           id, household_id, child_id, occurred_at, tz, local_date, created_by,
           created_at, updated_at, deleted_at, source, local_uri, content_hash,
           captured_at, age_days, width, height, mime, bytes,
           thumb_key, thumb_uploaded_at, original_key, original_uploaded_at, availability
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'device_gallery', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'available')`,
        [
          photoId,
          input.householdId,
          input.childId,
          occurredAt,
          input.tz,
          localDate,
          input.userId,
          now,
          now,
          stagedUri,
          candidate.contentHash,
          candidate.capturedAtUtcIso,
          age,
          candidate.width,
          candidate.height,
          candidate.mime,
          candidate.bytes,
          thumbKey,
          buildOriginalKey(input.householdId, photoId, candidate.mime),
        ],
      );
    }
  });
}

/**
 * Allocate the id and preview key for a photo before it is written.
 * Needed up front because the staged file is named after the id.
 */
export function prepareEntry(householdId: string): { photoId: string; thumbKey: string } {
  const photoId = newId();
  return { photoId, thumbKey: buildThumbKey(householdId, photoId) };
}

/**
 * Photos whose bytes are not yet fully in object storage, oldest first.
 * Oldest first on purpose: if an upload run is cut short, the pictures that have
 * been waiting longest are the ones that got saved.
 */
export async function loadPendingUploads(
  db: AbstractPowerSyncDatabase,
): Promise<PhotoRow[]> {
  return db.getAll<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM photos
      WHERE deleted_at IS NULL
        AND local_uri IS NOT NULL
        AND (thumb_uploaded_at IS NULL OR original_uploaded_at IS NULL)
      ORDER BY created_at ASC`,
  );
}

/** Mark the preview as stored. */
export async function markThumbUploaded(
  db: AbstractPowerSyncDatabase,
  photoId: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute(
    'UPDATE photos SET thumb_uploaded_at = ?, updated_at = ? WHERE id = ?',
    [now, now, photoId],
  );
}

/**
 * Mark the original as stored and drop the staging copy from the row.
 *
 * `availability` flips to 'missing' because that column describes THIS device
 * only: the file is no longer held locally, and every reader — including this
 * phone — now fetches it from object storage. Deleting the staged bytes is what
 * keeps the app from doubling the user's photo storage.
 */
export async function markOriginalUploaded(
  db: AbstractPowerSyncDatabase,
  photoId: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute(
    `UPDATE photos
        SET original_uploaded_at = ?, local_uri = NULL, availability = 'missing', updated_at = ?
      WHERE id = ?`,
    [now, now, photoId],
  );
}

/** Soft-delete, mirroring the convention used by every other event table. */
export async function softDeletePhoto(
  db: AbstractPowerSyncDatabase,
  photoId: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute('UPDATE photos SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    photoId,
  ]);
}

/** Reactive chronology for one child: day sections, newest first. */
export function usePhotoSections(childId: string | undefined): {
  sections: PhotoDaySection[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM photos
      WHERE child_id = ? AND deleted_at IS NULL
      ORDER BY occurred_at DESC`,
    [childId ?? ''],
  );

  return { sections: groupPhotosByDay(data ?? []), isLoading };
}

/** Reactive single photo by id, for the fullscreen viewer. Undefined while loading or once deleted. */
export function usePhotoById(photoId: string | undefined): {
  photo: PhotoRow | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ? AND deleted_at IS NULL`,
    [photoId ?? ''],
  );

  return { photo: data?.[0], isLoading };
}

/**
 * Reactive: every photo of a child in the same order the Chronik shows them
 * (`occurred_at` descending) — the flat sequence the swipeable fullscreen
 * viewer pages through. `groupPhotosByDay` sorts each day's photos and the
 * days themselves the same way, so this list and the Chronik grid always
 * agree on ordering.
 */
export function usePhotosOfChild(childId: string | undefined): {
  photos: PhotoRow[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM photos
      WHERE child_id = ? AND deleted_at IS NULL
      ORDER BY occurred_at DESC`,
    [childId ?? ''],
  );

  return { photos: data ?? [], isLoading };
}

/** Reactive count of photos still waiting to be uploaded. */
export function usePendingUploadCount(): number {
  const { data } = useQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photos
      WHERE deleted_at IS NULL AND local_uri IS NOT NULL AND original_uploaded_at IS NULL`,
  );
  return data?.[0]?.n ?? 0;
}
