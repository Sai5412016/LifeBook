import { describe, expect, it } from 'vitest';

import {
  describeDoseUnit,
  describeMedicationRoute,
  favoritenAusVerlauf,
  firstNameOf,
  formatDoseLabel,
  formatDuplicateDoseWarning,
  formatGivenTodayLabel,
  letzteGabeHeute,
  resolveGabeOccurredAt,
} from './logic';
import type { MedicationFavorite, MedicationHistoryEntry, MedicationTodayEntry } from './logic';

describe('describeDoseUnit', () => {
  it('gives the German label for every unit', () => {
    expect(describeDoseUnit('ie')).toBe('IE');
    expect(describeDoseUnit('drops')).toBe('Tropfen');
    expect(describeDoseUnit('ml')).toBe('ml');
    expect(describeDoseUnit('mg')).toBe('mg');
    expect(describeDoseUnit('spoon')).toBe('Messlöffel');
    expect(describeDoseUnit('piece')).toBe('Stück');
  });
});

describe('describeMedicationRoute', () => {
  it('gives the German label for every route', () => {
    expect(describeMedicationRoute('oral')).toBe('oral');
    expect(describeMedicationRoute('bottle')).toBe('in die Flasche');
    expect(describeMedicationRoute('other')).toBe('sonstige');
  });
});

describe('formatDoseLabel', () => {
  it('combines amount and unit', () => {
    expect(formatDoseLabel(500, 'ie')).toBe('500 IE');
  });

  it('keeps a decimal amount as-is', () => {
    expect(formatDoseLabel(2.5, 'ml')).toBe('2.5 ml');
  });

  it('is empty when neither is set', () => {
    expect(formatDoseLabel(null, null)).toBe('');
  });

  it('shows just the amount when the unit is missing', () => {
    expect(formatDoseLabel(3, null)).toBe('3');
  });
});

describe('firstNameOf', () => {
  it('takes the first word of a multi-word display name', () => {
    expect(firstNameOf('Tamara Müller')).toBe('Tamara');
  });

  it('leaves a single-word display name unchanged', () => {
    expect(firstNameOf('Papa')).toBe('Papa');
  });

  it('trims surrounding whitespace', () => {
    expect(firstNameOf('  Tamara  ')).toBe('Tamara');
  });
});

describe('formatGivenTodayLabel', () => {
  it('formats "Heute HH:MM · Vorname" when the selected day is today', () => {
    expect(formatGivenTodayLabel('2026-09-23T07:12:00.000Z', 'Europe/Berlin', 'Tamara', true, '23. September')).toBe(
      'Heute 09:12 · Tamara',
    );
  });

  it('formats "<Datum> HH:MM · Vorname" for a past selected day', () => {
    expect(
      formatGivenTodayLabel('2026-09-21T07:12:00.000Z', 'Europe/Berlin', 'Tamara', false, '21. September'),
    ).toBe('21. September 09:12 · Tamara');
  });
});

describe('formatDuplicateDoseWarning', () => {
  it('formats the doppelgabe confirmation text exactly for the selected day being today', () => {
    expect(formatDuplicateDoseWarning('2026-09-23T07:12:00.000Z', 'Europe/Berlin', true, '23. September')).toBe(
      'Heute um 09:12 bereits gegeben. Wirklich noch einmal?',
    );
  });

  it('formats the doppelgabe confirmation text exactly for a past selected day (Korrektur 2026-09-25)', () => {
    expect(formatDuplicateDoseWarning('2026-09-21T07:12:00.000Z', 'Europe/Berlin', false, '21. September')).toBe(
      'Am 21. September um 09:12 bereits gegeben. Wirklich noch einmal?',
    );
  });
});

