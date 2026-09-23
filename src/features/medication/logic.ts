/**
 * medication/logic — pure logic for the Medikamente & Vitamine section:
 * favorite quick-buttons derived from history, the doppelgabe (double-dose)
 * check, and the date/time math `gabeEintragen`/`gabeAendern` need. Like
 * feeding/timer.ts, this module never constructs a `Date` of its own — every
 * duration comes from `secondsBetween` (core/time), and "more recent"
 * comparisons use plain string comparison on ISO-8601 UTC timestamps
 * (lexical order == chronological order for that format). Deliberately free
 * of any Expo / React Native / PowerSync import so it runs in plain Node
 * under Vitest; the device- and database-touching side lives in ./repository.
 */

import { combineLocalDateAndTime, formatTimeLabel, secondsBetween, toLocalDate } from '@/core/time';

import type { MedicationDoseUnit, MedicationRoute } from './types';

const FAVORITES_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAVORITES = 6;

/** German label for a dose unit — matches the six unit chips in the form. */
export function describeDoseUnit(unit: MedicationDoseUnit): string {
  switch (unit) {
    case 'ie':
      return 'IE';
    case 'drops':
      return 'Tropfen';
    case 'ml':
      return 'ml';
    case 'mg':
      return 'mg';
    case 'spoon':
      return 'Messlöffel';
    case 'piece':
      return 'Stück';
  }
}

/** German label for how a dose was given. */
export function describeMedicationRoute(route: MedicationRoute): string {
  switch (route) {
    case 'oral':
      return 'oral';
    case 'bottle':
      return 'in die Flasche';
    case 'other':
      return 'sonstige';
  }
}

/** "500 IE" / "2.5 ml" / "" when neither dose amount nor unit is set. */
export function formatDoseLabel(doseAmount: number | null, doseUnit: MedicationDoseUnit | null): string {
  const parts = [doseAmount !== null ? String(doseAmount) : '', doseUnit ? describeDoseUnit(doseUnit) : ''];
  return parts.filter(Boolean).join(' ');
}

/** "Tamara Müller" -> "Tamara" — the name shown on a button/list row, never the full display name. */
export function firstNameOf(displayName: string): string {
  const trimmed = displayName.trim();
  const firstSpace = trimmed.indexOf(' ');
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}

export type MedicationHistoryEntry = {
  name: string;
  dose_amount: number | null;
  dose_unit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  occurred_at: string;
  deleted_at: string | null;
};

export type MedicationFavorite = {
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  /** The Gabeart of the MOST RECENTLY used entry in this group — route is not part of the grouping key itself (task requirement). */
  route: MedicationRoute | null;
};

/**
 * Up to 6 quick-button suggestions, derived purely from history — no
 * separate favorites table (task requirement). Groups by name (trimmed,
 * case-insensitive) + dose_amount + dose_unit, counts how many non-deleted
 * doses of each group fall in the last 30 days relative to `nowUtcIso` (the
 * caller's already-resolved "now" — never computed in here, see file
 * header), and sorts by that count descending, ties broken by whichever
 * group was used more recently overall (not just within the 30-day window).
 * The displayed name and route both keep whichever CASING/Gabeart was used
 * most recently, even though grouping itself ignores case and does not key
 * on route at all — two doses of the same medicine can disagree on route
 * (2026-09-24: a quick-tap re-log now carries the newer one forward instead
 * of always writing null).
 */
