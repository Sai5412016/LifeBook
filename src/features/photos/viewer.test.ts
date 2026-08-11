import { describe, expect, it } from 'vitest';

import {
  clampIndex,
  formatPositionLabel,
  indexAfterDeletion,
  indexOfPhoto,
  windowIndices,
} from './viewer';

describe('clampIndex', () => {
  it('passes an in-range index through unchanged', () => {
    expect(clampIndex(3, 10)).toBe(3);
  });

  it('clamps a negative index to 0', () => {
    expect(clampIndex(-5, 10)).toBe(0);
  });

  it('clamps an index past the end to the last valid index', () => {
    expect(clampIndex(99, 10)).toBe(9);
  });

  it('returns 0 for an empty list rather than a negative or NaN index', () => {
    expect(clampIndex(5, 0)).toBe(0);
  });
});

describe('indexOfPhoto', () => {
  const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('finds the position of an id in the list', () => {
    expect(indexOfPhoto(photos, 'b')).toBe(1);
  });

  it('returns -1 for an id not in the list (deleted, or list not loaded yet)', () => {
    expect(indexOfPhoto(photos, 'nope')).toBe(-1);
  });

  it('returns -1 for an undefined id', () => {
    expect(indexOfPhoto(photos, undefined)).toBe(-1);
  });

  it('returns -1 for an empty list', () => {
    expect(indexOfPhoto([], 'a')).toBe(-1);
  });
});

describe('windowIndices', () => {
  it('centers a window of radius 3 around the current index', () => {
    expect(windowIndices(10, 100, 3)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  it('clips the start at the first photo', () => {
    expect(windowIndices(1, 100, 3)).toEqual([0, 1, 2, 3, 4]);
  });

  it('clips the end at the last photo', () => {
    expect(windowIndices(97, 100, 3)).toEqual([94, 95, 96, 97, 98, 99]);
  });

  it('covers the whole list when it is smaller than the window', () => {
    expect(windowIndices(2, 4, 3)).toEqual([0, 1, 2, 3]);
  });

  it('returns a single index for a one-photo album', () => {
    expect(windowIndices(0, 1, 3)).toEqual([0]);
  });

  it('returns nothing for an empty list', () => {
    expect(windowIndices(0, 0, 3)).toEqual([]);
  });
});

describe('formatPositionLabel', () => {
  it('formats a 1-based position out of the total', () => {
    expect(formatPositionLabel(13, 90)).toBe('14 von 90');
  });

  it('formats the first photo', () => {
    expect(formatPositionLabel(0, 90)).toBe('1 von 90');
  });

  it('formats a single-photo album', () => {
    expect(formatPositionLabel(0, 1)).toBe('1 von 1');
  });
});

describe('indexAfterDeletion', () => {
  it('stays at the same index when the deleted photo was not last — the next one slides in', () => {
    expect(indexAfterDeletion(2, 10)).toBe(2);
  });

  it('stays at index 0 when the first of many is deleted', () => {
    expect(indexAfterDeletion(0, 10)).toBe(0);
  });

  it('steps back to the new last index when the last photo is deleted', () => {
    expect(indexAfterDeletion(9, 10)).toBe(8);
  });

  it('returns -1 when the only photo is deleted — nothing left, go back to Chronik', () => {
    expect(indexAfterDeletion(0, 1)).toBe(-1);
  });

  it('steps back correctly for the last of exactly two photos', () => {
    expect(indexAfterDeletion(1, 2)).toBe(0);
  });
});
