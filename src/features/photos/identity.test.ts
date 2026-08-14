import { describe, expect, it } from 'vitest';

import {
  PHOTO_BACKUP_ALBUM_NAME,
  PHOTO_NOTE_MAX_LENGTH,
  TRASH_RETENTION_DAYS,
  advanceMediumBackfillRun,
  advancePhotoBackupRun,
  advanceSequentialRun,
  buildMediumKey,
  buildOriginalKey,
  buildThumbKey,
  chronologicalRank,
  chunkPhotos,
  composeContentHash,
  countMediumBackfillProgress,
  dedupeByHash,
  estimateBatchBytes,
  extensionForMime,
  formatAgeLabel,
  formatEmptyTrashConfirmation,
  formatEstimatedDownloadSize,
  formatMediumBackfillConfirmation,
  formatMediumBackfillLabel,
  formatPermanentDeleteConfirmation,
  formatPhotoBackupConfirmation,
  formatPhotoBackupStatusLabel,
  formatPhotoRestoreConfirmation,
  formatTrashRemainingLabel,
  groupPhotosByDay,
  isMediumBackfillRunComplete,
  isOccurredAtEstimated,
  isPhotoBackupRunComplete,
  isPhotoDueForCleanup,
  isSequentialRunComplete,
  locatePhotoInSections,
  nextMediumBackfillId,
  nextPhotoBackupId,
  nextSequentialRunId,
  normalizePhotoNote,
  resolveFullscreenUri,
  selectMediumBackfillCandidates,
  selectPhotoBackupCandidates,
  shouldResignUrl,
  startMediumBackfillRun,
  startPhotoBackupRun,
  startSequentialRun,
} from './identity';

const hash = (n: string) => composeContentHash(`sha-${n}`, 1000);

describe('composeContentHash', () => {
  it('includes the byte count, so a prefix collision is not enough', () => {
    expect(composeContentHash('abc', 1000)).not.toBe(composeContentHash('abc', 1001));
  });

  it('is stable for identical input', () => {
    expect(composeContentHash('abc', 42)).toBe(composeContentHash('abc', 42));
  });
});

describe('dedupeByHash', () => {
  it('drops candidates already stored in the album', () => {
    const candidates = [{ contentHash: hash('a') }, { contentHash: hash('b') }];
    const { fresh, duplicates } = dedupeByHash(candidates, [hash('a')]);

    expect(fresh).toEqual([{ contentHash: hash('b') }]);
    expect(duplicates).toEqual([{ contentHash: hash('a') }]);
  });

  it('drops the same photo picked twice within one batch', () => {
    const candidates = [
      { contentHash: hash('a'), n: 1 },
      { contentHash: hash('a'), n: 2 },
    ];
    const { fresh, duplicates } = dedupeByHash(candidates, []);

    // First occurrence wins, so the kept row is the one the user saw first.
    expect(fresh).toEqual([{ contentHash: hash('a'), n: 1 }]);
    expect(duplicates).toEqual([{ contentHash: hash('a'), n: 2 }]);
  });

  it('keeps everything when nothing matches, preserving order', () => {
    const candidates = [{ contentHash: hash('a') }, { contentHash: hash('b') }];
    expect(dedupeByHash(candidates, [hash('z')]).fresh).toEqual(candidates);
  });

  it('handles an empty pick', () => {
    expect(dedupeByHash([], [hash('a')])).toEqual({ fresh: [], duplicates: [] });
  });
});

