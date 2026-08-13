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
import { ageInDays, applyOccurredAtCorrection, nowUtcIso, toLocalDate } from '@/core/time';

import { buildMediumKey, buildOriginalKey, buildThumbKey, groupPhotosByDay } from './identity';
import type { PhotoCandidate, PhotoDaySection, PhotoRow } from './types';

/** Columns every read selects, so callers always get a complete PhotoRow. */
const PHOTO_COLUMNS = `
  id, household_id, child_id, occurred_at, tz, local_date, created_by,
  created_at, updated_at, deleted_at, source, local_uri, content_hash,
  captured_at, occurred_at_source, age_days, width, height, mime, bytes,
  thumb_key, thumb_uploaded_at, medium_key, medium_uploaded_at,
  original_key, original_uploaded_at, availability
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
  entries: {
    photoId: string;
    candidate: PhotoCandidate;
    stagedUri: string;
    thumbKey: string;
    mediumKey: string;
  }[];
};

/**
 * Insert freshly imported photos in one local transaction, so an interrupted
 * import never leaves half an album behind.
 *
 * `occurred_at` is the candidate's already-resolved instant — see
 * ./media.ts#resolveOccurredAt for the fallback chain (EXIF, then
 * MediaLibrary, then file modification time, then import time) that
 * produced it, and `occurred_at_source` for which stage won. `local_date`
 * and `age_days` are frozen here and never recomputed (Spec §7), so the
 * timeline stays stable across moves and DST.
 *
 * `medium_key` is written here too, same as `thumb_key`/`original_key` —
 * deterministic from household+photo id, so it exists from the first
 * moment even though the actual bytes aren't uploaded until the upload
 * queue gets to it (`medium_uploaded_at` starts NULL, mirroring the other
 * two renditions).
 */
export async function insertPhotos(
  db: AbstractPowerSyncDatabase,
  input: InsertPhotosInput,
): Promise<void> {
  const now = nowUtcIso();

  await db.writeTransaction(async (tx) => {
    for (const { photoId, candidate, stagedUri, thumbKey, mediumKey } of input.entries) {
      const occurredAt = candidate.occurredAtUtcIso;
      const localDate = toLocalDate(occurredAt, input.tz);
      const age = input.birthAtUtcIso
        ? ageInDays(occurredAt, input.birthAtUtcIso, input.tz)
        : null;

      await tx.execute(
        `INSERT INTO photos (
           id, household_id, child_id, occurred_at, tz, local_date, created_by,
           created_at, updated_at, deleted_at, source, local_uri, content_hash,
           captured_at, occurred_at_source, age_days, width, height, mime, bytes,
           thumb_key, thumb_uploaded_at, medium_key, medium_uploaded_at,
           original_key, original_uploaded_at, availability
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'device_gallery', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, 'available')`,
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
          candidate.occurredAtSource,
          age,
          candidate.width,
          candidate.height,
          candidate.mime,
          candidate.bytes,
          thumbKey,
          mediumKey,
          buildOriginalKey(input.householdId, photoId, candidate.mime),
        ],
      );
    }
  });
}

/**
 * Allocate the id and rendition keys for a photo before it is written.
 * Needed up front because the staged file is named after the id.
 */
export function prepareEntry(
  householdId: string,
): { photoId: string; thumbKey: string; mediumKey: string } {
  const photoId = newId();
  return {
    photoId,
    thumbKey: buildThumbKey(householdId, photoId),
    mediumKey: buildMediumKey(householdId, photoId),
  };
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
        AND (thumb_uploaded_at IS NULL OR medium_uploaded_at IS NULL OR original_uploaded_at IS NULL)
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
 * Mark the mid-size rendition as stored. Takes `mediumKey` explicitly rather
 * than assuming the row already has one: for a freshly imported photo it
 * does (set at insert, see `insertPhotos`), but for an older row healed in
 * the background (Aufgabe 3, ./storage.ts#healMissingMedium) this call is
 * what sets `medium_key` for the very first time — both cases are the same
 * write.
 */
export async function markMediumUploaded(
  db: AbstractPowerSyncDatabase,
  photoId: string,
  mediumKey: string,
): Promise<void> {
  const now = nowUtcIso();
  await db.execute(
    'UPDATE photos SET medium_key = ?, medium_uploaded_at = ?, updated_at = ? WHERE id = ?',
    [mediumKey, now, now, photoId],
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

/**
 * Applies a user-entered correction to a photo's capture date/time.
 *
 * 2026-08-13: THE ONE EXCEPTION to "`local_date` is derived once and never
 * recomputed" (CLAUDE.md Architekturregel 2 / Master-Spec §7) — see
 * core/time#applyOccurredAtCorrection's own doc comment for the full
 * reasoning. `occurred_at` and `local_date` are written together in this
 * SAME statement so the row can never end up with one changed and not the
 * other. `tz` comes from `photo.tz` — the zone the photo was ALREADY filed
 * under — never `deviceTimeZone()`: correcting a photo from a trip means
 * entering the date as it was there, not reinterpreting it in whatever
 * zone the correcting device happens to be in right now.
 *
 * `occurred_at_source` becomes `'user_corrected'` — once a person has
 * confirmed a date, it is no longer a guess (see
 * ./identity.ts#isOccurredAtEstimated), regardless of what fallback stage
 * produced the value it's replacing.
 *
 * Returns false for a malformed date/time (the screen's own validation
 * should already have caught it before calling this) instead of writing a
 * bogus instant.
 */
export async function correctPhotoOccurredAt(
  db: AbstractPowerSyncDatabase,
  photo: Pick<PhotoRow, 'id' | 'tz'>,
  input: { localDate: string; time: string },
): Promise<boolean> {
  const corrected = applyOccurredAtCorrection(input.localDate, input.time, photo.tz);
  if (!corrected) {
    return false;
  }

  const now = nowUtcIso();
  await db.execute(
    `UPDATE photos
        SET occurred_at = ?, local_date = ?, occurred_at_source = 'user_corrected', updated_at = ?
      WHERE id = ?`,
    [corrected.occurredAtUtcIso, corrected.localDate, now, photo.id],
  );
  return true;
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

/**
 * Reactive progress of the medium-rendition backfill (Aufgabe 3): how many
 * photos already have a `medium_key` versus the total. Drives the
 * "Vorbereitet: 12 von 107" line in Einstellungen — without it there is no
 * way to tell from outside whether the silent background healing
 * (./storage.ts#healMissingMedium) is actually doing anything.
 */
export function useMediumBackfillProgress(): { done: number; total: number } {
  const { data } = useQuery<{ done: number | null; total: number }>(
    `SELECT
        SUM(CASE WHEN medium_key IS NOT NULL THEN 1 ELSE 0 END) AS done,
        COUNT(*) AS total
       FROM photos
      WHERE deleted_at IS NULL`,
  );
  return {
    done: Number(data?.[0]?.done ?? 0),
    total: Number(data?.[0]?.total ?? 0),
  };
}
