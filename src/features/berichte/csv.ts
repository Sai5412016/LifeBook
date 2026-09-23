/**
 * berichte/csv — pure CSV construction for the Export-Knopf: one file per
 * Datenart (feeds, diapers, sleeps, medications, growth_measurements),
 * German headers, semicolon-separated, local wall-clock timestamps.
 * Deliberately free of any Expo / React Native / PowerSync import so it
 * runs in plain Node under Vitest; the device-touching side (writing the
 * files, opening the share sheet) lives in ./export.
 */

import { formatTimeLabel, toLocalDate } from '@/core/time';
import { describeDiaperColor, describeDiaperConsistency, describeDiaperKind } from '@/features/diaper/summary';
import type { DiaperRow } from '@/features/diaper/types';
import { describeFeedType } from '@/features/feeding/timer';
import type { FeedRow } from '@/features/feeding/types';
import { describeDoseUnit, describeMedicationRoute } from '@/features/medication/logic';
import type { MedicationRow } from '@/features/medication/types';
import { describeSleepLocation } from '@/features/sleep/timer';
import type { SleepRow } from '@/features/sleep/types';
import type { GrowthMeasurementRow } from '@/features/growth/types';

const CSV_SEPARATOR = ';';

/** Wraps a field in quotes (doubling inner quotes) only when the separator, a quote, or a line break forces it — otherwise left plain. */
function escapeCsvField(value: string): string {
  if (value.includes(CSV_SEPARATOR) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Joins headers + rows into one semicolon-separated CSV body (no BOM — that is ./export's job, once, right before writing to disk). */
export function buildCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(CSV_SEPARATOR))
    .join('\r\n');
}

/** "23.09.2026" — local calendar date for a CSV column, task requirement: lokale Zeit, nicht UTC. */
function formatCsvDate(occurredAtUtcIso: string, tz: string): string {
  const [year, month, day] = toLocalDate(occurredAtUtcIso, tz).split('-');
  return `${day}.${month}.${year}`;
}

function minutesOrEmpty(seconds: number | null): string {
  return seconds !== null ? String(Math.round(seconds / 60)) : '';
}

export function buildFeedsCsv(rows: readonly FeedRow[], tz: string): string {
  const headers = [
    'Datum',
    'Uhrzeit',
    'Art',
    'Menge (ml)',
    'Dauer links (min)',
    'Dauer rechts (min)',
    'Notiz',
  ];
  const dataRows = rows.map((row) => [
    formatCsvDate(row.occurred_at, tz),
    formatTimeLabel(row.occurred_at, tz),
    describeFeedType(row.feed_type),
    row.amount_ml !== null ? String(row.amount_ml) : '',
    minutesOrEmpty(row.duration_left_s),
    minutesOrEmpty(row.duration_right_s),
    row.note ?? '',
  ]);
  return buildCsv(headers, dataRows);
}

export function buildDiapersCsv(rows: readonly DiaperRow[], tz: string): string {
  const headers = ['Datum', 'Uhrzeit', 'Art', 'Konsistenz', 'Farbe', 'Ausgelaufen', 'Notiz'];
  const dataRows = rows.map((row) => [
    formatCsvDate(row.occurred_at, tz),
    formatTimeLabel(row.occurred_at, tz),
    describeDiaperKind(row.kind),
    row.consistency ? describeDiaperConsistency(row.consistency) : '',
    row.color ? describeDiaperColor(row.color) : '',
    row.leaked === 1 ? 'Ja' : 'Nein',
    row.note ?? '',
  ]);
  return buildCsv(headers, dataRows);
}

export function buildSleepsCsv(rows: readonly SleepRow[], tz: string): string {
  const headers = ['Datum', 'Beginn', 'Ende', 'Ort', 'Notiz'];
  const dataRows = rows.map((row) => [
    formatCsvDate(row.occurred_at, tz),
    formatTimeLabel(row.occurred_at, tz),
    row.ended_at ? formatTimeLabel(row.ended_at, tz) : '',
    row.location ? describeSleepLocation(row.location) : '',
    row.note ?? '',
  ]);
  return buildCsv(headers, dataRows);
}

export function buildMedicationsCsv(rows: readonly MedicationRow[], tz: string): string {
  const headers = ['Datum', 'Uhrzeit', 'Name', 'Dosis', 'Einheit', 'Gabeart', 'Notiz'];
  const dataRows = rows.map((row) => [
    formatCsvDate(row.occurred_at, tz),
    formatTimeLabel(row.occurred_at, tz),
    row.name,
    row.dose_amount !== null ? String(row.dose_amount) : '',
    row.dose_unit ? describeDoseUnit(row.dose_unit) : '',
    row.route ? describeMedicationRoute(row.route) : '',
    row.note ?? '',
  ]);
  return buildCsv(headers, dataRows);
}

function describeMeasuredSource(source: GrowthMeasurementRow['measured_source']): string {
  switch (source) {
    case 'home':
      return 'Zuhause';
    case 'doctor':
      return 'Ärztin/Arzt';
    default:
      return '';
  }
}

export function buildGrowthCsv(rows: readonly GrowthMeasurementRow[], tz: string): string {
  const headers = ['Datum', 'Uhrzeit', 'Gewicht (g)', 'Länge (mm)', 'Kopfumfang (mm)', 'Gemessen von', 'Notiz'];
  const dataRows = rows.map((row) => [
    formatCsvDate(row.occurred_at, tz),
    formatTimeLabel(row.occurred_at, tz),
    row.weight_g !== null ? String(row.weight_g) : '',
    row.length_mm !== null ? String(row.length_mm) : '',
    row.head_circumference_mm !== null ? String(row.head_circumference_mm) : '',
    describeMeasuredSource(row.measured_source),
    row.note ?? '',
  ]);
  return buildCsv(headers, dataRows);
}