describe('storage keys', () => {
  it('puts the household id first — the access rules match on that segment', () => {
    expect(buildThumbKey('hh1', 'p1')).toBe('hh1/p1/thumb.jpg');
    expect(buildMediumKey('hh1', 'p1')).toBe('hh1/p1/medium.jpg');
    expect(buildOriginalKey('hh1', 'p1', 'image/png')).toBe('hh1/p1/orig.png');
  });

  it('falls back to jpg for unknown or missing mime types', () => {
    expect(extensionForMime(null)).toBe('jpg');
    expect(extensionForMime('application/octet-stream')).toBe('jpg');
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg');
  });

  it.each([
    ['../other-household', 'p1'],
    ['hh1/nested', 'p1'],
    ['hh1', 'p1/../../escape'],
    ['', 'p1'],
  ])('refuses ids that could escape the household folder (%s, %s)', (hh, pid) => {
    expect(() => buildThumbKey(hh, pid)).toThrow(/unsafe/);
    expect(() => buildMediumKey(hh, pid)).toThrow(/unsafe/);
    expect(() => buildOriginalKey(hh, pid, 'image/jpeg')).toThrow(/unsafe/);
  });
});

describe('formatAgeLabel', () => {
  it.each([
    [null, ''],
    [-1, 'vor der Geburt'],
    [0, 'Geburtstag'],
    [1, 'Tag 1'],
    [4, 'Tag 4'],
    [27, 'Tag 27'],
    [28, 'Woche 4'],
    [364, 'Woche 52'],
    [365, '1 Jahr'],
    [800, '2 Jahre'],
  ])('formats %s as "%s"', (days, expected) => {
    expect(formatAgeLabel(days)).toBe(expected);
  });
});

