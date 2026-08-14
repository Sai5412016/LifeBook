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

import { secondsBetween } from '@/core/time';

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

/**
 * Storage path of the mid-size rendition. Layout: {householdId}/{photoId}/medium.jpg
 *
 * 2026-08-13: added so the fullscreen viewer no longer has to load the
 * multi-megabyte original just to fill the screen (106 photos / 628 MB
 * measured live — the original was the whole reason opening a photo was
 * slow). Always JPEG for the same reason as the thumbnail: a format that
 * silently fails to encode on one platform is worse than the few percent
 * WebP would save.
 */
export function buildMediumKey(householdId: string, photoId: string): string {
  assertPathSafe(householdId, 'householdId');
  assertPathSafe(photoId, 'photoId');
  return `${householdId}/${photoId}/medium.jpg`;
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
  medium_key: string | null;
  original_key: string | null;
};

/** What to render for a photo, and which object it actually is. */
export type ResolvedPhotoDisplay = {
  uri: string;
  /**
   * The object storage key `uri` corresponds to — even when `uri` is a local
   * file:// path, not the object's own remote URL. This is what
   * expo-image's `cacheKey` gets set to (Aufgabe 4b): a signed URL is
   * re-issued on every expiry and a freshly imported photo's `uri` starts as
   * a local file and later becomes a remote one once uploaded — same photo,
   * same bytes, different string both times. Tagging every rendition with
   * the one thing that DOESN'T change (the object key) is what lets the
   * on-device image cache survive both kinds of churn instead of treating
   * each new `uri` as a different picture and re-downloading it.
   */
  cacheKey: string;
};

/**
 * Which object the fullscreen viewer should show, first match wins:
 * 1. the local staged file, while it still exists on this device (instant,
 *    no network round trip);
 * 2. the mid-size rendition (medium_key) — enough resolution to fill a
 *    phone screen without the multi-megabyte original;
 * 3. the original, as the final fallback (no medium yet — either still
 *    uploading, or an older photo that predates this column and hasn't
 *    self-healed yet, see ./storage.ts#healMissingMedium).
 *
 * Mirrors the grid tiles' own local-first preference, just extended with the
 * medium step they don't need (a thumbnail tile never had to fall back to
 * anything larger).
 */
export function resolveFullscreenUri(
  photo: FullscreenPhotoKeys,
  signedUrls: ReadonlyMap<string, string>,
): ResolvedPhotoDisplay | undefined {
  const remoteKey = photo.medium_key ?? photo.original_key;

  if (photo.local_uri) {
    // Falls back to the local path itself only in the (practically
    // unreachable) case where a row has neither key yet — still shows the
    // photo, just without the cross-rendition cache alignment above.
    return { uri: photo.local_uri, cacheKey: remoteKey ?? photo.local_uri };
  }

  if (photo.medium_key) {
    const mediumUrl = signedUrls.get(photo.medium_key);
    if (mediumUrl) {
      return { uri: mediumUrl, cacheKey: photo.medium_key };
    }
  }

  if (!photo.original_key) {
    return undefined;
  }
  const originalUrl = signedUrls.get(photo.original_key);
  return originalUrl ? { uri: originalUrl, cacheKey: photo.original_key } : undefined;
}

/**
 * Whether a cached signed URL must be re-signed before being handed out
 * again — pure time comparison, the actual cache (storage.ts) is the only
 * caller. `safetyMarginSeconds` means the deciding instant is `now +
 * margin`, not `now` itself: a URL with a few seconds left but not enough to
 * safely finish loading an image counts as expired too, so a slow load can
 * never have its URL go invalid partway through (Aufgabe 4a).
 */
