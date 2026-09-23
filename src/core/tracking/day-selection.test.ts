import { describe, expect, it } from 'vitest';

import {
  canGoToNextDay,
  canStartRunningEntry,
  defaultLogTime,
  formatBackfillHint,
  formatDayNavigationLabel,
  isSelectableDay,
} from './day-selection';

const TODAY = '2026-09-23';
const BIRTH = '2026-08-05';

describe('formatDayNavigationLabel', () => {
  it('shows "Heute · <Datum>" when the selected day is today', () => {
    expect(formatDayNavigationLabel(TODAY, TODAY)).toBe('Heute · Mittwoch, 23. September 2026');
  });

  it('shows "Gestern · <Datum>" for exactly one day before today', () => {
    expect(formatDayNavigationLabel('2026-09-22', TODAY)).toBe('Gestern · Dienstag, 22. September 2026');
  });

  it('shows just the date for anything older than yesterday', () => {
    expect(formatDayNavigationLabel('2026-09-12', TODAY)).toBe('Samstag, 12. September 2026');
  });

  it('shows just the date for a day older still', () => {
    expect(formatDayNavigationLabel(BIRTH, TODAY)).toBe('Mittwoch, 5. August 2026');
  });
});

describe('canGoToNextDay', () => {
  it('is locked once the selected day IS today', () => {
    expect(canGoToNextDay(TODAY, TODAY)).toBe(false);
  });

  it('is open for any day before today', () => {
    expect(canGoToNextDay('2026-09-22', TODAY)).toBe(true);
    expect(canGoToNextDay(BIRTH, TODAY)).toBe(true);
  });
});

describe('isSelectableDay', () => {
  it('rejects a day before the earliest selectable date (Marinas Geburt)', () => {
    expect(isSelectableDay('2026-08-04', BIRTH, TODAY)).toBe(false);
  });

  it('accepts the earliest selectable date itself', () => {
    expect(isSelectableDay(BIRTH, BIRTH, TODAY)).toBe(true);
  });

  it('accepts today itself', () => {
    expect(isSelectableDay(TODAY, BIRTH, TODAY)).toBe(true);
  });

  it('rejects any day after today — no future', () => {
    expect(isSelectableDay('2026-09-24', BIRTH, TODAY)).toBe(false);
  });

  it('accepts a day comfortably inside the range', () => {
    expect(isSelectableDay('2026-09-01', BIRTH, TODAY)).toBe(true);
  });
});

describe('defaultLogTime', () => {
  it('uses the current time when the selected day is today', () => {
    expect(defaultLogTime(TODAY, TODAY, '14:32')).toBe('14:32');
  });

  it('uses 12:00 mittags for a past day, ignoring the current time', () => {
    expect(defaultLogTime('2026-09-20', TODAY, '14:32')).toBe('12:00');
  });
});

describe('canStartRunningEntry', () => {
  it('allows starting a running entry (Stillen, Abpumpen) on today', () => {
    expect(canStartRunningEntry(TODAY, TODAY)).toBe(true);
  });

  it('forbids starting a running entry on a past day', () => {
    expect(canStartRunningEntry('2026-09-20', TODAY)).toBe(false);
  });
});

describe('formatBackfillHint', () => {
  it('formats the exact Nachtragen wording', () => {
    expect(formatBackfillHint('2026-09-21')).toBe('Du trägst für den 21. September nach.');
  });
});
