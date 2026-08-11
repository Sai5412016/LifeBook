import { describe, it, expect } from 'vitest';
import {
  toLocalDate,
  toDashboardDate,
  ageInDays,
  combineLocalDateAndTime,
  exifWallClockToUtcIso,
  formatDayLabel,
  formatTimeLabel,
  secondsBetween,
} from './index';

const BERLIN = 'Europe/Berlin';

describe('formatDayLabel', () => {
  it('renders a German weekday and month', () => {
    expect(formatDayLabel('2026-08-05')).toBe('Mittwoch, 5. August 2026');
  });

  it('does not shift the day at the start of the month', () => {
    expect(formatDayLabel('2026-01-01')).toBe('Donnerstag, 1. Januar 2026');
  });

  it('passes malformed input through untouched instead of inventing a date', () => {
    expect(formatDayLabel('nope')).toBe('nope');
  });
});

describe('exifWallClockToUtcIso (EXIF has no timezone)', () => {
  it('summer: 14:30 wall clock in Berlin is 12:30 UTC (+02:00)', () => {
    expect(exifWallClockToUtcIso('2026:08:05 14:30:00', BERLIN)).toBe(
      '2026-08-05T12:30:00.000Z',
    );
  });

  it('winter: the same wall clock is 13:30 UTC (+01:00)', () => {
    expect(exifWallClockToUtcIso('2026:01:05 14:30:00', BERLIN)).toBe(
      '2026-01-05T13:30:00.000Z',
    );
  });

  it('a late-evening photo keeps its own local day, not the UTC one', () => {
    const utc = exifWallClockToUtcIso('2026:08:05 23:30:00', BERLIN);
    expect(utc).toBe('2026-08-05T21:30:00.000Z');
    // The whole point: grouping must still land on the 5th.
    expect(toLocalDate(utc!, BERLIN)).toBe('2026-08-05');
  });

  it('accepts the ISO-style separator some cameras write', () => {
    expect(exifWallClockToUtcIso('2026:08:05T14:30:00', BERLIN)).toBe(
      '2026-08-05T12:30:00.000Z',
    );
  });

  it.each([
    [null, 'missing tag'],
    [undefined, 'missing tag'],
    ['', 'empty'],
    ['not a date', 'garbage'],
    ['2026-08-05 14:30:00', 'dashes instead of EXIF colons'],
    ['0000:00:00 00:00:00', 'the placeholder some cameras write'],
  ])('returns null for %s (%s)', (raw: string | null | undefined, _why: string) => {
    expect(exifWallClockToUtcIso(raw, BERLIN)).toBeNull();
  });

  it('returns null for an unknown timezone rather than a wrong instant', () => {
    expect(exifWallClockToUtcIso('2026:08:05 14:30:00', 'Mars/Olympus')).toBeNull();
  });
});

describe('toLocalDate (DST-safe local calendar date)', () => {
  it('summer (+02:00): 22:30Z rolls into next local day', () => {
    expect(toLocalDate('2026-08-08T22:30:00Z', BERLIN)).toBe('2026-08-09');
  });
  it('summer: 21:59Z is still the same local day', () => {
    expect(toLocalDate('2026-08-08T21:59:00Z', BERLIN)).toBe('2026-08-08');
  });
  it('winter (+01:00): 23:30Z rolls into next local day', () => {
    expect(toLocalDate('2026-01-15T23:30:00Z', BERLIN)).toBe('2026-01-16');
  });
});

describe('toDashboardDate (06:00 local day boundary)', () => {
  it('02:30 local belongs to the previous day', () => {
    // Berlin summer 02:30 on Aug 9 == 00:30Z
    expect(toDashboardDate('2026-08-09T00:30:00Z', BERLIN)).toBe('2026-08-08');
  });
  it('exactly 06:00 local belongs to the same day', () => {
    // Berlin summer 06:00 on Aug 9 == 04:00Z
    expect(toDashboardDate('2026-08-09T04:00:00Z', BERLIN)).toBe('2026-08-09');
  });
  it('05:59 local still belongs to the previous day', () => {
    // Berlin summer 05:59 on Aug 9 == 03:59Z
    expect(toDashboardDate('2026-08-09T03:59:00Z', BERLIN)).toBe('2026-08-08');
  });
});