describe('resolveFullscreenUri', () => {
  // "alle drei vorhanden": local file, a resolved medium URL AND a resolved
  // original URL all available at once — local still wins.
  it('prefers the local staged file over either signed URL', () => {
    const photo = { local_uri: 'file:///staged.jpg', medium_key: 'hh1/p1/medium.jpg', original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([
      ['hh1/p1/medium.jpg', 'https://signed/medium.jpg'],
      ['hh1/p1/orig.jpg', 'https://signed/orig.jpg'],
    ]);

    expect(resolveFullscreenUri(photo, signedUrls)).toEqual({
      uri: 'file:///staged.jpg',
      cacheKey: 'hh1/p1/medium.jpg',
    });
  });

  it('tags the local file with the eventual remote key it will become, so the cache survives the handoff', () => {
    const photo = { local_uri: 'file:///staged.jpg', medium_key: null, original_key: 'hh1/p1/orig.jpg' };

    expect(resolveFullscreenUri(photo, new Map())).toEqual({
      uri: 'file:///staged.jpg',
      cacheKey: 'hh1/p1/orig.jpg',
    });
  });

  it('prefers the medium rendition once the local file is gone', () => {
    const photo = { local_uri: null, medium_key: 'hh1/p1/medium.jpg', original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([
      ['hh1/p1/medium.jpg', 'https://signed/medium.jpg'],
      ['hh1/p1/orig.jpg', 'https://signed/orig.jpg'],
    ]);

    expect(resolveFullscreenUri(photo, signedUrls)).toEqual({
      uri: 'https://signed/medium.jpg',
      cacheKey: 'hh1/p1/medium.jpg',
    });
  });

  // "nur Original": no medium key on the row at all (a legacy photo that
  // predates the column and hasn't self-healed yet) — falls straight to it.
  it('falls back to the original when the row has no medium key', () => {
    const photo = { local_uri: null, medium_key: null, original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([['hh1/p1/orig.jpg', 'https://signed/orig.jpg']]);

    expect(resolveFullscreenUri(photo, signedUrls)).toEqual({
      uri: 'https://signed/orig.jpg',
      cacheKey: 'hh1/p1/orig.jpg',
    });
  });

  it('falls back to the original when the medium key exists but has not signed yet', () => {
    const photo = { local_uri: null, medium_key: 'hh1/p1/medium.jpg', original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([['hh1/p1/orig.jpg', 'https://signed/orig.jpg']]);

    expect(resolveFullscreenUri(photo, signedUrls)).toEqual({
      uri: 'https://signed/orig.jpg',
      cacheKey: 'hh1/p1/orig.jpg',
    });
  });

  // "nur Vorschau": only some unrelated (thumbnail-like) key has resolved —
  // fullscreen never falls back to it, so nothing renders yet.
  it('ignores a resolved URL for a key that is not this photo\'s medium or original', () => {
    const photo = { local_uri: null, medium_key: 'hh1/p1/medium.jpg', original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([['hh1/p1/thumb.jpg', 'https://signed/thumb.jpg']]);

    expect(resolveFullscreenUri(photo, signedUrls)).toBeUndefined();
  });

  // "nichts": no local file, no keys at all.
  it('returns undefined when there is nothing to show', () => {
    const photo = { local_uri: null, medium_key: null, original_key: null };

    expect(resolveFullscreenUri(photo, new Map())).toBeUndefined();
  });
});

describe('shouldResignUrl', () => {
  it('is false while comfortably before expiry', () => {
    expect(shouldResignUrl('2026-08-08T13:00:00Z', '2026-08-08T12:00:00Z', 60)).toBe(false);
  });

  it('is true once expired', () => {
    expect(shouldResignUrl('2026-08-08T12:00:00Z', '2026-08-08T12:00:01Z', 60)).toBe(true);
  });

  it('is true inside the safety margin, even though not technically expired yet', () => {
    // 30s left on a 60s margin — still counts as "must re-sign", so a slow
    // image load can never have its URL go invalid mid-request.
    expect(shouldResignUrl('2026-08-08T12:00:30Z', '2026-08-08T12:00:00Z', 60)).toBe(true);
  });

  it('is true exactly at the safety margin boundary', () => {
    expect(shouldResignUrl('2026-08-08T12:01:00Z', '2026-08-08T12:00:00Z', 60)).toBe(true);
  });

  it('is false one second outside the safety margin', () => {
    expect(shouldResignUrl('2026-08-08T12:01:01Z', '2026-08-08T12:00:00Z', 60)).toBe(false);
  });
});

describe('isOccurredAtEstimated', () => {
  it('is not estimated when it came from EXIF', () => {
    expect(isOccurredAtEstimated('exif')).toBe(false);
  });

  it('is not estimated once a user has confirmed it via a correction', () => {
    expect(isOccurredAtEstimated('user_corrected')).toBe(false);
  });

  it.each(['media_library', 'file_mtime', 'import_time'] as const)(
    'is estimated for the %s fallback',
    (source) => {
      expect(isOccurredAtEstimated(source)).toBe(true);
    },
  );

  it('treats a legacy row with no recorded source as estimated, not confirmed', () => {
    expect(isOccurredAtEstimated(null)).toBe(true);
  });
});

describe('groupPhotosByDay', () => {
  const photo = (local_date: string, occurred_at: string) => ({
    local_date,
    occurred_at,
  });

  it('groups by local_date, newest day first', () => {
    const sections = groupPhotosByDay([
      photo('2026-08-05', '2026-08-05T10:00:00Z'),
      photo('2026-08-07', '2026-08-07T10:00:00Z'),
      photo('2026-08-05', '2026-08-05T12:00:00Z'),
    ]);

    expect(sections.map((s) => s.localDate)).toEqual(['2026-08-07', '2026-08-05']);
    expect(sections[1].photos).toHaveLength(2);
  });

  it('sorts newest photo first inside a day', () => {
    const sections = groupPhotosByDay([
      photo('2026-08-05', '2026-08-05T08:00:00Z'),
      photo('2026-08-05', '2026-08-05T20:00:00Z'),
    ]);

    expect(sections[0].photos.map((p) => p.occurred_at)).toEqual([
      '2026-08-05T20:00:00Z',
      '2026-08-05T08:00:00Z',
    ]);
  });

  it('returns nothing for an empty album', () => {
    expect(groupPhotosByDay([])).toEqual([]);
  });
});

describe('countMediumBackfillProgress', () => {
  const photo = (medium_key: string | null) => ({ medium_key });

  it('nothing prepared', () => {
    expect(countMediumBackfillProgress([photo(null), photo(null), photo(null)])).toEqual({
      prepared: 0,
      total: 3,
    });
  });

  it('everything prepared', () => {
    expect(countMediumBackfillProgress([photo('a'), photo('b')])).toEqual({
      prepared: 2,
      total: 2,
    });
  });

  it('somewhere in between', () => {
    // The exact case from the bug report: 108 photos, 4 with a medium_key.
    const photos = [
      ...Array.from({ length: 4 }, () => photo('some-key')),
      ...Array.from({ length: 104 }, () => photo(null)),
    ];
    expect(countMediumBackfillProgress(photos)).toEqual({ prepared: 4, total: 108 });
  });

  it('an empty album', () => {
    expect(countMediumBackfillProgress([])).toEqual({ prepared: 0, total: 0 });
  });
});

describe('formatMediumBackfillLabel', () => {
  it('shows nothing prepared out of the total', () => {
    expect(formatMediumBackfillLabel({ prepared: 0, total: 108 })).toBe('Vorbereitet: 0 von 108');
  });

  it('shows the in-between count — never a swapped pair', () => {
    expect(formatMediumBackfillLabel({ prepared: 4, total: 108 })).toBe('Vorbereitet: 4 von 108');
  });

  it('says everything is done instead of showing "108 von 108"', () => {
    expect(formatMediumBackfillLabel({ prepared: 108, total: 108 })).toBe('Alle Fotos vorbereitet');
  });

  it('returns null for an empty album — no line at all', () => {
    expect(formatMediumBackfillLabel({ prepared: 0, total: 0 })).toBeNull();
  });
});

describe('selectMediumBackfillCandidates', () => {
  const photo = (id: string, bytes: number | null) => ({ id, bytes });

  it('averages the known sizes', () => {
    expect(selectMediumBackfillCandidates([photo('a', 4_000_000), photo('b', 8_000_000)])).toEqual({
      ids: ['a', 'b'],
      averageOriginalBytes: 6_000_000,
    });
  });

  it('ignores photos with an unknown size when averaging, but still lists their id', () => {
    expect(selectMediumBackfillCandidates([photo('a', 4_000_000), photo('b', null)])).toEqual({
      ids: ['a', 'b'],
      averageOriginalBytes: 4_000_000,
    });
  });

  it('returns a zero average rather than NaN when nothing has a known size', () => {
    expect(selectMediumBackfillCandidates([photo('a', null), photo('b', 0)])).toEqual({
      ids: ['a', 'b'],
      averageOriginalBytes: 0,
    });
  });

  it('returns nothing for an empty list', () => {
    expect(selectMediumBackfillCandidates([])).toEqual({ ids: [], averageOriginalBytes: 0 });
  });
});

describe('formatEstimatedDownloadSize', () => {
  it('formats a typical batch in MB', () => {
    expect(formatEstimatedDownloadSize(600 * 1024 * 1024)).toBe('600 MB');
  });

  it('switches to GB past 1024 MB, with one decimal', () => {
    expect(formatEstimatedDownloadSize(1.2 * 1024 * 1024 * 1024)).toBe('1.2 GB');
  });

  it('never shows "0 MB" for a genuinely non-zero estimate', () => {
    expect(formatEstimatedDownloadSize(200 * 1024)).toBe('1 MB');
  });

  it('shows exactly 0 MB only for a zero estimate', () => {
    expect(formatEstimatedDownloadSize(0)).toBe('0 MB');
  });
});

describe('formatMediumBackfillConfirmation', () => {
  it('names the count and a computed estimate — not a guessed or hardcoded number', () => {
    expect(formatMediumBackfillConfirmation(100, 6 * 1024 * 1024)).toBe(
      '100 Fotos sind noch offen, geschätzt 600 MB werden über WLAN geladen.',
    );
  });

  it('has dedicated wording for a single photo', () => {
    expect(formatMediumBackfillConfirmation(1, 6 * 1024 * 1024)).toBe(
      '1 Foto ist noch offen, geschätzt 6 MB werden über WLAN geladen.',
    );
  });
});

describe('medium backfill run state machine', () => {
  it('nichts offen: starts already complete', () => {
    const state = startMediumBackfillRun([]);
    expect(isMediumBackfillRunComplete(state)).toBe(true);
    expect(state.total).toBe(0);
    expect(nextMediumBackfillId(state)).toBeNull();
  });

  it('alles offen: runs through every id and ends complete', () => {
    let state = startMediumBackfillRun(['a', 'b', 'c']);
    expect(isMediumBackfillRunComplete(state)).toBe(false);

    state = advanceMediumBackfillRun(state, 'healed');
    state = advanceMediumBackfillRun(state, 'healed');
    state = advanceMediumBackfillRun(state, 'healed');

    expect(isMediumBackfillRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 3, succeeded: 3, failed: 0 });
  });

  it('Abbruch mitten im Lauf: the untouched ids stay queued, nothing already done is lost', () => {
    let state = startMediumBackfillRun(['a', 'b', 'c', 'd', 'e']);
    state = advanceMediumBackfillRun(state, 'healed');
    state = advanceMediumBackfillRun(state, 'healed');
    // Simulates cancelling here — the caller just stops calling advance.
    expect(isMediumBackfillRunComplete(state)).toBe(false);
    expect(state.queue).toEqual(['c', 'd', 'e']);
    expect(state.succeeded).toBe(2);
    expect(state.total).toBe(5);
  });

  it('einzelner Fehlschlag unterbricht nicht: the queue keeps moving past a failure', () => {
    let state = startMediumBackfillRun(['a', 'b', 'c']);
    state = advanceMediumBackfillRun(state, 'healed');
    state = advanceMediumBackfillRun(state, 'failed');
    expect(isMediumBackfillRunComplete(state)).toBe(false);
    expect(nextMediumBackfillId(state)).toBe('c');

    state = advanceMediumBackfillRun(state, 'healed');
    expect(isMediumBackfillRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 3, succeeded: 2, failed: 1 });
  });

  it('nextMediumBackfillId always names the front of the queue', () => {
    const state = startMediumBackfillRun(['first', 'second']);
    expect(nextMediumBackfillId(state)).toBe('first');
  });
});

describe('chunkPhotos', () => {
  it('splits into fixed-width rows', () => {
    expect(chunkPhotos([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('leaves a shorter final row', () => {
    expect(chunkPhotos([1, 2, 3, 4, 5], 3)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkPhotos([], 3)).toEqual([]);
  });
});

describe('locatePhotoInSections', () => {
  const photo = (id: string) => ({ id });
  const sections = [
    { photos: [photo('a'), photo('b'), photo('c'), photo('d')] },
    { photos: [photo('e'), photo('f')] },
  ];

  it('finds a photo in the first row of its section', () => {
    expect(locatePhotoInSections(sections, 'a', 3)).toEqual({ sectionIndex: 0, itemIndex: 0 });
  });

  it('finds a photo in a LATER row within its section', () => {
    // columns=3: a,b,c are row 0, d is row 1.
    expect(locatePhotoInSections(sections, 'd', 3)).toEqual({ sectionIndex: 0, itemIndex: 1 });
  });

  it('finds a photo in a later section', () => {
    expect(locatePhotoInSections(sections, 'f', 3)).toEqual({ sectionIndex: 1, itemIndex: 0 });
  });

  it('returns null for a photo not in any section (deleted, or a different child)', () => {
    expect(locatePhotoInSections(sections, 'nope', 3)).toBeNull();
  });

  it('returns null for an empty list of sections', () => {
    expect(locatePhotoInSections([], 'a', 3)).toBeNull();
  });
});

describe('chronologicalRank', () => {
  const photo = (id: string, occurred_at: string) => ({ id, occurred_at });

  // Newest-first, matching how usePhotosOfChild/the Chronik actually order
  // photos — chronologicalRank must NOT just trust that order.
  const photosNewestFirst = [
    photo('newest', '2026-08-13T10:00:00Z'),
    photo('middle', '2026-08-10T10:00:00Z'),
    photo('oldest', '2026-08-01T10:00:00Z'),
  ];

  it('gives the oldest photo rank 1', () => {
    expect(chronologicalRank(photosNewestFirst, 'oldest')).toEqual({ rank: 1, total: 3 });
  });

  it('gives the newest photo the total', () => {
    expect(chronologicalRank(photosNewestFirst, 'newest')).toEqual({ rank: 3, total: 3 });
  });

  it('gives a photo in between its middle rank', () => {
    expect(chronologicalRank(photosNewestFirst, 'middle')).toEqual({ rank: 2, total: 3 });
  });

  it('breaks ties on occurred_at stably by id, repeatably across calls', () => {
    const sameInstant = [
      photo('b', '2026-08-05T10:00:00Z'),
      photo('a', '2026-08-05T10:00:00Z'),
    ];
    const first = chronologicalRank(sameInstant, 'a');
    const second = chronologicalRank(sameInstant, 'a');
    expect(first).toEqual({ rank: 1, total: 2 });
    expect(second).toEqual(first);
    expect(chronologicalRank(sameInstant, 'b')).toEqual({ rank: 2, total: 2 });
  });

  it('returns null for a photo not in the list, instead of a fabricated rank', () => {
    expect(chronologicalRank(photosNewestFirst, 'nope')).toBeNull();
  });

  it('returns "1 von 1" territory for a single-photo album', () => {
    expect(chronologicalRank([photo('only', '2026-08-05T10:00:00Z')], 'only')).toEqual({
      rank: 1,
      total: 1,
    });
  });

  it('a deleted photo leaves no gap — the remaining photos renumber cleanly', () => {
    // Simulates "middle" having been deleted: the caller's list (already
    // excluding it, same as a live query would) still produces a clean
    // 1..total sequence for what's left, not a stale total or a hole.
    const afterDeletion = photosNewestFirst.filter((p) => p.id !== 'middle');
    expect(chronologicalRank(afterDeletion, 'oldest')).toEqual({ rank: 1, total: 2 });
    expect(chronologicalRank(afterDeletion, 'newest')).toEqual({ rank: 2, total: 2 });
  });
});

describe('isPhotoDueForCleanup', () => {
  const now = '2026-08-15T00:00:00.000Z';
  const daysAgo = (days: number) => {
    const date = new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000);
    return date.toISOString();
  };

  it('is not due for a photo just deleted', () => {
    expect(isPhotoDueForCleanup(now, now)).toBe(false);
  });

  it('is not due at 29 days', () => {
    expect(isPhotoDueForCleanup(daysAgo(29), now, TRASH_RETENTION_DAYS)).toBe(false);
  });

  it('is not due at exactly 30 days — the boundary is exclusive', () => {
    expect(isPhotoDueForCleanup(daysAgo(30), now, TRASH_RETENTION_DAYS)).toBe(false);
  });

  it('is due at 31 days', () => {
    expect(isPhotoDueForCleanup(daysAgo(31), now, TRASH_RETENTION_DAYS)).toBe(true);
  });

  it('is never due for a photo that was never deleted', () => {
    expect(isPhotoDueForCleanup(null, now)).toBe(false);
  });

  it('is never due for a nonsensical time value, rather than guessing', () => {
    expect(isPhotoDueForCleanup('not-a-date', now)).toBe(false);
    expect(isPhotoDueForCleanup(now, 'also-not-a-date')).toBe(false);
  });
});

describe('formatTrashRemainingLabel', () => {
  const now = '2026-08-15T00:00:00.000Z';
  const daysAgo = (days: number) => new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();

  it('shows the full retention window right after deletion', () => {
    expect(formatTrashRemainingLabel(now, now)).toBe(`noch ${TRASH_RETENTION_DAYS} Tage`);
  });

  it('counts down as days pass', () => {
    expect(formatTrashRemainingLabel(daysAgo(29), now)).toBe('noch 1 Tag');
  });

  it('reads "läuft heute ab" once the window has fully elapsed', () => {
    expect(formatTrashRemainingLabel(daysAgo(30), now)).toBe('läuft heute ab');
  });
});

describe('trash confirmation texts', () => {
  it('restore confirmation mentions the chronology, both phones and shares', () => {
    const text = formatPhotoRestoreConfirmation();
    expect(text).toContain('Chronik');
    expect(text).toContain('Freigabe');
  });

  it('permanent single-delete confirmation is final', () => {
    expect(formatPermanentDeleteConfirmation()).toContain('kann nicht wiederhergestellt werden');
  });

  it('empty-trash confirmation names the exact count, singular and plural', () => {
    expect(formatEmptyTrashConfirmation(1)).toContain('1 Foto');
    expect(formatEmptyTrashConfirmation(4)).toContain('4 Fotos');
  });
});

describe('normalizePhotoNote', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizePhotoNote('  Am Strand  ')).toBe('Am Strand');
  });

  it('keeps interior newlines — captions are multi-line', () => {
    expect(normalizePhotoNote('Erste Zeile\nZweite Zeile')).toBe('Erste Zeile\nZweite Zeile');
  });

  it('turns an empty input into null, deleting the caption', () => {
    expect(normalizePhotoNote('')).toBeNull();
  });

  it('turns a whitespace-only input into null', () => {
    expect(normalizePhotoNote('   \n  ')).toBeNull();
  });

  it('caps at PHOTO_NOTE_MAX_LENGTH characters', () => {
    const long = 'x'.repeat(PHOTO_NOTE_MAX_LENGTH + 50);
    const result = normalizePhotoNote(long);
    expect(result).toHaveLength(PHOTO_NOTE_MAX_LENGTH);
  });

  it('leaves a note at exactly the cap untouched', () => {
    const exact = 'y'.repeat(PHOTO_NOTE_MAX_LENGTH);
    expect(normalizePhotoNote(exact)).toBe(exact);
  });
});

describe('SequentialRunState (shared Ablaufsteuerung behind Vorbereiten and Sichern)', () => {
  it('nichts zu sichern: starting from an empty list is immediately complete', () => {
    const state = startSequentialRun([]);
    expect(isSequentialRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 0, succeeded: 0, failed: 0 });
    expect(nextSequentialRunId(state)).toBeNull();
  });

  it('alles zu sichern: runs through every id and ends complete, all succeeded', () => {
    let state = startSequentialRun(['a', 'b', 'c']);
    expect(isSequentialRunComplete(state)).toBe(false);

    state = advanceSequentialRun(state, 'succeeded');
    state = advanceSequentialRun(state, 'succeeded');
    state = advanceSequentialRun(state, 'succeeded');

    expect(isSequentialRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 3, succeeded: 3, failed: 0 });
  });

  it('Abbruch mitten im Lauf: the untouched ids stay queued, nothing already done is lost', () => {
    let state = startSequentialRun(['a', 'b', 'c', 'd', 'e']);
    state = advanceSequentialRun(state, 'succeeded');
    state = advanceSequentialRun(state, 'succeeded');
    // Simulates cancelling here — the caller just stops calling advance.
    expect(isSequentialRunComplete(state)).toBe(false);
    expect(state.queue).toEqual(['c', 'd', 'e']);
    expect(state.succeeded).toBe(2);
    expect(state.total).toBe(5);
  });

  it('einzelner Fehlschlag unterbricht nicht: the queue keeps moving past a failure', () => {
    let state = startSequentialRun(['a', 'b', 'c']);
    state = advanceSequentialRun(state, 'succeeded');
    state = advanceSequentialRun(state, 'failed');
    expect(isSequentialRunComplete(state)).toBe(false);
    expect(nextSequentialRunId(state)).toBe('c');

    state = advanceSequentialRun(state, 'succeeded');
    expect(isSequentialRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 3, succeeded: 2, failed: 1 });
  });
});