export function shouldResignUrl(
  expiresAtUtcIso: string,
  nowUtcIso: string,
  safetyMarginSeconds: number,
): boolean {
  return secondsBetween(nowUtcIso, expiresAtUtcIso) <= safetyMarginSeconds;
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

export type MediumBackfillProgress = {
  /** Photos that already have a medium rendition. */
  prepared: number;
  /** Every photo being tracked (the caller's query already excludes deleted ones). */
  total: number;
};

/**
 * Counts how many of the given photos already have a medium rendition.
 *
 * Fehler 2, 2026-08-14: a `SUM(CASE WHEN medium_key IS NOT NULL THEN 1 ELSE
 * 0 END)` computed inside the SQL query showed "107 von 108" on a device
 * where only 1 photo actually had a medium key — the count and the label
 * had silently swapped meaning somewhere between the query and the screen.
 * Counting in plain, testable JS with named fields (`prepared`/`total`,
 * not two positional numbers a caller could transpose) removes the
 * opaque SQL expression as a place for that to happen again.
 */
export function countMediumBackfillProgress(
  photos: readonly { medium_key: string | null }[],
): MediumBackfillProgress {
  const prepared = photos.reduce((count, photo) => count + (photo.medium_key ? 1 : 0), 0);
  return { prepared, total: photos.length };
}

/**
 * The Einstellungen "Vorbereitet: X von Y" line, or null once there is
 * nothing left to prepare (no photos at all, or every one already has a
 * medium rendition) — a progress line permanently stuck at "108 von 108" is
 * just noise, not information.
 */
export function formatMediumBackfillLabel(progress: MediumBackfillProgress): string | null {
  if (progress.total === 0) {
    return null;
  }
  if (progress.prepared >= progress.total) {
    return 'Alle Fotos vorbereitet';
  }
  return `Vorbereitet: ${progress.prepared} von ${progress.total}`;
}

export type MediumBackfillCandidates = {
  /** Ids of every photo still missing a medium rendition. */
  ids: string[];
  /** This batch's own average ORIGINAL size — what a backfill run actually downloads per photo. */
  averageOriginalBytes: number;
};

/**
 * Summarizes the photos still missing a medium rendition: which ones, and
 * their average original size — the basis for the "Alle Fotos vorbereiten"
 * confirmation estimate (task: computed from the album's real data, never a
 * guessed or hardcoded number). `photos` is expected to already be filtered
 * to "no medium_key yet" (repository.ts's query does that); this only
 * summarizes what is left. Photos with an unknown size (`bytes` null or 0 —
 * shouldn't happen for a real row, but the type allows it) are excluded
 * from the average rather than treated as zero, which would understate it.
 */
export function selectMediumBackfillCandidates(
  photos: readonly { id: string; bytes: number | null }[],
): MediumBackfillCandidates {
  const ids = photos.map((photo) => photo.id);
  const knownBytes = photos
    .map((photo) => photo.bytes)
    .filter((bytes): bytes is number => bytes != null && bytes > 0);
  const averageOriginalBytes =
    knownBytes.length > 0 ? knownBytes.reduce((sum, bytes) => sum + bytes, 0) / knownBytes.length : 0;
  return { ids, averageOriginalBytes };
}

/** "≈ 600 MB" / "≈ 1.2 GB" — never claims false precision, never shows "0 MB" for a non-empty estimate. */
export function formatEstimatedDownloadSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 MB';
  }
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(megabytes))} MB`;
}

/**
 * The "Alle Fotos vorbereiten" confirmation dialog's body — an honest
 * account of what the run is about to do, not just a bare "sind Sie
 * sicher?". `averageOriginalBytes` is `selectMediumBackfillCandidates`'s
 * own measured average, multiplied out here rather than the caller
 * guessing or hardcoding a number.
 */
export function formatMediumBackfillConfirmation(pendingCount: number, averageOriginalBytes: number): string {
  const photosLabel = pendingCount === 1 ? '1 Foto ist noch offen' : `${pendingCount} Fotos sind noch offen`;
  const estimate = formatEstimatedDownloadSize(pendingCount * averageOriginalBytes);
  return `${photosLabel}, geschätzt ${estimate} werden über WLAN geladen.`;
}

export type MediumBackfillItemOutcome = 'healed' | 'failed';

export type MediumBackfillRunState = {
  /** Ids not yet attempted this run, in order. */
  queue: readonly string[];
  /** Fixed at the start of the run — how many photos this run set out to prepare. */
  total: number;
  healed: number;
  failed: number;
};

/**
 * Ablaufsteuerung for the "Alle Fotos vorbereiten" batch run — pure so
 * "what's next", "when is it done" and "how does progress count" are
 * verifiable without a device, a database, or a network. The actual async
 * work (storage.ts#runMediumBackfill) is a thin loop driven by these four
 * functions; it decides nothing on its own.
 */
export function startMediumBackfillRun(pendingIds: readonly string[]): MediumBackfillRunState {
  return { queue: pendingIds, total: pendingIds.length, healed: 0, failed: 0 };
}

/** Nothing left to attempt this run — not the same as "everything succeeded", see `failed`. */
export function isMediumBackfillRunComplete(state: MediumBackfillRunState): boolean {
  return state.queue.length === 0;
}

/** The id that should be attempted next, or null once the run is complete. */
export function nextMediumBackfillId(state: MediumBackfillRunState): string | null {
  return state.queue[0] ?? null;
}

/**
 * Advances past the item at the front of the queue, recording whether it
 * succeeded. A failure only increments `failed` and moves on — it does
 * NOT stop the run, so one bad photo can never block the rest (task
 * requirement, verified by a dedicated test).
 */
export function advanceMediumBackfillRun(
  state: MediumBackfillRunState,
  outcome: MediumBackfillItemOutcome,
): MediumBackfillRunState {
  return {
    queue: state.queue.slice(1),
    total: state.total,
    healed: state.healed + (outcome === 'healed' ? 1 : 0),
    failed: state.failed + (outcome === 'failed' ? 1 : 0),
  };
}

/** Split a day's photos into fixed-width rows for the Chronik grid. */
export function chunkPhotos<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}

export type PhotoGridPosition = {
  sectionIndex: number;
  /** Row index within that day's CHUNKED rows (see chunkPhotos), not a raw photo index. */
  itemIndex: number;
};

/**
 * Where a specific photo sits in the Chronik's SectionList — which day
 * section, and which chunked row within it.
 *
 * 2026-08-14 (Fehler 1 follow-up): the fullscreen viewer can be swiped
 * several photos away from wherever it was opened before "Zurück" is
 * pressed. Chronik's OWN scroll position stays untouched while the viewer
 * is open (that's the fix — see app/_layout.tsx's NavigationGate), so on
 * return it would still show the ORIGINAL tap target, not wherever the
 * user actually ended up. This is what lets Chronik scroll itself to the
 * right row instead — see photos/lastViewed.ts for how the viewer reports
 * that final photo back.
 */
export function locatePhotoInSections<T extends { id: string }>(
  sections: readonly { photos: readonly T[] }[],
  photoId: string,
  columns: number,
): PhotoGridPosition | null {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const photoIndex = sections[sectionIndex].photos.findIndex((photo) => photo.id === photoId);
    if (photoIndex !== -1) {
      return { sectionIndex, itemIndex: Math.floor(photoIndex / columns) };
    }
  }
  return null;
}

/* ────────────────────────────── Papierkorb (2026-08-15) ────────────────────────────── */

/**
 * How long a soft-deleted photo stays recoverable before the automatic
 * sweep (storage.ts#runTrashCleanupSweep) removes it for good.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Whether a soft-deleted photo is due for permanent removal — "older than
 * `retentionDays`" is deliberately exclusive (exactly `retentionDays` old
 * is NOT yet due), so a photo gets one full clean retention window before
 * anything irreversible happens to it.
 *
 * Never deletes on uncertain input: `deletedAtUtcIso === null` (never
 * deleted) and an unparseable value (`secondsBetween` resolves to `NaN` for
 * either endpoint) both return false rather than guessing — a photo this
 * function can't confidently place in time must not be swept.
 */
export function isPhotoDueForCleanup(
  deletedAtUtcIso: string | null,
  nowUtcIso: string,
  retentionDays: number = TRASH_RETENTION_DAYS,
): boolean {
  if (!deletedAtUtcIso) {
    return false;
  }
  const elapsedSeconds = secondsBetween(deletedAtUtcIso, nowUtcIso);
  if (!Number.isFinite(elapsedSeconds)) {
    return false;
  }
  return elapsedSeconds > retentionDays * 24 * 60 * 60;
}

/**
 * "noch 12 Tage" — the trash row's remaining-time label. Rounds UP to whole
 * days (a photo deleted an hour ago still reads "noch 30 Tage", not "noch
 * 0 Tage") so the number only ever counts down once a full day has
 * actually elapsed, matching `isPhotoDueForCleanup`'s own exclusive
 * boundary above.
 */
export function formatTrashRemainingLabel(
  deletedAtUtcIso: string,
  nowUtcIso: string,
  retentionDays: number = TRASH_RETENTION_DAYS,
): string {
  const elapsedSeconds = secondsBetween(deletedAtUtcIso, nowUtcIso);
  const secondsPerDay = 24 * 60 * 60;
  const remainingSeconds = retentionDays * secondsPerDay - (Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const remainingDays = Math.max(0, Math.ceil(remainingSeconds / secondsPerDay));
  if (remainingDays === 0) {
    return 'läuft heute ab';
  }
  return remainingDays === 1 ? 'noch 1 Tag' : `noch ${remainingDays} Tage`;
}

/** The revoke-style confirmation shown before restoring a photo from the trash — states plainly that it reappears everywhere, including any share, since that surprise is the whole point of asking first. */
export function formatPhotoRestoreConfirmation(): string {
  return 'Das Foto erscheint wieder in der Chronik, auf beiden Handys — und, falls es Teil einer Freigabe war, auch dort wieder.';
}

/** The confirmation before permanently deleting ONE photo from the trash ahead of the 30-day window. */
export function formatPermanentDeleteConfirmation(): string {
  return 'Das Foto wird jetzt endgültig gelöscht und kann nicht wiederhergestellt werden.';
}

/** The "Papierkorb leeren" confirmation — names the exact count, singular/plural. */
export function formatEmptyTrashConfirmation(count: number): string {
  if (count === 1) {
    return '1 Foto wird jetzt endgültig gelöscht und kann nicht wiederhergestellt werden.';
  }
  return `${count} Fotos werden jetzt endgültig gelöscht und können nicht wiederhergestellt werden.`;
}

/* ────────────────────────────── Bildunterschrift (2026-08-15) ────────────────────────────── */

export const PHOTO_NOTE_MAX_LENGTH = 500;

/**
 * Trims a photo caption and enforces the length cap regardless of how the
 * text arrived — the edit form's own `maxLength` already stops a user from
 * TYPING past it, but the invariant belongs here, not only in an input
 * widget's configuration. A blank (or whitespace-only) result means "no
 * caption", so callers write `null` — deleting any existing note — rather
 * than storing an empty string, matching `PhotoRow.note`'s own contract.
 */
export function normalizePhotoNote(input: string): string | null {
  const trimmed = input.trim().slice(0, PHOTO_NOTE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

export type ChronologicalRank = {
  /** 1-based, ascending by occurred_at — 1 is the OLDEST photo. */
  rank: number;
  total: number;
};

type RankablePhoto = { id: string; occurred_at: string };

/**
 * A photo's rank in the child's life, oldest first — 2026-08-14: the
 * fullscreen header showed "1 von 123" for the NEWEST photo, because it
 * used the swipe list's own position, and that list is (deliberately)
 * newest-first (see repository.ts#usePhotosOfChild / groupPhotosByDay
 * above — the Chronik's ordering is not changing). The number in the
 * header is a different thing entirely: it describes the child's life
 * ("this is photo 1 of 123 ever taken"), not where the photo sits in that
 * list — so this sorts independently rather than deriving anything from
 * list position or the swipe direction, both of which stay newest-first.
 *
 * Ties on `occurred_at` (burst shots from the same instant) are broken by
 * `id` — arbitrary, but STABLE: without a tiebreaker, `Array.prototype.sort`
 * on JS's own default gives no ordering guarantee for two equal timestamps,
 * so photos from the same burst could swap ranks between renders and the
 * number would appear to flicker for no reason.
 *
 * Returns null when `photoId` isn't in `photos` (not loaded yet, or
 * deleted) rather than a fabricated rank.
 */
export function chronologicalRank<T extends RankablePhoto>(
  photos: readonly T[],
  photoId: string,
): ChronologicalRank | null {
  const sorted = [...photos].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id),
  );
  const index = sorted.findIndex((photo) => photo.id === photoId);
  if (index === -1) {
    return null;
  }
  return { rank: index + 1, total: sorted.length };
}