describe('favoritenAusVerlauf', () => {
  const NOW = '2026-09-23T12:00:00.000Z';

  const entry = (overrides: Partial<MedicationHistoryEntry> = {}): MedicationHistoryEntry => ({
    name: 'Vigantol',
    dose_amount: 500,
    dose_unit: 'ie',
    route: 'oral',
    occurred_at: NOW,
    deleted_at: null,
    ...overrides,
  });

  it('returns nothing for an empty history', () => {
    expect(favoritenAusVerlauf([], NOW)).toEqual([]);
  });

  it('sorts by how often a group was given in the last 30 days, most first', () => {
    const eintraege = [
      entry({ occurred_at: '2026-09-20T08:00:00.000Z' }),
      entry({ occurred_at: '2026-09-21T08:00:00.000Z' }),
      entry({ occurred_at: '2026-09-22T08:00:00.000Z' }),
      entry({ name: 'Eisen', dose_amount: 10, dose_unit: 'drops', occurred_at: '2026-09-22T08:00:00.000Z' }),
    ];

    const favorites = favoritenAusVerlauf(eintraege, NOW);

    expect(favorites[0].name).toBe('Vigantol');
    expect(favorites[1].name).toBe('Eisen');
  });

  it('breaks a count tie in favor of whichever group was used more recently', () => {
    const eintraege = [
      entry({ occurred_at: '2026-09-10T08:00:00.000Z' }),
      entry({ name: 'Eisen', dose_amount: 10, dose_unit: 'drops', occurred_at: '2026-09-20T08:00:00.000Z' }),
    ];

    const favorites = favoritenAusVerlauf(eintraege, NOW);

    expect(favorites[0].name).toBe('Eisen');
    expect(favorites[1].name).toBe('Vigantol');
  });

  it('ignores deleted entries entirely, both for the count and for group membership', () => {
    const eintraege = [
      entry({ occurred_at: '2026-09-20T08:00:00.000Z', deleted_at: '2026-09-20T09:00:00.000Z' }),
      entry({ name: 'Eisen', dose_amount: 10, dose_unit: 'drops', occurred_at: '2026-09-21T08:00:00.000Z' }),
    ];

    expect(favoritenAusVerlauf(eintraege, NOW)).toEqual([
      { name: 'Eisen', doseAmount: 10, doseUnit: 'drops', route: 'oral' },
    ]);
  });

  it('groups names case-insensitively but displays the most recently used casing', () => {
    const eintraege = [
      entry({ name: 'vigantol', occurred_at: '2026-09-10T08:00:00.000Z' }),
      entry({ name: 'Vigantol', occurred_at: '2026-09-22T08:00:00.000Z' }),
    ];

    expect(favoritenAusVerlauf(eintraege, NOW)).toEqual([
      { name: 'Vigantol', doseAmount: 500, doseUnit: 'ie', route: 'oral' },
    ]);
  });

  it('never returns more than 6 suggestions', () => {
    const eintraege = Array.from({ length: 8 }, (_, index) =>
      entry({ name: `Mittel ${index}`, dose_amount: index, occurred_at: NOW }),
    );

    expect(favoritenAusVerlauf(eintraege, NOW)).toHaveLength(6);
  });

  it('carries the Gabeart (route) of the MOST RECENT entry in the group, not the oldest', () => {
    const eintraege = [
      entry({ occurred_at: '2026-09-10T08:00:00.000Z', route: 'oral' }),
      entry({ occurred_at: '2026-09-20T08:00:00.000Z', route: 'bottle' }),
    ];

    const favorites = favoritenAusVerlauf(eintraege, NOW);

    expect(favorites[0].route).toBe('bottle');
  });

  it('a route-only difference still counts as the SAME group (route is not part of the grouping key)', () => {
    const eintraege = [
      entry({ occurred_at: '2026-09-10T08:00:00.000Z', route: 'oral' }),
      entry({ occurred_at: '2026-09-20T08:00:00.000Z', route: 'bottle' }),
    ];

    expect(favoritenAusVerlauf(eintraege, NOW)).toHaveLength(1);
  });
});

describe('letzteGabeHeute', () => {
  const TODAY = '2026-09-23';
  const YESTERDAY = '2026-09-22';
  const favorite: MedicationFavorite = { name: 'Vigantol', doseAmount: 500, doseUnit: 'ie', route: 'oral' };

  const todayEntry = (overrides: Partial<MedicationTodayEntry> = {}): MedicationTodayEntry => ({
    name: 'Vigantol',
    dose_amount: 500,
    dose_unit: 'ie',
    occurred_at: '2026-09-23T08:00:00.000Z',
    local_date: TODAY,
    deleted_at: null,
    ...overrides,
  });

  it('finds a dose given today', () => {
    const givenToday = todayEntry();
    expect(letzteGabeHeute([givenToday], favorite, TODAY)).toBe(givenToday);
  });

  it('midnight edge case: 23:58 YESTERDAY does not count as given today, even though the clock gap is under two minutes', () => {
    const lateYesterday = todayEntry({
      occurred_at: '2026-09-22T21:58:00.000Z', // 23:58 Berlin summer time
      local_date: YESTERDAY,
    });
    expect(letzteGabeHeute([lateYesterday], favorite, TODAY)).toBeNull();
  });

  it('midnight edge case: 00:02 TODAY counts as given today, even hours before a later check', () => {
    const earlyToday = todayEntry({
      occurred_at: '2026-09-22T22:02:00.000Z', // 00:02 Berlin summer time, already "today"
      local_date: TODAY,
    });
    expect(letzteGabeHeute([earlyToday], favorite, TODAY)).toBe(earlyToday);
  });

  it('ignores a deleted entry', () => {
    const deleted = todayEntry({ deleted_at: '2026-09-23T09:00:00.000Z' });
    expect(letzteGabeHeute([deleted], favorite, TODAY)).toBeNull();
  });

  it('ignores an entry for a different name/dose combination', () => {
    const other = todayEntry({ name: 'Eisen' });
    expect(letzteGabeHeute([other], favorite, TODAY)).toBeNull();
  });

  it('returns the LATEST match when given multiple times today', () => {
    const first = todayEntry({ occurred_at: '2026-09-23T06:00:00.000Z' });
    const second = todayEntry({ occurred_at: '2026-09-23T10:00:00.000Z' });
    expect(letzteGabeHeute([first, second], favorite, TODAY)).toBe(second);
  });

  it('returns null for no history', () => {
    expect(letzteGabeHeute([], favorite, TODAY)).toBeNull();
  });
});

describe('resolveGabeOccurredAt', () => {
  it('resolves date + time + tz into occurred_at/local_date, matching combineLocalDateAndTime', () => {
    expect(resolveGabeOccurredAt('2026-01-15', '10:00', 'Europe/Berlin')).toEqual({
      occurredAtUtcIso: '2026-01-15T09:00:00.000Z',
      localDate: '2026-01-15',
    });
  });

  it('Nachtragen: sets local_date to the CHOSEN (past) day, never to nowUtcIso()', () => {
    const result = resolveGabeOccurredAt('2026-09-22', '21:30', 'Europe/Berlin');
    expect(result?.localDate).toBe('2026-09-22');
    expect(result?.occurredAtUtcIso).toBe('2026-09-22T19:30:00.000Z');
  });

  it('returns null for a malformed date/time', () => {
    expect(resolveGabeOccurredAt('not-a-date', '21:30', 'Europe/Berlin')).toBeNull();
  });
});