export function favoritenAusVerlauf(
  eintraege: readonly MedicationHistoryEntry[],
  nowUtcIso: string,
): MedicationFavorite[] {
  type Group = {
    name: string;
    doseAmount: number | null;
    doseUnit: MedicationDoseUnit | null;
    route: MedicationRoute | null;
    countLast30Days: number;
    lastUsedAtUtcIso: string;
  };
  const groups = new Map<string, Group>();

  for (const entry of eintraege) {
    if (entry.deleted_at) {
      continue;
    }
    const key = `${entry.name.trim().toLowerCase()}|${entry.dose_amount ?? ''}|${entry.dose_unit ?? ''}`;
    const withinWindow = secondsBetween(entry.occurred_at, nowUtcIso) <= FAVORITES_WINDOW_SECONDS;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        name: entry.name,
        doseAmount: entry.dose_amount,
        doseUnit: entry.dose_unit,
        route: entry.route,
        countLast30Days: withinWindow ? 1 : 0,
        lastUsedAtUtcIso: entry.occurred_at,
      });
      continue;
    }

    if (withinWindow) {
      existing.countLast30Days += 1;
    }
    if (entry.occurred_at > existing.lastUsedAtUtcIso) {
      existing.lastUsedAtUtcIso = entry.occurred_at;
      existing.name = entry.name;
      existing.route = entry.route;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.countLast30Days !== a.countLast30Days) {
        return b.countLast30Days - a.countLast30Days;
      }
      return a.lastUsedAtUtcIso < b.lastUsedAtUtcIso ? 1 : -1;
    })
    .slice(0, MAX_FAVORITES)
    .map(({ name, doseAmount, doseUnit, route }) => ({ name, doseAmount, doseUnit, route }));
}

export type MedicationTodayEntry = {
  name: string;
  dose_amount: number | null;
  dose_unit: MedicationDoseUnit | null;
  occurred_at: string;
  local_date: string;
  deleted_at: string | null;
};

/**
 * The latest of TODAY's (non-deleted) doses matching `favorite`, or null if
 * none — the doppelgabe-protection check behind the confirmation dialog.
 * Compares `local_date` to `todayLocalDate` directly, NEVER a timestamp
 * difference: a dose at 23:58 yesterday and a check two minutes later, at
 * 00:00 today, are under a minute apart by the clock but belong to
 * different days — `local_date` is what "today" means everywhere else in
 * this app (Architekturregel 2), so it is what decides this too.
 */
export function letzteGabeHeute<T extends MedicationTodayEntry>(
  eintraege: readonly T[],
  favorite: MedicationFavorite,
  todayLocalDate: string,
): T | null {
  const favoriteName = favorite.name.trim().toLowerCase();
  let latest: T | null = null;

  for (const entry of eintraege) {
    if (entry.deleted_at || entry.local_date !== todayLocalDate) {
      continue;
    }
    if (entry.name.trim().toLowerCase() !== favoriteName) {
      continue;
    }
    if (entry.dose_amount !== favorite.doseAmount || entry.dose_unit !== favorite.doseUnit) {
      continue;
    }
    if (!latest || entry.occurred_at > latest.occurred_at) {
      latest = entry;
    }
  }

  return latest;
}

/** "Heute 09:12 · Tamara" — the button's third line once a favorite has already been given today. */
export function formatGivenTodayLabel(givenAtUtcIso: string, tz: string, firstName: string): string {
  return `Heute ${formatTimeLabel(givenAtUtcIso, tz)} · ${firstName}`;
}

/** "Heute um 09:12 bereits gegeben. Wirklich noch einmal?" — the doppelgabe confirmation's exact wording. */
export function formatDuplicateDoseWarning(givenAtUtcIso: string, tz: string): string {
  return `Heute um ${formatTimeLabel(givenAtUtcIso, tz)} bereits gegeben. Wirklich noch einmal?`;
}

export type ResolvedGabeOccurredAt = { occurredAtUtcIso: string; localDate: string };

/**
 * Resolves what `gabeEintragen`/`gabeAendern` store for occurred_at/local_date
 * from the form's chosen local date + time. "Nachtragen" (task requirement:
 * yesterday must be selectable) goes through this exact same path as
 * "jetzt" — there's only one rule to get right: local_date always comes
 * from the ACTUAL resolved occurred_at, never from `nowUtcIso()`. This is
 * Architekturregel 2's DEFAULT behaviour (local_date computed once, at
 * insert, from whatever occurred_at is being written) — not its correction
 * exception, since nothing here is changing an already-stored row's meaning.
 * Pulled out as pure logic (unlike the repository functions that call it,
 * which touch @powersync/react-native and can't run under Vitest —
 * Architekturregel 3) specifically so this rule is independently testable.
 */
export function resolveGabeOccurredAt(localDate: string, time: string, tz: string): ResolvedGabeOccurredAt | null {
  const occurredAtUtcIso = combineLocalDateAndTime(localDate, time, tz);
  if (!occurredAtUtcIso) {
    return null;
  }
  return { occurredAtUtcIso, localDate: toLocalDate(occurredAtUtcIso, tz) };
}
