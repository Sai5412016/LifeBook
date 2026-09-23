/**
 * berichte/logic — pure calculation engine for the Wochen-/Monatsbericht:
 * which days a period covers, and everything the report shows about them.
 * No React hooks, no database access, no time read from the device — every
 * date, and "heute", comes in as a parameter (task requirement). Deliberately
 * free of any Expo / React Native / PowerSync import so it runs in plain
 * Node under Vitest; the device- and database-touching side lives in
 * ./repository, the screen in ./components.
 */

import { addDaysToLocalDate, isoWeekdayOfLocalDate, secondsBetween } from '@/core/time';
import { summarizeDiapersOfDay } from '@/features/diaper/summary';
import type { DiaperKind } from '@/features/diaper/types';

export type BerichtZeitraumArt = 'woche' | 'monat';

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function germanMonthName(monthStr: string): string {
  return MONTH_NAMES[Number(monthStr) - 1] ?? monthStr;
}

/**
 * Every `local_date` (YYYY-MM-DD, ascending) in the week (Montag–Sonntag) or
 * month (1.–letzter) containing `ankerDatum`. Deliberately does NOT clip to
 * the child's birth day or to today — task requirement: that clipping is a
 * DISPLAY concern (the screen's period picker, and `berichtBerechnen`'s own
 * "nicht in der Zukunft" rule below), not this function's.
 */
export function zeitraumTage(art: BerichtZeitraumArt, ankerDatum: string): string[] {
  if (art === 'woche') {
    const weekday = isoWeekdayOfLocalDate(ankerDatum); // 1 (Mo) … 7 (So)
    const monday = addDaysToLocalDate(ankerDatum, -(weekday - 1));
    return Array.from({ length: 7 }, (_, index) => addDaysToLocalDate(monday, index));
  }

  const [yearStr, monthStr] = ankerDatum.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const firstOfMonth = `${yearStr}-${monthStr}-01`;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstOfNextMonth = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const lastOfMonth = addDaysToLocalDate(firstOfNextMonth, -1);

  const days: string[] = [];
  for (let day = firstOfMonth; day <= lastOfMonth; day = addDaysToLocalDate(day, 1)) {
    days.push(day);
  }
  return days;
}

/** "22. – 28. September 2026" (same month) / "31. August – 6. September 2026" (spans a month change) / "September 2026". */
export function formatZeitraumLabel(art: BerichtZeitraumArt, tage: readonly string[]): string {
  if (tage.length === 0) {
    return '';
  }
  if (art === 'monat') {
    const [year, month] = tage[0].split('-');
    return `${germanMonthName(month)} ${year}`;
  }

  const [firstYear, firstMonth, firstDay] = tage[0].split('-');
  const [lastYear, lastMonth, lastDay] = tage[tage.length - 1].split('-');
  if (firstYear === lastYear && firstMonth === lastMonth) {
    return `${Number(firstDay)}. – ${Number(lastDay)}. ${germanMonthName(lastMonth)} ${lastYear}`;
  }
  return `${Number(firstDay)}. ${germanMonthName(firstMonth)} – ${Number(lastDay)}. ${germanMonthName(lastMonth)} ${lastYear}`;
}