describe('photo backup run wrappers (thin aliases over the shared engine)', () => {
  it('map "saved"/"failed" onto the generic succeeded/failed outcome', () => {
    let state = startPhotoBackupRun(['a', 'b']);
    state = advancePhotoBackupRun(state, 'saved');
    state = advancePhotoBackupRun(state, 'failed');
    expect(isPhotoBackupRunComplete(state)).toBe(true);
    expect(state).toEqual({ queue: [], total: 2, succeeded: 1, failed: 1 });
  });

  it('nextPhotoBackupId always names the front of the queue', () => {
    const state = startPhotoBackupRun(['first', 'second']);
    expect(nextPhotoBackupId(state)).toBe('first');
  });
});

describe('estimateBatchBytes', () => {
  const photo = (id: string, bytes: number | null) => ({ id, bytes });

  it('averages the known sizes', () => {
    expect(estimateBatchBytes([photo('a', 4_000_000), photo('b', 8_000_000)])).toEqual({
      ids: ['a', 'b'],
      averageBytes: 6_000_000,
    });
  });

  it('returns a zero average rather than NaN when nothing has a known size', () => {
    expect(estimateBatchBytes([photo('a', null)])).toEqual({ ids: ['a'], averageBytes: 0 });
  });
});

describe('selectPhotoBackupCandidates', () => {
  it('mirrors selectMediumBackfillCandidates — same computation, backup-specific field name', () => {
    expect(selectPhotoBackupCandidates([{ id: 'a', bytes: 2_000_000 }])).toEqual({
      ids: ['a'],
      averageOriginalBytes: 2_000_000,
    });
  });
});

