/**
 * photos/identity — pure logic for photo identity, storage paths and grouping.
 *
 * Deliberately free of any Expo / React Native / PowerSync import so it runs in
 * plain Node under Vitest. Everything device-dependent lives in ./media.
 *
 * WHY CONTENT HASH AND NOT THE PLATFORM MEDIA ID
 * ----------------------------------------------
 * Android MediaStore ids are not stable: a media re-scan (SD card remount, OS
 * update, gallery app change) can renumber them, and the same picture re-picked
 * through the system picker arrives under a fresh cache path every time. Keying
 * on either would silently duplicate the family album. The file's own content is
 * the only identity that survives, so that is what we key on.
 */

import type { OccurredAtSource } from './types';

/**
 * How many leading bytes feed the hash. Hashing the whole file would be exact
 * but costs seconds per photo on a mid-range phone; the first megabyte of a JPEG
 * covers header, EXIF and a large slice of image data. Combined with the exact
 * byte count (below) a collision needs two files that share their first 1 MB AND
 * their total size — not reachable by accident in a family photo album.
 */
export const HASH_SAMPLE_BYTES = 1024 * 1024;

/**
 * Build the stable content identity from the sample hash and the exact file size.
 * The size is part of the key precisely because the hash only covers a prefix.
 */
export const composeContentHash = (sampleSha256Hex: string, bytes: number): string =>
  `${sampleSha256Hex}:${bytes}`;

export type DedupeResult<T> = {
  /** Not seen before — neither already stored nor earlier in this same batch. */
  fresh: T[];
  /** Exact duplicates, to be reported to the user and otherwise ignored. */
  duplicates: T[];
};

/**
 * Split candidates into new photos and exact duplicates.
 *
 * Guards BOTH directions, which matters: `knownHashes` catches re-importing a
 * photo the album already has, and the running set catches the user selecting
 * the same picture twice inside one pick. Order is preserved, and the FIRST
 * occurrence of a hash within the batch wins.
 */
export function dedupeByHash<T extends { contentHash: string }>(
  candidates: readonly T[],
  knownHashes: Iterable<string>,
): DedupeResult<T> {
  const seen = new Set(knownHashes);
  const fresh: T[] = [];
  const duplicates: T[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.contentHash)) {
      duplicates.push(candidate);
      continue;
    }
    seen.add(candidate.contentHash);
    fresh.push(candidate);
  }

  return { fresh, duplicates };
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** File extension for an image mime type. Falls back to `jpg`. */
export const extensionForMime = (mime: string | null | undefined): string =>
  MIME_EXTENSIONS[(mime ?? '').toLowerCase()] ?? 'jpg';

/**
 * Reject anything that could break out of the household folder.
 *
 * The storage access rules match on the FIRST path segment being a household the
 * user belongs to. A `/` or `..` smuggled into an id would shift that segment and
 * defeat the check, so ids are validated here — at the single place where paths
 * are built — rather than trusted.
 *
 * Exported: features/people builds paths into this SAME bucket under the same
 * rule (first segment = household id) — reused rather than re-implemented so
 * the two can never drift apart on this security-relevant check.
 */
export const assertPathSafe = (value: string, label: string): void => {
  if (value.length === 0 || /[/\\]|\.\./.test(value)) {
    throw new Error(`photos: unsafe ${label} for a storage path: "${value}"`);
  }
};

/**
 * Storage path of the preview image. Layout: {householdId}/{photoId}/thumb.jpg
 *
 * JPEG, not WebP: WebP encoding in expo-image-manipulator is Android-only, and a
 * thumbnail format that silently fails on the other parent's iPhone is not worth
 * the ~20 % it would save on files that are already ~40 KB.
 */
export function buildThumbKey(householdId: string, photoId: string): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(photoId, 'photoId');
  return `${householdId}/${photoId}/thumb.jpg`;
}

/** Storage path of the untouched original. Layout: {householdId}/{photoId}/orig.{ext} */
export function buildOriginalKey(
  householdId: string,
  photoId: string,
  mime: string | null | undefined,
): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(photoId, 'photoId');
  return `${householdId}/${photoId}/orig.${extensionForMime(mime)}`;
}

/**
 * Human label for a child's age on a given day, in German.
 *
 * Months are deliberately NOT used: "month" has no fixed length in days, so a
 * day-count can't express it honestly. Days give way to weeks after four weeks,
 * and to years after one year. Revisit when the app grows past infancy.
 */
export function formatAgeLabel(ageDays: number | null | undefined): string {
  if (ageDays === null || ageDays === undefined) {
    return '';
  }
  if (ageDays < 0) {
    return 'vor der Geburt';
  }
  if (ageDays === 0) {
    return 'Geburtstag';
  }
  if (ageDays < 28) {
    return `Tag ${ageDays}`;
  }
  if (ageDays < 365) {
    return `Woche ${Math.floor(ageDays / 7)}`;
  }
  const years = Math.floor(ageDays / 365);
  return years === 1 ? '1 Jahr' : `${years} Jahre`;
}

/**
 * Whether a photo's `occurred_at` was actually measured rather than guessed
 * — drives the "Datum geschätzt" hint in the fullscreen viewer (deliberately
 * NOT shown in the grid, where it would only clutter a tile). Only EXIF and
 * an explicit user correction count as certain; MediaLibrary/file-mtime/
 * import-time are all fallbacks, and a legacy row with no source recorded
 * (`null`, imported before this column existed) is treated the same way —
 * "unknown" must never read as "confirmed".
 */
export function isOccurredAtEstimated(source: OccurredAtSource | null): boolean {
  return source !== 'exif' && source !== 'user_corrected';
}

type FullscreenPhotoKeys = {
  local_uri: string | null;
  original_key: string | null;
};

/**
 * Which URI the fullscreen viewer should show: the local staged file while it
 * still exists on this device (instant, no network round trip), otherwise the
 * signed URL for the original in object storage. Mirrors the same preference
 * the grid tiles use for their thumbnail, just against `original_key`.
 */
export function resolveFullscreenUri(
  photo: FullscreenPhotoKeys,
  signedUrls: ReadonlyMap<string, string>,
): string | undefined {
  if (photo.local_uri) {
    return photo.local_uri;
  }
  if (!photo.original_key) {
    return undefined;
  }
  return signedUrls.get(photo.original_key);
}

type GroupablePhoto = {
  local_date: string;
  occurred_at: string;
};

/**
 * Group photos into day sections, newest day first and newest photo first within
 * a day. Grouping uses `local_date` (frozen at insert from the capture timezone),
 * never a recomputed date — so a photo taken at 23:50 stays on that evening even
 * if the family later moves timezones.
 *
 * Deliberately carries no age — a section's age-on-that-day is computed live
 * by the caller from `children.birth_at` (via `core/time#ageInDays`) instead
 * of trusting any photo's stored `age_days`, so it stays correct even after a
 * birth date/time correction. See features/household/repository.ts#updateChild.
 */
export function groupPhotosByDay<T extends GroupablePhoto>(
  rows: readonly T[],
): { localDate: string; photos: T[] }[] {
  const byDate = new Map<string, T[]>();

  for (const row of rows) {
    const bucket = byDate.get(row.local_date);
    if (bucket) {
      bucket.push(row);
    } else {
      byDate.set(row.local_date, [row]);
    }
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([localDate, photos]) => ({
      localDate,
      photos: [...photos].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    }));
}
