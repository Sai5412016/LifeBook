import { describe, expect, it } from 'vitest';

import { toLocalDate } from '@/core/time';

import { dailyTotals, dayTotal, rollingAverage, type PumpingAmountSession } from './analytics';

const session = (local_date: string, amount_ml: number | null): PumpingAmountSession => ({
  local_date,
  amount_ml,
});

describe('dayTotal', () => {
  it('sums every session of that day', () => {
    const sessions = [session('2026-08-25', 120), session('2026-08-25', 80), session('2026-08-24', 200)];
    expect(dayTotal(sessions, '2026-08-25')).toBe(200);
  });

  it('is 0 for a day with no session at all', () => {
    expect(dayTotal([session('2026-08-25', 120)], '2026-08-24')).toBe(0);
  });

  it('is 0 for an empty list', () => {
    expect(dayTotal([], '2026-08-25')).toBe(0);
  });

  it('treats a session without an amount as 0 ml, not as absent', () => {
    expect(dayTotal([session('2026-08-25', null), session('2026-08-25', 50)], '2026-08-25')).toBe(50);
  });

  it('groups ONLY by the stored local_date — never by re-deriving it', () => {
    // Die 03:00-Sitzung: occurred_at liegt in UTC noch am Vortag
    // (2026-08-24T01:00Z = 03:00 Uhr Berlin am 24.), local_date wurde beim
    // Einfügen auf den laufenden Kalendertag gesetzt. Wer den Tag hier neu
    // aus occurred_at ableitete, zählte sie dem falschen Tag zu.
    const nightSession = { local_date: '2026-08-24', amount_ml: 90 };
    expect(dayTotal([nightSession], '2026-08-24')).toBe(90);
    expect(dayTotal([nightSession], '2026-08-23')).toBe(0);
  });
});

