/**
 * core/tracking/day-markers — pure logic for the Alltag calendar's per-day
 * presence dots (task 2026-09-26): for a range of days, whether each one has
 * at least one feed / medication / diaper entry.
 *
 * Deliberately NOT built on features/berichte/logic.ts#berichtBerechnen:
 * that function aggregates a whole period into ONE set of totals (average
 * per day, sums, gaps) — nothing it returns exposes a PER-DAY breakdown by
 * category, which is exactly what the calendar dots need. `zeitraumTage`
 * from that same module IS reused for the actual day ranges (week/month) —
 * see features/timeline/components/week-strip.tsx and month-grid.tsx.
 *
 * Free of any Expo / React Native / PowerSync import so it runs in plain
 * Node under Vitest; the device- and database-touching side (one range
 * query per table, reused across the whole displayed period) lives in
 * features/timeline/repository.ts.
 */

export type DayMarkers = { hasFeed: boolean; hasMedication: boolean; hasDiaper: boolean };

export type MarkerSourceRow = { local_date: string; deleted_at: string | null };

function presentLocalDates(rows: readonly MarkerSourceRow[]): Set<string> {
  const dates = new Set<string>();
  for (const row of rows) {
    if (!row.deleted_at) {
      dates.add(row.local_date);
    }
  }
  return dates;
}

/**
 * One `DayMarkers` per day in `days` (a `Map` keyed by that same
 * `local_date` string). `feeds`/`medications`/`diapers` are already
 * range-scoped by the caller (one query per table for the whole displayed
 * week/month, not one per day) but not necessarily day-scoped — this groups
 * them. A day outside all three inputs gets `{ hasFeed: false, hasMedication:
 * false, hasDiaper: false }`, never a missing map entry, so callers can
 * index it directly without an extra existence check.
 */
export function dayMarkersFor(
  days: readonly string[],
  feeds: readonly MarkerSourceRow[],
  medications: readonly MarkerSourceRow[],
  diapers: readonly MarkerSourceRow[],
): Map<string, DayMarkers> {
  const feedDates = presentLocalDates(feeds);
  const medicationDates = presentLocalDates(medications);
  const diaperDates = presentLocalDates(diapers);

  const result = new Map<string, DayMarkers>();
  for (const day of days) {
    result.set(day, {
      hasFeed: feedDates.has(day),
      hasMedication: medicationDates.has(day),
      hasDiaper: diaperDates.has(day),
    });
  }
  return result;
}
