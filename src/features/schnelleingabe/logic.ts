/**
 * schnelleingabe/logic — pure logic for the quick-entry bar (task
 * 2026-09-23): which defaults a tap should carry forward (last-used bottle
 * type/amount, last-used breast side), which day it writes to given the
 * Alltag day selector, the double-tap guard, and the snackbar's label text.
 * Free of any Expo / React Native / PowerSync import so it runs in plain
 * Node under Vitest (Architekturregel 3) — the device- and database-touching
 * side lives in ./repository.
 */

import { resolveLogOccurredAt, secondsBetween } from '@/core/time';
import type { FeedType } from '@/features/feeding/types';

/** Written when this child has no earlier bottle feed at all — "Muttermilch" is the Fläschchen-Formular's own first chip. */
export const DEFAULT_BOTTLE_FEED_TYPE: FeedType = 'bottle_breastmilk';
/** Written when this child has no earlier breastfeed at all — "links" is the existing timer buttons' first option. */
export const DEFAULT_BREAST_FEED_TYPE: FeedType = 'breast_left';

/** Two taps on the SAME button within this many seconds count as one (task requirement: "nachts passiert das"). */
const DOUBLE_TAP_WINDOW_SECONDS = 2;

/** Backfill time for a quick-log on a past day — same convention as diaper-section.tsx's/feeding-section.tsx's own BACKFILL_TIME. */
export const SCHNELL_BACKFILL_TIME = '12:00';

export type BottleFeedLike = {
  feed_type: FeedType;
  amount_ml: number | null;
  occurred_at: string;
  deleted_at: string | null;
};

export type SchnellFlascheDefaults = { feedType: FeedType; amountMl: number | null };

/**
 * Last-used bottle type + ITS OWN amount, from any feed history (not only
 * today) — the most recent bottle feed decides both together, so a
 * different-typed row logged more recently overall (a breastfeed, say)
 * never gets mixed into the amount. Deliberately filters to bottle feeds
 * FIRST, then picks the latest among those — so the most recent row overall
 * having a different `feed_type` changes nothing about the result. Empty or
 * bottle-free history returns the documented default type with a `null`
 * amount, and never throws.
 */
export function letzterFlaschentyp(feeds: readonly BottleFeedLike[]): SchnellFlascheDefaults {
  let latest: BottleFeedLike | null = null;
  for (const feed of feeds) {
    if (feed.deleted_at || !feed.feed_type.startsWith('bottle_')) {
      continue;
    }
    if (!latest || feed.occurred_at > latest.occurred_at) {
      latest = feed;
    }
  }
  return latest
    ? { feedType: latest.feed_type, amountMl: latest.amount_ml }
    : { feedType: DEFAULT_BOTTLE_FEED_TYPE, amountMl: null };
}

export type BreastFeedLike = { feed_type: FeedType; occurred_at: string; deleted_at: string | null };

/** Last-used breast type ('breast_left' | 'breast_right' | 'breast_both'), same filter-then-latest convention as `letzterFlaschentyp`. */
export function letzterBrusttyp(feeds: readonly BreastFeedLike[]): FeedType {
  let latest: BreastFeedLike | null = null;
  for (const feed of feeds) {
    if (feed.deleted_at || !feed.feed_type.startsWith('breast_')) {
      continue;
    }
    if (!latest || feed.occurred_at > latest.occurred_at) {
      latest = feed;
    }
  }
  return latest ? latest.feed_type : DEFAULT_BREAST_FEED_TYPE;
}

export type ResolvedSchnellOccurredAt = { occurredAtUtcIso: string; localDate: string };

/**
 * occurred_at + local_date for a quick-log tap: "jetzt" while the Alltag day
 * selector shows today, otherwise noon of the SELECTED day — never silently
 * "heute" (task requirement). Same rule `logDiaper`/`logBottle` already
 * apply from within their own sections' inline `isViewingToday` checks,
 * pulled out here once so the bar can decide it for whichever table the
 * tapped button ends up writing to, and so the rule is independently
 * testable without touching @powersync/react-native.
 */
export function resolveSchnellOccurredAt(
  tz: string,
  selectedLocalDate: string,
  todayLocalDate: string,
): ResolvedSchnellOccurredAt {
  return resolveLogOccurredAt(
    tz,
    selectedLocalDate === todayLocalDate
      ? undefined
      : { localDate: selectedLocalDate, time: SCHNELL_BACKFILL_TIME },
  );
}

/**
 * Double-tap guard: true when `nowUtcIso` falls within
 * `DOUBLE_TAP_WINDOW_SECONDS` of `lastTapUtcIso` for the SAME button — the
 * caller must then skip the write. `lastTapUtcIso` is `null` for a button's
 * first tap (this session, or since the last accepted tap), which is never a
 * double tap.
 */
export function isDoubleTap(lastTapUtcIso: string | null, nowUtcIso: string): boolean {
  if (!lastTapUtcIso) {
    return false;
  }
  return secondsBetween(lastTapUtcIso, nowUtcIso) < DOUBLE_TAP_WINDOW_SECONDS;
}

/** "Flasche 70 ml · 14:05" / "Flasche · 14:05" (kein Betrag) — the snackbar's label, and "<Medikamentenname> · 14:05" for a Gabe. */
export function formatSnackbarLabel(label: string, amountMl: number | null, timeLabel: string): string {
  const amountPart = amountMl !== null ? ` ${amountMl} ml` : '';
  return `${label}${amountPart} · ${timeLabel}`;
}
