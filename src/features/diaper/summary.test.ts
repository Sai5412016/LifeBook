import { describe, expect, it } from 'vitest';

import {
  describeDiaperColor,
  describeDiaperConsistency,
  describeDiaperKind,
  formatDiaperSummaryLabel,
  summarizeDiapersOfDay,
} from './summary';

describe('describeDiaperKind', () => {
  it.each([
    ['wet', 'Nass'],
    ['dirty', 'Stuhl'],
    ['both', 'Beides'],
  ] as const)('describes %s as "%s"', (kind, expected) => {
    expect(describeDiaperKind(kind)).toBe(expected);
  });
});

describe('describeDiaperConsistency', () => {
  it.each([
    ['liquid', 'Flüssig'],
    ['soft', 'Weich'],
    ['formed', 'Fest'],
    ['hard', 'Hart'],
  ] as const)('describes %s as "%s"', (consistency, expected) => {
    expect(describeDiaperConsistency(consistency)).toBe(expected);
  });
});

describe('describeDiaperColor', () => {
  it.each([
    ['yellow', 'Gelb'],
    ['green', 'Grün'],
    ['brown', 'Braun'],
    ['black', 'Schwarz'],
    ['red', 'Rot'],
    ['white', 'Weiß'],
  ] as const)('describes %s as "%s"', (color, expected) => {
    expect(describeDiaperColor(color)).toBe(expected);
  });
});

describe('summarizeDiapersOfDay', () => {
  it('returns zero counts for an empty day', () => {
    expect(summarizeDiapersOfDay([])).toEqual({ wet: 0, dirty: 0 });
  });

  it('counts wet and dirty separately', () => {
    const diapers = [{ kind: 'wet' as const }, { kind: 'wet' as const }, { kind: 'dirty' as const }];
    expect(summarizeDiapersOfDay(diapers)).toEqual({ wet: 2, dirty: 1 });
  });

  it('counts a "both" entry toward both totals', () => {
    const diapers = [{ kind: 'both' as const }];
    expect(summarizeDiapersOfDay(diapers)).toEqual({ wet: 1, dirty: 1 });
  });

  it('matches the worked example from the midwife scenario', () => {
    const diapers = [
      ...Array(5).fill({ kind: 'wet' as const }),
      ...Array(2).fill({ kind: 'dirty' as const }),
      { kind: 'both' as const },
    ];
    expect(summarizeDiapersOfDay(diapers)).toEqual({ wet: 6, dirty: 3 });
  });
});

describe('formatDiaperSummaryLabel', () => {
  it('matches the exact wording a midwife asks for', () => {
    expect(formatDiaperSummaryLabel({ wet: 6, dirty: 3 })).toBe('Heute: 6 nass, 3 Stuhl');
  });

  it('handles zero counts without special-casing', () => {
    expect(formatDiaperSummaryLabel({ wet: 0, dirty: 0 })).toBe('Heute: 0 nass, 0 Stuhl');
  });
});
