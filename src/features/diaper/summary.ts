/**
 * diaper/summary — pure logic for diaper labels and the daily tally.
 * Deliberately free of any Expo / React Native / PowerSync import so it runs
 * in plain Node under Vitest; the device- and database-touching side lives
 * in ./repository.
 */

import type { DiaperColor, DiaperConsistency, DiaperKind } from './types';

/** German label for a diaper kind, e.g. "Nass" — matches the three big buttons. */
export function describeDiaperKind(kind: DiaperKind): string {
  switch (kind) {
    case 'wet':
      return 'Nass';
    case 'dirty':
      return 'Stuhl';
    case 'both':
      return 'Beides';
  }
}

/** German label for a diaper consistency. */
export function describeDiaperConsistency(consistency: DiaperConsistency): string {
  switch (consistency) {
    case 'liquid':
      return 'Flüssig';
    case 'soft':
      return 'Weich';
    case 'formed':
      return 'Fest';
    case 'hard':
      return 'Hart';
  }
}

/** German label for a diaper color. */
export function describeDiaperColor(color: DiaperColor): string {
  switch (color) {
    case 'yellow':
      return 'Gelb';
    case 'green':
      return 'Grün';
    case 'brown':
      return 'Braun';
    case 'black':
      return 'Schwarz';
    case 'red':
      return 'Rot';
    case 'white':
      return 'Weiß';
  }
}

export type DiaperDaySummary = { wet: number; dirty: number };

/**
 * Tally for the day: how many diapers were wet, how many had stool. A
 * `'both'` entry counts toward BOTH totals — it genuinely was a wet AND a
 * dirty change, and a parent reporting to a midwife counts it that way.
 */
export function summarizeDiapersOfDay(diapers: readonly { kind: DiaperKind }[]): DiaperDaySummary {
  let wet = 0;
  let dirty = 0;

  for (const diaper of diapers) {
    if (diaper.kind === 'wet' || diaper.kind === 'both') {
      wet += 1;
    }
    if (diaper.kind === 'dirty' || diaper.kind === 'both') {
      dirty += 1;
    }
  }

  return { wet, dirty };
}

/** "Heute: 6 nass, 3 Stuhl" — the exact line a midwife asks for, no scrolling needed. */
export function formatDiaperSummaryLabel(summary: DiaperDaySummary): string {
  return `Heute: ${summary.wet} nass, ${summary.dirty} Stuhl`;
}
