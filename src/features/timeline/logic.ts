/**
 * timeline/logic — pure merge of every tracking table's rows for ONE
 * already-selected day into a single, chronologically sorted list (task
 * 2026-09-26: the Alltag tab's Tagesverlauf). Every row-to-label mapping
 * reuses the OWNING feature's own pure formatting (feeding/timer.ts,
 * diaper/summary.ts, medication/logic.ts, household/measurements.ts) —
 * this module only merges and sorts, it invents no new label wording of
 * its own. Deliberately free of any Expo / React Native / PowerSync import
 * so it runs in plain Node under Vitest; the device-touching side (one
 * query per table, already day-scoped) lives in ./repository.
 */

import { formatDuration, secondsBetween } from '@/core/time';
import { describeDiaperKind } from '@/features/diaper/summary';
import type { DiaperKind } from '@/features/diaper/types';
import { describeFeedAmount, describeFeedType } from '@/features/feeding/timer';
import type { FeedType } from '@/features/feeding/types';
import {
  formatHeadCircumferenceCm,
  formatLengthCm,
  formatWeightKg,
} from '@/features/household/measurements';
import { formatDoseLabel } from '@/features/medication/logic';
import type { MedicationDoseUnit } from '@/features/medication/types';

import type { TimelineEntry } from './types';

export type TimelineFeedRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  needs_review: number;
  feed_type: FeedType;
  amount_ml: number | null;
  duration_left_s: number | null;
  duration_right_s: number | null;
};

export type TimelineDiaperRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  kind: DiaperKind;
};

export type TimelineMedicationRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  name: string;
  dose_amount: number | null;
  dose_unit: MedicationDoseUnit | null;
};

export type TimelineSleepRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  ended_at: string | null;
  needs_review: number;
};

export type TimelinePumpingRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  needs_review: number;
  amount_ml: number | null;
  side: 'left' | 'right' | 'both' | null;
};

export type TimelineGrowthRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  weight_g: number | null;
  length_mm: number | null;
  head_circumference_mm: number | null;
};

export type TimelineTemperatureRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  value_c: number | null;
};

export type TimelineNoteRow = {
  id: string;
  occurred_at: string;
  deleted_at: string | null;
  title: string | null;
};

export type TimelineDayInput = {
  feeds?: readonly TimelineFeedRow[];
  diapers?: readonly TimelineDiaperRow[];
  medications?: readonly TimelineMedicationRow[];
  sleeps?: readonly TimelineSleepRow[];
  pumpingSessions?: readonly TimelinePumpingRow[];
  growthMeasurements?: readonly TimelineGrowthRow[];
  temperatures?: readonly TimelineTemperatureRow[];
  notes?: readonly TimelineNoteRow[];
};

const SIDE_LABELS: Record<'left' | 'right' | 'both', string> = { left: 'links', right: 'rechts', both: 'beide' };

/** "51,0 cm" + "34,5 cm" joined — a growth row can carry any subset of its three fields at once. */
function describeGrowthValues(row: TimelineGrowthRow): string {
  return [formatWeightKg(row.weight_g), formatLengthCm(row.length_mm), formatHeadCircumferenceCm(row.head_circumference_mm)]
    .filter((value): value is string => value !== null)
    .join(' · ');
}

/**
 * Merges every source's (already day-scoped, still possibly soft-deleted)
 * rows into one ascending-by-`occurred_at` list. `jetzt` is only used for a
 * still-RUNNING sleep started earlier the same day (its duration is live,
 * same convention as sleep/timer.ts — never computed from `new Date()` in
 * here). Every input is optional and defaults to empty, so a caller that
 * doesn't have (or doesn't want) a particular source can simply omit it.
 */
export function buildDayTimeline(input: TimelineDayInput, jetzt: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const row of input.feeds ?? []) {
    if (row.deleted_at) continue;
    entries.push({
      id: row.id,
      kind: 'feed',
      occurredAtUtcIso: row.occurred_at,
      label: describeFeedType(row.feed_type),
      valueLabel: describeFeedAmount(row),
      needsReview: row.needs_review === 1,
    });
  }

  for (const row of input.diapers ?? []) {
    if (row.deleted_at) continue;
    // describeDiaperKind gives just "Nass"/"Stuhl"/"Beides" (the diaper
    // section's own button labels) — the Tagesverlauf row needs the fuller
    // "Windel Nass"/"Windel Stuhl", matching the Schnelleingabe buttons of
    // the same name (task 2026-09-26's own example rows).
    entries.push({
      id: row.id,
      kind: 'diaper',
      occurredAtUtcIso: row.occurred_at,
      label: `Windel ${describeDiaperKind(row.kind)}`,
      valueLabel: '',
      needsReview: false,
    });
  }

  for (const row of input.medications ?? []) {
    if (row.deleted_at) continue;
    entries.push({
      id: row.id,
      kind: 'medication',
      occurredAtUtcIso: row.occurred_at,
      label: row.name,
      valueLabel: formatDoseLabel(row.dose_amount, row.dose_unit),
      needsReview: false,
    });
  }

  for (const row of input.sleeps ?? []) {
    if (row.deleted_at) continue;
    const durationSeconds = secondsBetween(row.occurred_at, row.ended_at ?? jetzt);
    entries.push({
      id: row.id,
      kind: 'sleep',
      occurredAtUtcIso: row.occurred_at,
      label: 'Schlaf',
      valueLabel: row.ended_at ? formatDuration(durationSeconds) : 'läuft',
      needsReview: row.needs_review === 1,
    });
  }

  for (const row of input.pumpingSessions ?? []) {
    if (row.deleted_at) continue;
    const sideLabel = row.side ? ` (${SIDE_LABELS[row.side]})` : '';
    entries.push({
      id: row.id,
      kind: 'pumping',
      occurredAtUtcIso: row.occurred_at,
      label: `Abpumpen${sideLabel}`,
      valueLabel: row.amount_ml !== null ? `${row.amount_ml} ml` : '',
      needsReview: row.needs_review === 1,
    });
  }

  for (const row of input.growthMeasurements ?? []) {
    if (row.deleted_at) continue;
    entries.push({
      id: row.id,
      kind: 'growth',
      occurredAtUtcIso: row.occurred_at,
      label: 'Messung',
      valueLabel: describeGrowthValues(row),
      needsReview: false,
    });
  }

  for (const row of input.temperatures ?? []) {
    if (row.deleted_at) continue;
    entries.push({
      id: row.id,
      kind: 'temperature',
      occurredAtUtcIso: row.occurred_at,
      label: 'Temperatur',
      valueLabel: row.value_c !== null ? `${row.value_c.toString().replace('.', ',')} °C` : '',
      needsReview: false,
    });
  }

  for (const row of input.notes ?? []) {
    if (row.deleted_at) continue;
    entries.push({
      id: row.id,
      kind: 'note',
      occurredAtUtcIso: row.occurred_at,
      label: row.title && row.title.trim().length > 0 ? row.title : 'Notiz',
      valueLabel: '',
      needsReview: false,
    });
  }

  return entries.sort((a, b) => (a.occurredAtUtcIso < b.occurredAtUtcIso ? -1 : a.occurredAtUtcIso > b.occurredAtUtcIso ? 1 : 0));
}

/** "Für diesen Tag ist nichts eingetragen." / "… vor der Geburt." — the Tagesverlauf's empty state. */
export function formatEmptyDayLabel(isBeforeBirth: boolean): string {
  return isBeforeBirth ? 'Für diesen Tag ist nichts eingetragen — vor der Geburt.' : 'Für diesen Tag ist nichts eingetragen.';
}
