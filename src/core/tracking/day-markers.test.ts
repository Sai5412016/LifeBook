import { describe, expect, it } from 'vitest';

import { dayMarkersFor } from './day-markers';

const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23'];

describe('dayMarkersFor', () => {
  it('marks a day as present in exactly the categories it has entries for', () => {
    const result = dayMarkersFor(
      DAYS,
      [{ local_date: '2026-09-21', deleted_at: null }],
      [{ local_date: '2026-09-22', deleted_at: null }],
      [{ local_date: '2026-09-21', deleted_at: null }],
    );

    expect(result.get('2026-09-21')).toEqual({ hasFeed: true, hasMedication: false, hasDiaper: true });
    expect(result.get('2026-09-22')).toEqual({ hasFeed: false, hasMedication: true, hasDiaper: false });
  });

  it('gives a day with no entries at all false in every category, not a missing entry', () => {
    const result = dayMarkersFor(DAYS, [], [], []);

    expect(result.get('2026-09-23')).toEqual({ hasFeed: false, hasMedication: false, hasDiaper: false });
    expect(result.size).toBe(DAYS.length);
  });

  it('ignores soft-deleted rows', () => {
    const result = dayMarkersFor(
      DAYS,
      [{ local_date: '2026-09-21', deleted_at: '2026-09-21T12:00:00.000Z' }],
      [],
      [],
    );

    expect(result.get('2026-09-21')).toEqual({ hasFeed: false, hasMedication: false, hasDiaper: false });
  });

  it('ignores rows outside the requested days', () => {
    const result = dayMarkersFor(
      DAYS,
      [{ local_date: '2026-08-01', deleted_at: null }],
      [],
      [],
    );

    expect(result.get('2026-09-21')).toEqual({ hasFeed: false, hasMedication: false, hasDiaper: false });
    expect(result.has('2026-08-01')).toBe(false);
  });
});
