import { describe, expect, it } from 'vitest';

import {
  describeSleepLocation,
  formatAwakeSince,
  formatSleepSummaryLabel,
  formatSleepingSince,
  sleepDurationSeconds,
  summarizeSleepOfDay,
} from './timer';

describe('sleepDurationSeconds', () => {
  it('returns the stored span for a sleep that has already ended', () => {
    expect(
      sleepDurationSeconds(
        { occurred_at: '2026-08-08T20:00:00Z', ended_at: '2026-08-08T22:30:00Z' },
        '2026-08-09T06:00:00Z',
      ),
    ).toBe(9000);
  });

  it('computes the live elapsed time for a still-running sleep', () => {
    expect(
      sleepDurationSeconds({ occurred_at: '2026-08-08T20:00:00Z', ended_at: null }, '2026-08-08T20:42:00Z'),
    ).toBe(2520);
  });
});

describe('describeSleepLocation', () => {
  it.each([
    ['bed', 'Bett'],
    ['stroller', 'Kinderwagen'],
    ['arms', 'Arm'],
    ['car', 'Auto'],
    ['other', 'Sonstiger Ort'],
  ] as const)('describes %s as "%s"', (location, expected) => {
    expect(describeSleepLocation(location)).toBe(expected);
  });
});

describe('summarizeSleepOfDay', () => {
  it('returns zero for no sleeps', () => {
    expect(summarizeSleepOfDay([], '2026-08-08T12:00:00Z')).toEqual({ totalSeconds: 0, count: 0 });
  });

  it('sums completed segments', () => {
    const sleeps = [
      { occurred_at: '2026-08-08T01:00:00Z', ended_at: '2026-08-08T03:00:00Z' },
      { occurred_at: '2026-08-08T09:00:00Z', ended_at: '2026-08-08T10:30:00Z' },
    ];
    expect(summarizeSleepOfDay(sleeps, '2026-08-08T12:00:00Z')).toEqual({
      totalSeconds: 12600,
      count: 2,
    });
  });

  it('includes a still-running segment using its live elapsed time', () => {
    const sleeps = [
      { occurred_at: '2026-08-08T01:00:00Z', ended_at: '2026-08-08T03:00:00Z' },
      { occurred_at: '2026-08-08T11:00:00Z', ended_at: null },
    ];
    expect(summarizeSleepOfDay(sleeps, '2026-08-08T11:30:00Z')).toEqual({
      totalSeconds: 7200 + 1800,
      count: 2,
    });
  });
});

describe('formatSleepSummaryLabel', () => {
  it('formats the plural case', () => {
    expect(formatSleepSummaryLabel({ totalSeconds: 51600, count: 7 })).toBe(
      'Heute: 14 h 20 min in 7 Abschnitten',
    );
  });

  it('formats the singular case', () => {
    expect(formatSleepSummaryLabel({ totalSeconds: 1080, count: 1 })).toBe('Heute: 18 min in 1 Abschnitt');
  });

  it('formats the empty case', () => {
    expect(formatSleepSummaryLabel({ totalSeconds: 0, count: 0 })).toBe('Heute: 0 min in 0 Abschnitten');
  });
});

describe('formatSleepingSince', () => {
  it('formats elapsed time since a running sleep started', () => {
    expect(formatSleepingSince('2026-08-08T20:00:00Z', '2026-08-08T20:42:00Z')).toBe('Schläft seit 42 min');
  });
});

describe('formatAwakeSince', () => {
  it('formats elapsed time since the last sleep ended', () => {
    expect(formatAwakeSince('2026-08-08T09:00:00Z', '2026-08-08T10:10:00Z')).toBe('Wach seit 1 h 10 min');
  });
});