/** Shifts `ankerDatum` one period forward (`richtung = 1`) or back (`richtung = -1`). */
export function verschobenerAnker(
  art: BerichtZeitraumArt,
  ankerDatum: string,
  richtung: 1 | -1,
): string {
  if (art === 'woche') {
    return addDaysToLocalDate(ankerDatum, richtung * 7);
  }

  const [yearStr, monthStr] = ankerDatum.split('-');
  let year = Number(yearStr);
  let month = Number(monthStr) + richtung;
  if (month > 12) {
    month = 1;
    year += 1;
  } else if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** No future periods — locked as soon as the shown period already contains today. */
export function canGoToNextPeriod(tage: readonly string[], todayLocalDate: string): boolean {
  return !tage.includes(todayLocalDate);
}

export type BerichtFeedRow = {
  local_date: string;
  deleted_at: string | null;
  feed_type: 'breast_left' | 'breast_right' | 'breast_both' | 'bottle_breastmilk' | 'bottle_formula';
  amount_ml: number | null;
  duration_left_s: number | null;
  duration_right_s: number | null;
};

export type BerichtDiaperRow = {
  local_date: string;
  deleted_at: string | null;
  kind: DiaperKind;
};

export type BerichtSleepRow = {
  local_date: string;
  deleted_at: string | null;
  occurred_at: string;
  ended_at: string | null;
};

export type BerichtMedicationRow = {
  local_date: string;
  deleted_at: string | null;
  name: string;
};

export type BerichtGrowthRow = {
  local_date: string;
  deleted_at: string | null;
  occurred_at: string;
  weight_g: number | null;
};

export type BerichtDaten = {
  feeds: readonly BerichtFeedRow[];
  diapers: readonly BerichtDiaperRow[];
  sleeps: readonly BerichtSleepRow[];
  medications: readonly BerichtMedicationRow[];
  growthMeasurements: readonly BerichtGrowthRow[];
};

export type FeedingReport = {
  count: number;
  avgPerDay: number | null;
  totalMl: number;
  avgMlPerDay: number | null;
  avgMlPerBottle: number | null;
  totalBreastMinutes: number;
  avgBreastMinutesPerDay: number | null;
};

export type DiaperReport = {
  count: number;
  totalWet: number;
  avgWetPerDay: number | null;
  totalDirty: number;
  avgDirtyPerDay: number | null;
};

export type SleepReport = {
  count: number;
  totalMinutes: number;
  avgMinutesPerDay: number | null;
  longestMinutes: number | null;
};

export type MedicationReportEntry = {
  name: string;
  countInPeriod: number;
  /** Ascending `local_date`s within the period (not in the future) this Mittel has NO dose recorded. */
  missingDays: string[];
};

export type GrowthReport = {
  firstWeightG: number | null;
  lastWeightG: number | null;
  diffG: number | null;
};

export type Bericht = {
  /** Days of `zeitraumTage` that are not in the future — the denominator every average divides by. */
  tageImZeitraum: number;
  feeding: FeedingReport;
  diapers: DiaperReport;
  sleep: SleepReport;
  medications: MedicationReportEntry[];
  growth: GrowthReport;
  /** Ascending `local_date`s (not in the future) with no entry of ANY kind. */
  tageOhneEintrag: string[];
};

/** `null` unless `denominator > 0` — the one rule every average in this file follows (task requirement: never divide by zero). */
function avg(total: number, denominator: number): number | null {
  return denominator > 0 ? total / denominator : null;
}

/**
 * Computes the whole report from already period-scoped rows (task
 * requirement: `daten`'s rows are pre-filtered to the period by the
 * caller). Soft-deleted rows (`deleted_at` set) never count, anywhere.
 *
 * `todayLocalDate` is NOT part of the task's literal 2-argument signature —
 * added for the same reason `features/medication/logic.ts#favoritenAusVerlauf`
 * deviates from ITS literal 1-argument signature: "Durchschnitte immer über
 * die Anzahl der Tage im Zeitraum, die nicht in der Zukunft liegen" and the
 * Medikamente-Lücken rule ("Tage … die nicht in der Zukunft liegen") both
 * need to know which of `zeitraumTage`'s days are still in the future, and
 * Architekturregel 2 forbids constructing that knowledge (`new Date()`/an
 * implicit "heute") inside feature code — it has to come in as a parameter
 * for this function to stay pure, deterministic and testable.
 */
export function berichtBerechnen(
  tage: readonly string[],
  daten: BerichtDaten,
  todayLocalDate: string,
): Bericht {
  const relevantDays = tage.filter((day) => day <= todayLocalDate);
  const dayCount = relevantDays.length;

  // Füttern
  const feeds = daten.feeds.filter((row) => !row.deleted_at);
  const bottleFeeds = feeds.filter(
    (row) => row.feed_type === 'bottle_breastmilk' || row.feed_type === 'bottle_formula',
  );
  const breastFeeds = feeds.filter((row) => row.feed_type.startsWith('breast_'));
  const totalMl = bottleFeeds.reduce((sum, row) => sum + (row.amount_ml ?? 0), 0);
  const totalBreastSeconds = breastFeeds.reduce(
    (sum, row) => sum + (row.duration_left_s ?? 0) + (row.duration_right_s ?? 0),
    0,
  );
  const totalBreastMinutes = Math.round(totalBreastSeconds / 60);
  const feeding: FeedingReport = {
    count: feeds.length,
    avgPerDay: avg(feeds.length, dayCount),
    totalMl,
    avgMlPerDay: avg(totalMl, dayCount),
    avgMlPerBottle: avg(totalMl, bottleFeeds.length),
    totalBreastMinutes,
    avgBreastMinutesPerDay: avg(totalBreastMinutes, dayCount),
  };

  // Wickeln — dieselbe nass/Stuhl-Zählregel wie das Alltag-Tab (both zählt zu beidem).
  const diapers = daten.diapers.filter((row) => !row.deleted_at);
  const diaperSummary = summarizeDiapersOfDay(diapers);
  const diaperReport: DiaperReport = {
    count: diapers.length,
    totalWet: diaperSummary.wet,
    avgWetPerDay: avg(diaperSummary.wet, dayCount),
    totalDirty: diaperSummary.dirty,
    avgDirtyPerDay: avg(diaperSummary.dirty, dayCount),
  };

  // Schlaf — nur BEENDETE Phasen tragen zu Dauer/längster Phase bei; eine
  // noch laufende Phase hat keine bekannte Dauer, ohne "jetzt" von außen
  // (dieselbe Grenze wie überall in diesem Modul: kein new Date() intern).
  const sleeps = daten.sleeps.filter((row) => !row.deleted_at);
  const finishedDurationsSeconds = sleeps
    .filter((row): row is BerichtSleepRow & { ended_at: string } => row.ended_at !== null)
    .map((row) => secondsBetween(row.occurred_at, row.ended_at));
  const totalSleepMinutes = Math.round(
    finishedDurationsSeconds.reduce((sum, seconds) => sum + seconds, 0) / 60,
  );
  const longestMinutes =
    finishedDurationsSeconds.length > 0 ? Math.round(Math.max(...finishedDurationsSeconds) / 60) : null;
  const sleepReport: SleepReport = {
    count: sleeps.length,
    totalMinutes: totalSleepMinutes,
    avgMinutesPerDay: avg(totalSleepMinutes, dayCount),
    longestMinutes,
  };

  // Medikamente
  const medications = daten.medications.filter((row) => !row.deleted_at);
  const medicationGroups = new Map<string, { displayName: string; daysGiven: Set<string>; count: number }>();
  for (const row of medications) {
    const key = row.name.trim().toLowerCase();
    const group = medicationGroups.get(key) ?? { displayName: row.name, daysGiven: new Set<string>(), count: 0 };
    group.count += 1;
    group.daysGiven.add(row.local_date);
    medicationGroups.set(key, group);
  }
  const medicationReport: MedicationReportEntry[] = Array.from(medicationGroups.values())
    .map((group) => ({
      name: group.displayName,
      countInPeriod: group.count,
      missingDays: relevantDays.filter((day) => !group.daysGiven.has(day)),
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  // Gewicht
  const weighted = daten.growthMeasurements
    .filter((row): row is BerichtGrowthRow & { weight_g: number } => !row.deleted_at && row.weight_g !== null)
    .slice()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  const firstWeightG = weighted.length > 0 ? weighted[0].weight_g : null;
  const lastWeightG = weighted.length > 0 ? weighted[weighted.length - 1].weight_g : null;
  const growthReport: GrowthReport = {
    firstWeightG,
    lastWeightG,
    diffG: firstWeightG !== null && lastWeightG !== null ? lastWeightG - firstWeightG : null,
  };

  // Erfassung — Tage ohne einen einzigen Eintrag irgendeiner Art, ebenfalls
  // auf Tage bis heute begrenzt (ein morgiger Tag hat naturgemäß nie einen
  // Eintrag; das in die Lücken-Liste aufzunehmen wäre Rauschen, kein Befund).
  const daysWithEntry = new Set<string>();
  for (const row of [...feeds, ...diapers, ...sleeps, ...medications, ...weighted]) {
    daysWithEntry.add(row.local_date);
  }
  const tageOhneEintrag = relevantDays.filter((day) => !daysWithEntry.has(day));

  return {
    tageImZeitraum: dayCount,
    feeding,
    diapers: diaperReport,
    sleep: sleepReport,
    medications: medicationReport,
    growth: growthReport,
    tageOhneEintrag,
  };
}

/** "12" / "–" for null — task requirement: ganze Zahlen ohne Nachkommastellen. */
export function formatBerichtZahl(n: number | null): string {
  return n === null ? '–' : String(Math.round(n));
}

/** "125.0" / "–" for null — die eine Ausnahme: ml je Flasche mit einer Nachkommastelle. */
export function formatMlProFlasche(n: number | null): string {
  return n === null ? '–' : n.toFixed(1);
}

/**
 * "12., 15., 19. September" / "31. August, 3., 5. September" — a list of
 * `local_date`s as compact day numbers, grouped by month (a week can span a
 * month change) with the month name written once per group. Shared by
 * `formatMedicationGapLabel` and `formatMissingDaysLabel` below — both
 * show a day list, just with a different lead-in.
 */
function formatCompactDayList(dates: readonly string[]): string {
  const groups: { month: string; days: number[] }[] = [];
  for (const localDate of dates) {
    const [, month, day] = localDate.split('-');
    const dayNumber = Number(day);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.month === month) {
      currentGroup.days.push(dayNumber);
    } else {
      groups.push({ month, days: [dayNumber] });
    }
  }
  return groups
    .map((group) => `${group.days.map((day) => `${day}.`).join(', ')} ${germanMonthName(group.month)}`)
    .join(', ');
}

/**
 * "Fehlt an 3 Tagen: 12., 15., 19. September" — die hervorgehobene Zeile
 * unter einem Mittel mit Lücken. Leer (keine Zeile), wenn es keine Lücken
 * gibt.
 */
export function formatMedicationGapLabel(missingDays: readonly string[]): string {
  if (missingDays.length === 0) {
    return '';
  }
  const countLabel = missingDays.length === 1 ? '1 Tag' : `${missingDays.length} Tagen`;
  return `Fehlt an ${countLabel}: ${formatCompactDayList(missingDays)}`;
}

/** "3 Tage ohne Eintrag: 22., 23. September" — der Erfassung-Abschnitt. Leer, wenn es keine Lücken gibt (der Bildschirm zeigt dann eine positive Meldung statt dieser Zeile). */
export function formatMissingDaysLabel(tageOhneEintrag: readonly string[]): string {
  if (tageOhneEintrag.length === 0) {
    return '';
  }
  const countLabel = tageOhneEintrag.length === 1 ? '1 Tag' : `${tageOhneEintrag.length} Tage`;
  return `${countLabel} ohne Eintrag: ${formatCompactDayList(tageOhneEintrag)}`;
}
