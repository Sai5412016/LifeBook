import { describe, expect, it } from 'vitest';

import {
  buildMediumKey,
  buildOriginalKey,
  buildThumbKey,
  composeContentHash,
  dedupeByHash,
  extensionForMime,
  formatAgeLabel,
  groupPhotosByDay,
  isOccurredAtEstimated,
  resolveFullscreenUri,
  shouldResignUrl,
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
