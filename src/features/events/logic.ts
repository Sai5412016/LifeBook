/**
 * events/logic — pure, tested rules for the "Ereignisse" tab: sorting,
 * the age label, the text preview shown in the list, and the photo
 * ordering/title-image rule. Deliberately free of any Expo / React Native /
 * PowerSync import so it runs in plain Node under Vitest — the
 * device-touching side lives in repository.ts and the screens.
 */

import { ageInDays } from '@/core/time';
import { formatDayAndWeekLabel } from '@/features/photos/identity';

export const EVENT_TITLE_MAX_LENGTH = 80;
export const EVENT_NOTE_MAX_LENGTH = 2000;
/** How much of the text preview a list row shows before cutting it off. */
export const EVENT_PREVIEW_MAX_LENGTH = 120;

/** Trims a title and enforces the length cap regardless of how it arrived (mirrors photos/identity.ts#normalizePhotoNote). */
export function normalizeEventTitle(input: string): string {
  return input.trim().slice(0, EVENT_TITLE_MAX_LENGTH);
}

/** Trims the free text; a blank result means "no text", so callers store `null` — same contract as a photo caption. */
export function normalizeEventNote(input: string): string | null {
  const trimmed = input.trim().slice(0, EVENT_NOTE_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Newest first — the list screen's whole sort order. Stable on `occurred_at` ties via `id`, so two events logged in the same second don't reorder between renders. */
export function sortEventsByOccurredAtDesc<T extends { occurred_at: string; id: string }>(
  events: readonly T[],
): T[] {
  return [...events].sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) {
      return a.occurred_at < b.occurred_at ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * "Tag 41 · Woche 5" etc. for one event, relative to the child's birth —
 * thin wrapper around the existing, separately-tested
 * `ageInDays`/`formatDayAndWeekLabel` (task requirement: reuse the age
 * label from the existing stock, not reimplement it). Kept here only so
 * callers have one call instead of threading both through every screen.
 *
 * Uses `formatDayAndWeekLabel`, not `formatAgeLabel` (switched 2026-09-10,
 * fourth pass): the result is embedded after a date by
 * `formatEventRowSubtitle` below, with "—" as the separator between the
 * two — the app-wide rule since this same task is that "·" only ever
 * separates pieces WITHIN one age label, never two different pieces of
 * information, so a result like "Tag 34 · Woche 4" reads unambiguously
 * next to the date it's embedded after.
 */
export function formatEventAgeLabel(eventUtcIso: string, birthUtcIso: string, tz: string): string {
  return formatDayAndWeekLabel(ageInDays(eventUtcIso, birthUtcIso, tz));
}

/**
 * The list row's and the detail screen's subtitle line: the date, and —
 * where an age label is available — the age after it. Extracted as its
 * OWN pure function (2026-09-10, fourth pass) so both screens
 * (app/(tabs)/ereignisse.tsx, app/ereignisse/[id]/index.tsx) build this
 * from one tested place instead of duplicating the composition inline;
 * previously that inline duplication is exactly what let the two copies
 * exist with the separator that needed changing in two places at once.
 *
 * "—" joins date and age — "·" stays reserved for what's INSIDE the age
 * label itself ("Tag N · Woche M", see formatEventAgeLabel above).
 */
export function formatEventRowSubtitle(localDate: string, ageLabel: string): string {
  const dateLabel = formatShortGermanDate(localDate);
  return ageLabel ? `${dateLabel} — ${ageLabel}` : dateLabel;
}

/** "DD.MM.YYYY" — compact enough for a list row, unlike `core/time#formatDayLabel`'s full weekday form used for whole-day chronicle headers. */
export function formatShortGermanDate(localDate: string): string {
  const [year, month, day] = localDate.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * The list row's text preview: the first LINE of the note, cut to
 * `EVENT_PREVIEW_MAX_LENGTH` with an ellipsis if that line alone is
 * longer. A multi-line note never leaks its second line into a one-line
 * list row. `null`/empty input yields `''`, so a caller can render it
 * unconditionally without its own `if`.
 */
export function formatEventTextPreview(note: string | null, maxLength = EVENT_PREVIEW_MAX_LENGTH): string {
  if (!note) {
    return '';
  }
  const firstLine = note.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= maxLength) {
    return firstLine;
  }
  return `${firstLine.slice(0, maxLength).trimEnd()}…`;
}

export type EventPhotoPlan = {
  /** The title image — the first selected photo, or `null` if none is selected. */
  titlePhotoId: string | null;
  /** Every selected photo with its display order, in selection order. */
  photos: { photoId: string; sortIndex: number }[];
};

/**
 * Turns an ordered selection (as `features/photos/selection.ts#toggleSelected`
 * produces it — new picks append at the end) into the title-image rule plus
 * the `sort_index` every `milestone_photos` row needs. The FIRST selected
 * photo is always the title image, matching the task's explicit rule; there
 * is no separate "make this the title image" action to keep in sync.
 */
export function planEventPhotoOrder(selectedPhotoIds: readonly string[]): EventPhotoPlan {
  return {
    titlePhotoId: selectedPhotoIds[0] ?? null,
    photos: selectedPhotoIds.map((photoId, index) => ({ photoId, sortIndex: index })),
  };
}