describe('formatTimeLabel', () => {
  it('formats the local wall-clock time in summer (+02:00)', () => {
    expect(formatTimeLabel('2026-08-08T12:32:00Z', BERLIN)).toBe('14:32');
  });

  it('formats the local wall-clock time in winter (+01:00)', () => {
    expect(formatTimeLabel('2026-01-08T12:32:00Z', BERLIN)).toBe('13:32');
  });

  it('pads single-digit hours and minutes', () => {
    expect(formatTimeLabel('2026-08-08T04:05:00Z', BERLIN)).toBe('06:05');
  });
});

describe('combineLocalDateAndTime', () => {
  it('combines a date and time in summer (+02:00)', () => {
    expect(combineLocalDateAndTime('2026-08-08', '14:32', BERLIN)).toBe('2026-08-08T12:32:00.000Z');
  });

  it('combines a date and time in winter (+01:00)', () => {
    expect(combineLocalDateAndTime('2026-01-08', '14:32', BERLIN)).toBe('2026-01-08T13:32:00.000Z');
  });

  it('round-trips with formatTimeLabel/toLocalDate', () => {
    const combined = combineLocalDateAndTime('2026-08-08', '06:43', BERLIN)!;
    expect(formatTimeLabel(combined, BERLIN)).toBe('06:43');
    expect(toLocalDate(combined, BERLIN)).toBe('2026-08-08');
  });

  it('a near-midnight time stays on the given calendar day, not the UTC one', () => {
    // 23:50 in Berlin summer is 21:50 UTC — still the 8th on both sides here,
    // but the point is combineLocalDateAndTime must not let the UTC instant's
    // own date leak in anywhere.
    const combined = combineLocalDateAndTime('2026-08-08', '23:50', BERLIN)!;
    expect(toLocalDate(combined, BERLIN)).toBe('2026-08-08');
  });

  it('returns null for a malformed date', () => {
    expect(combineLocalDateAndTime('08.08.2026', '14:32', BERLIN)).toBeNull();
  });

  it('returns null for a malformed time', () => {
    expect(combineLocalDateAndTime('2026-08-08', '2:32 pm', BERLIN)).toBeNull();
  });

  it('returns null for an unknown timezone rather than a wrong instant', () => {
    expect(combineLocalDateAndTime('2026-08-08', '14:32', 'Mars/Olympus')).toBeNull();
  });
});

describe('secondsBetween', () => {
  it('counts whole seconds forward', () => {
    expect(secondsBetween('2026-08-08T12:00:00Z', '2026-08-08T12:05:30Z')).toBe(330);
  });

  it('is negative when `to` is earlier than `from`', () => {
    expect(secondsBetween('2026-08-08T12:05:00Z', '2026-08-08T12:00:00Z')).toBe(-300);
  });

  it('is 0 for identical instants', () => {
    expect(secondsBetween('2026-08-08T12:00:00Z', '2026-08-08T12:00:00Z')).toBe(0);
  });

  it('is unaffected by a DST transition landing between the two instants', () => {
    // Europe/Berlin springs forward on 2026-03-29, but both inputs are UTC —
    // the wall-clock jump must not change the real elapsed duration.
    expect(secondsBetween('2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z')).toBe(7200);
  });
});

describe('ageInDays', () => {
  it('is 0 on the birth day', () => {
    expect(ageInDays('2026-08-08T20:00:00Z', '2026-08-08T09:00:00Z', BERLIN)).toBe(0);
  });
  it('counts whole days', () => {
    expect(ageInDays('2026-08-10T09:00:00Z', '2026-08-08T09:00:00Z', BERLIN)).toBe(2);
  });
  it('stays correct across the spring DST transition (2026-03-29)', () => {
    expect(ageInDays('2026-03-30T12:00:00Z', '2026-03-28T12:00:00Z', BERLIN)).toBe(2);
  });
});
