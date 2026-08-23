/**
 * tree/suggestions — pure, tested rules for guest suggestions submitted
 * through the shared "Stammbaum" viewer: the one-line list summary, and the
 * field-by-field diff a kind 'edit' suggestion shows against the person it
 * targets. Deliberately free of any Expo / React Native / PowerSync import,
 * same convention as ./logic.ts.
 *
 * TRUST MODEL — READ BEFORE TOUCHING THIS FILE
 * ---------------------------------------------
 * Every guest-typed field on a `TreeSuggestionRow` (`visitor_name`,
 * `given_name`, `family_name`, `birth_name`, `born_place`, `died_place`,
 * `message`) is free text typed by someone who is NOT a household member.
 * This module only ever turns that text into DISPLAY strings — it never
 * parses it as a date, an id, or an instruction, and every guest-typed
 * value that reaches a returned string goes through `truncateGuestText`
 * first, so a guest cannot make a review card grow without bound.
 */

import { describeGender } from './logic';
import type { RelativeGender, RelativeRow, TreeSuggestionRow } from './types';

/** Longest a single guest-typed value is shown as, before "…" — a review card must stay a review card, not a place to paste an essay. */
export const MAX_SUGGESTION_TEXT_LENGTH = 200;

/** Trims, then caps at `maxLength`, appending "…" only when something was actually cut. Guest text ONLY ever reaches the screen through this. */
export function truncateGuestText(text: string, maxLength: number = MAX_SUGGESTION_TEXT_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

/**
 * The personal-detail fields a `kind: 'edit'` suggestion may propose.
 * DELIBERATELY EXCLUDES `mother_id`/`father_id`: those are internal
 * `relatives.id` values, not something `changedFields` below can render as
 * "bisher X -> vorgeschlagen Y" without a full name lookup this function
 * doesn't have (it only sees the ONE targeted relative, not the whole
 * household). Restructuring who someone's parents are is exactly the kind
 * of structural edit that stays a job for `kind: 'add'` (a NEW person's OWN
 * parents, existence-checked in repository.ts#acceptAddSuggestion) or for a
 * household member editing directly — never something a guest edit
 * suggestion silently changes. `repository.ts#acceptEditSuggestion` applies
 * exactly this same field list, so what a caregiver sees here is exactly
 * what accepting actually changes.
 */
export const SUGGESTIBLE_RELATIVE_FIELDS = [
  'given_name',
  'family_name',
  'birth_name',
  'gender',
  'born_on',
  'born_place',
  'deceased',
  'died_on',
  'died_place',
] as const;

export type SuggestibleRelativeField = (typeof SUGGESTIBLE_RELATIVE_FIELDS)[number];

const FIELD_LABELS: Record<SuggestibleRelativeField, string> = {
  given_name: 'Vorname',
  family_name: 'Nachname',
  birth_name: 'Geburtsname',
  gender: 'Geschlecht',
  born_on: 'geboren am',
  born_place: 'Geburtsort',
  deceased: 'Verstorben',
  died_on: 'gestorben am',
  died_place: 'Sterbeort',
};

/**
 * Whether `s` actually proposes a value for `field` — text fields count as
 * "set" only when non-empty after trimming (a guest form that submits `''`
 * must not read as "clear this field"), `gender`/`deceased` count as "set"
 * whenever not NULL (both are tri-state on this table, see types.ts).
 */
export function isSuggestionFieldSet(s: TreeSuggestionRow, field: SuggestibleRelativeField): boolean {
  const value = s[field];
  if (field === 'gender' || field === 'deceased') {
    return value !== null && value !== undefined;
  }
  return typeof value === 'string' && value.trim().length > 0;
}

const NO_VALUE_LABEL = '(keine Angabe)';

function formatFieldValue(field: SuggestibleRelativeField, value: string | number | null): string {
  if (field === 'deceased') {
    if (value === 1) {
      return 'Ja';
    }
    if (value === 0) {
      return 'Nein';
    }
    return NO_VALUE_LABEL;
  }
  if (field === 'gender') {
    const label = describeGender((value as RelativeGender | null) ?? null);
    return label.length > 0 ? label : NO_VALUE_LABEL;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : NO_VALUE_LABEL;
}

/** One field a suggestion proposes for display: "feld" is the German label, "wert" is the guest-typed value, already length-limited. */
export type SuggestedFieldEntry = { feld: string; wert: string };

/**
 * The proposed fields of a `kind: 'add'` suggestion, as a plain list — no
 * "bisher" side, since there is no existing person to compare against yet.
 * Fields the guest left empty are dropped, same rule `changedFields` below
 * applies for 'edit'.
 */
export function addedFields(s: TreeSuggestionRow): SuggestedFieldEntry[] {
  return SUGGESTIBLE_RELATIVE_FIELDS.filter((field) => isSuggestionFieldSet(s, field)).map((field) => ({
    feld: FIELD_LABELS[field],
    wert: truncateGuestText(formatFieldValue(field, s[field])),
  }));
}

/** One field a `kind: 'edit'` suggestion changes, for the "bisher X -> vorgeschlagen Y" line. */
export type ChangedFieldEntry = { feld: string; bisher: string; vorgeschlagen: string };

/**
 * The fields a `kind: 'edit'` suggestion `s` actually proposes to change on
 * `current`, its target person — fields with no proposed value are dropped
 * entirely (task requirement), never shown as "no change". `current` is
 * only ever the ONE person this suggestion targets, see
 * SUGGESTIBLE_RELATIVE_FIELDS's own doc comment for why mother_id/father_id
 * never appear here.
 */
export function changedFields(s: TreeSuggestionRow, current: RelativeRow): ChangedFieldEntry[] {
  return SUGGESTIBLE_RELATIVE_FIELDS.filter((field) => isSuggestionFieldSet(s, field)).map((field) => ({
    feld: FIELD_LABELS[field],
    bisher: formatFieldValue(field, current[field]),
    vorgeschlagen: truncateGuestText(formatFieldValue(field, s[field])),
  }));
}

/** German label for a suggestion's kind — the "Art" column the review screen shows. */
export function describeSuggestionKind(kind: TreeSuggestionRow['kind']): string {
  switch (kind) {
    case 'add':
      return 'Neue Person';
    case 'edit':
      return 'Änderung';
    case 'note':
      return 'Notiz';
  }
}

/**
 * One-line summary for the review list — task requirement. For 'edit' this
 * deliberately stays generic ("Änderung vorgeschlagen"): `s` alone carries
 * no display name for its target (only `relative_id`), so the screen shows
 * the actual person's name alongside this from its own already-loaded
 * `relatives` list rather than this function guessing at one.
 */
export function describeSuggestion(s: TreeSuggestionRow): string {
  switch (s.kind) {
    case 'add': {
      const name = [s.given_name, s.family_name]
        .filter((part): part is string => !!part && part.trim().length > 0)
        .join(' ')
        .trim();
      return name.length > 0 ? `Neue Person: ${truncateGuestText(name)}` : 'Neue Person vorgeschlagen';
    }
    case 'edit':
      return 'Änderung vorgeschlagen';
    case 'note':
      return s.message && s.message.trim().length > 0 ? truncateGuestText(s.message) : 'Notiz ohne Text';
  }
}
