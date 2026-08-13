import { describe, expect, it } from 'vitest';

import {
  buildOriginalKey,
  buildThumbKey,
  composeContentHash,
  dedupeByHash,
  extensionForMime,
  formatAgeLabel,
  groupPhotosByDay,
  isOccurredAtEstimated,
  resolveFullscreenUri,
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
  it('prefers the local staged file over a signed URL', () => {
    const photo = { local_uri: 'file:///staged.jpg', original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([['hh1/p1/orig.jpg', 'https://signed/orig.jpg']]);

    expect(resolveFullscreenUri(photo, signedUrls)).toBe('file:///staged.jpg');
  });

  it('falls back to the signed URL of the original once the local file is gone', () => {
    const photo = { local_uri: null, original_key: 'hh1/p1/orig.jpg' };
    const signedUrls = new Map([['hh1/p1/orig.jpg', 'https://signed/orig.jpg']]);

    expect(resolveFullscreenUri(photo, signedUrls)).toBe('https://signed/orig.jpg');
  });

  it('returns undefined when the signed URL has not resolved yet', () => {
    const photo = { local_uri: null, original_key: 'hh1/p1/orig.jpg' };

    expect(resolveFullscreenUri(photo, new Map())).toBeUndefined();
  });

  it('returns undefined when there is neither a local file nor an original key', () => {
    expect(resolveFullscreenUri({ local_uri: null, original_key: null }, new Map())).toBeUndefined();
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
