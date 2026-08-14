/**
 * people/logic — pure decisions: German role labels, initials for the
 * placeholder avatar, roster ordering, and the period label on the detail
 * screen. No Expo / React Native / PowerSync import, so this runs in plain
 * Node under Vitest — device- and database-touching code lives in
 * ./photo and ./repository.
 */

import type { PersonRole } from './types';

/** Role chips on the add/edit screen, in the order the spec lists them. */
export const ROLE_OPTIONS: { value: PersonRole; label: string }[] = [
  { value: 'midwife', label: 'Hebamme' },
  { value: 'doctor', label: 'Ärztin/Arzt' },
  { value: 'nurse', label: 'Pflegekraft' },
  { value: 'family', label: 'Familie' },
  { value: 'godparent', label: 'Patin/Pate' },
  { value: 'other', label: 'Sonstige' },
];

const ROLE_LABELS: Record<PersonRole, string> = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PersonRole, string>;

/** German label for a role, e.g. for the strip and the detail screen. */
export function describeRole(role: PersonRole): string {
  return ROLE_LABELS[role] ?? ROLE_LABELS.other;
}

/**
 * Up to two initials for the placeholder avatar (no photo yet). One word →
 * its first two letters; multiple words → first letter of the first and
 * last word, the way a monogram normally works.
 */
export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type SortablePerson = { sort_index: number; created_at: string };

/** Roster order: `sort_index` ascending, then creation order — mirrors the SQL ORDER BY in repository.ts. */
export function sortPeople<T extends SortablePerson>(people: readonly T[]): T[] {
  return [...people].sort(
    (a, b) => a.sort_index - b.sort_index || a.created_at.localeCompare(b.created_at),
  );
}

/**
 * "DD.MM.YYYY" from an already-localised YYYY-MM-DD date — exported for the
 * add/edit form's date-choice fields (2026-08-15), which show whatever the
 * native picker last produced in this same compact form, not just the
 * detail screen's period label below.
 */
export const toGermanDate = (localDate: string): string => {
  const [year, month, day] = localDate.split('-');
  return `${day}.${month}.${year}`;
};

/**
 * Whether an optional "Bis" date is acceptable given an optional "Von"
 * date — false only when BOTH are set and "Bis" falls strictly before
 * "Von". Either side missing is always valid; both fields stay optional
 * and independently clearable (2026-08-15 task requirement). Plain string
 * comparison, not Date parsing: YYYY-MM-DD is fixed-width and zero-padded,
 * so lexicographic order already IS chronological order — matches this
 * file's existing no-Date-construction style (see `formatPeriodLabel`).
 */
export function isMetToValid(metFromLocalDate: string | null, metToLocalDate: string | null): boolean {
  if (!metFromLocalDate || !metToLocalDate) {
    return true;
  }
  return metToLocalDate >= metFromLocalDate;
}

/**
 * Label for the detail screen's "Zeitraum" card, from already-localised
 * YYYY-MM-DD dates (never a UTC instant — see core/time#toLocalDate, which
 * is what a caller must run `met_from`/`met_to` through first). Pure string
 * formatting only, no Date construction, so this needs no core/time import.
 * Returns null when neither end is set, so the caller can omit the card
 * entirely rather than show one that says nothing.
 */
export function formatPeriodLabel(
  metFromLocalDate: string | null,
  metToLocalDate: string | null,
): string | null {
  if (metFromLocalDate && metToLocalDate) {
    return `${toGermanDate(metFromLocalDate)} – ${toGermanDate(metToLocalDate)}`;
  }
  if (metFromLocalDate) {
    return `seit ${toGermanDate(metFromLocalDate)}`;
  }
  if (metToLocalDate) {
    return `bis ${toGermanDate(metToLocalDate)}`;
  }
  return null;
}