describe('formatPhotoBackupConfirmation', () => {
  it('names the count, the estimate and the device album', () => {
    const message = formatPhotoBackupConfirmation(2, 4_000_000);
    expect(message).toContain('2 Fotos sind noch nicht gesichert');
    expect(message).toContain('WLAN');
    expect(message).toContain(PHOTO_BACKUP_ALBUM_NAME);
  });

  it('uses the singular for exactly one photo', () => {
    expect(formatPhotoBackupConfirmation(1, 1_000_000)).toContain('1 Foto ist noch nicht gesichert');
  });
});

describe('formatPhotoBackupStatusLabel', () => {
  const tz = 'Europe/Berlin';

  it('says never backed up when there is no timestamp and nothing pending', () => {
    expect(formatPhotoBackupStatusLabel(null, 0, tz)).toBe('Noch nie gesichert.');
  });

  it('says never backed up but names the pending count when photos exist', () => {
    expect(formatPhotoBackupStatusLabel(null, 3, tz)).toBe('Noch nie gesichert — 3 Fotos noch offen.');
  });

  it('names the last backup date and that everything is current', () => {
    expect(formatPhotoBackupStatusLabel('2026-08-10T12:00:00.000Z', 0, tz)).toContain('alle gesichert');
  });

  it('names the last backup date and the exact pending count', () => {
    const label = formatPhotoBackupStatusLabel('2026-08-10T12:00:00.000Z', 5, tz);
    expect(label).toContain('Zuletzt gesichert');
    expect(label).toContain('5 Fotos noch offen');
  });

  it('uses the singular for exactly one pending photo', () => {
    expect(formatPhotoBackupStatusLabel('2026-08-10T12:00:00.000Z', 1, tz)).toContain('1 Foto noch offen');
  });
});