describe('dailyTotals', () => {
  it('returns a gapless range, oldest first, missing days as 0', () => {
    const sessions = [session('2026-08-25', 100), session('2026-08-23', 60)];
    expect(dailyTotals(sessions, '2026-08-23', '2026-08-26')).toEqual([
      { localDate: '2026-08-23', totalMl: 60 },
      { localDate: '2026-08-24', totalMl: 0 },
      { localDate: '2026-08-25', totalMl: 100 },
      { localDate: '2026-08-26', totalMl: 0 },
    ]);
  });

  it('sums several sessions of the same day into one entry', () => {
    const sessions = [session('2026-08-25', 120), session('2026-08-25', 80), session('2026-08-25', 40)];
    expect(dailyTotals(sessions, '2026-08-25', '2026-08-25')).toEqual([
      { localDate: '2026-08-25', totalMl: 240 },
    ]);
  });

  it('returns every day as 0 when there are no sessions at all', () => {
    expect(dailyTotals([], '2026-08-24', '2026-08-26')).toEqual([
      { localDate: '2026-08-24', totalMl: 0 },
      { localDate: '2026-08-25', totalMl: 0 },
      { localDate: '2026-08-26', totalMl: 0 },
    ]);
  });

  it('crosses a month boundary correctly', () => {
    expect(dailyTotals([session('2026-09-01', 50)], '2026-08-30', '2026-09-01')).toEqual([
      { localDate: '2026-08-30', totalMl: 0 },
      { localDate: '2026-08-31', totalMl: 0 },
      { localDate: '2026-09-01', totalMl: 50 },
    ]);
  });

  it('crosses the DST change without losing or duplicating a day', () => {
    // Europe/Berlin stellt am 25.10.2026 zurück — reine Kalenderarithmetik
    // darf das nicht bemerken.
    const range = dailyTotals([], '2026-10-24', '2026-10-26');
    expect(range.map((day) => day.localDate)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('ignores sessions outside the range', () => {
    const sessions = [session('2026-08-01', 999), session('2026-08-25', 100)];
    expect(dailyTotals(sessions, '2026-08-25', '2026-08-25')).toEqual([
      { localDate: '2026-08-25', totalMl: 100 },
    ]);
  });

  it('returns nothing for an inverted range instead of counting backwards', () => {
    expect(dailyTotals([session('2026-08-25', 100)], '2026-08-26', '2026-08-25')).toEqual([]);
  });
});

describe('rollingAverage', () => {
  it('counts days without any session as 0 AND keeps them in the denominator', () => {
    // 700 ml an genau einem von sieben Tagen -> 100, nicht 700.
    expect(rollingAverage([session('2026-08-25', 700)], '2026-08-25', 7)).toBe(100);
  });

  it('averages several days over the full window', () => {
    const sessions = [
      session('2026-08-25', 300),
      session('2026-08-24', 200),
      session('2026-08-23', 200),
    ];
    expect(rollingAverage(sessions, '2026-08-25', 7)).toBeCloseTo(700 / 7, 10);
  });

  it('is 0 when nothing was pumped in the window', () => {
    expect(rollingAverage([], '2026-08-25', 7)).toBe(0);
  });

  it('excludes sessions older than the window, even though they exist', () => {
    const sessions = [session('2026-08-25', 100), session('2026-08-01', 5000)];
    expect(rollingAverage(sessions, '2026-08-25', 7)).toBeCloseTo(100 / 7, 10);
  });

  it('excludes sessions AFTER the window end (a corrected future entry)', () => {
    const sessions = [session('2026-08-25', 100), session('2026-08-26', 900)];
    expect(rollingAverage(sessions, '2026-08-25', 7)).toBeCloseTo(100 / 7, 10);
  });

  it('window ends ON endLocalDate and is inclusive on both edges', () => {
    // 7-Tage-Fenster endend am 25. reicht vom 19. bis zum 25.
    const sessions = [session('2026-08-19', 70), session('2026-08-18', 999)];
    expect(rollingAverage(sessions, '2026-08-25', 7)).toBeCloseTo(10, 10);
  });

  it('a one-day window is just that day', () => {
    expect(rollingAverage([session('2026-08-25', 240)], '2026-08-25', 1)).toBe(240);
  });

  it('returns 0 for a non-positive window instead of dividing by zero', () => {
    expect(rollingAverage([session('2026-08-25', 240)], '2026-08-25', 0)).toBe(0);
    expect(rollingAverage([session('2026-08-25', 240)], '2026-08-25', -7)).toBe(0);
  });
});

describe('Tagesgrenze: eine Sitzung um 03:00 Uhr', () => {
  it('landet auf dem laufenden Kalendertag, weil local_date beim Einfügen so gesetzt wird', () => {
    // Genau das, was addPumpingSession beim Einfügen rechnet:
    // 03:00 Uhr Berlin am 25.08. ist 01:00 UTC am 25.08.
    const occurredAt = '2026-08-25T01:00:00.000Z';
    const localDate = toLocalDate(occurredAt, 'Europe/Berlin');
    expect(localDate).toBe('2026-08-25');

    const stored = { local_date: localDate, amount_ml: 90 };
    expect(dayTotal([stored], '2026-08-25')).toBe(90);
    // …und zählt genau einmal, im richtigen Tag der 14-Tage-Liste.
    expect(dailyTotals([stored], '2026-08-24', '2026-08-25')).toEqual([
      { localDate: '2026-08-24', totalMl: 0 },
      { localDate: '2026-08-25', totalMl: 90 },
    ]);
  });

  it('bleibt auf ihrem Tag, auch wenn das Gerät später in einer anderen Zeitzone steht', () => {
    // Dieselbe Sitzung, später in Los Angeles betrachtet: aus occurred_at
    // neu abgeleitet wäre es der 24., gespeichert ist der 25. — und der
    // gespeicherte Wert ist der, nach dem gruppiert wird.
    const occurredAt = '2026-08-25T01:00:00.000Z';
    expect(toLocalDate(occurredAt, 'America/Los_Angeles')).toBe('2026-08-24');

    const stored = { local_date: toLocalDate(occurredAt, 'Europe/Berlin'), amount_ml: 90 };
    expect(dayTotal([stored], '2026-08-25')).toBe(90);
    expect(dayTotal([stored], '2026-08-24')).toBe(0);
  });
});
