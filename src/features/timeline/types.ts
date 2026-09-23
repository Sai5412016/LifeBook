/**
 * timeline — types (task 2026-09-26: the Alltag tab's merged Tagesverlauf —
 * one chronological list of every kind of entry on the selected day).
 */

export type TimelineKind =
  | 'feed'
  | 'diaper'
  | 'medication'
  | 'sleep'
  | 'pumping'
  | 'growth'
  | 'temperature'
  | 'note';

/** One row of the merged day list — already formatted for display (label/valueLabel), never a raw DB row. */
export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  occurredAtUtcIso: string;
  /** "Flasche" / "Vitamin D3" / "Windel Stuhl" — what happened. */
  label: string;
  /** "75 ml" / "400 IE" / "" (diapers carry no value) — the number, if any. */
  valueLabel: string;
  /** Feeds, sleeps and pumping sessions can carry this; every other source is always false. */
  needsReview: boolean;
};
