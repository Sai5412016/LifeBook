/**
 * feeding/timer — pure logic for the breastfeeding timer: elapsed time,
 * multi-device conflict resolution, runaway detection, and display
 * formatting. Deliberately free of any Expo / React Native / PowerSync
 * import so it runs in plain Node under Vitest; the device- and
 * database-touching side lives in ./repository.
 *
 * All instants that come in are ISO-8601 UTC strings (Master-Spec §7) — this
 * module never constructs a `Date` of its own; every duration is computed via
 * `secondsBetween` from core/time, the single allowed place for time math.
 */

import { formatDuration, secondsBetween } from '@/core/time';
import {
  hasUnresolvedRunningConflict,
  isRunaway as isRunawayGeneric,
  resolveRunningConflicts as resolveRunningConflictsGeneric,
} from '@/core/tracking/running-conflicts';

import type { FeedSide, FeedType } from './types';

export { hasUnresolvedRunningConflict, formatDuration };

/** The subset of a feed row the timer math needs. */
export type FeedTimerState = {
  duration_left_s: number | null;
  duration_right_s: number | null;
  running_side: FeedSide | null;
  /** ISO-8601 UTC start of the current live segment; NULL while paused/stopped. */
  running_since: string | null;
};

export type ElapsedSeconds = { left: number; right: number };

/**
 * Elapsed seconds per side, live if a segment is currently running.
 *
 * The side named by `running_side` gets its stored total plus the seconds
 * since `running_since`; the other side is returned exactly as stored. When
 * nothing is running (`running_since` NULL), both sides are just their
 * stored totals — no live delta.
 */
export function elapsedSeconds(feed: FeedTimerState, nowUtcIso: string): ElapsedSeconds {
  const left = feed.duration_left_s ?? 0;
  const right = feed.duration_right_s ?? 0;

  if (!feed.running_since || !feed.running_side) {
    return { left, right };
  }

  const liveDelta = secondsBetween(feed.running_since, nowUtcIso);

  return feed.running_side === 'left' ? { left: left + liveDelta, right } : { left, right: right + liveDelta };
}

export type FeedConflictCandidate = FeedTimerState & {
  id: string;
  occurred_at: string;
};

/** A loser's finalized state — banked duration up to `jetzt`, ready to write. */
export type ResolvedLoser = {
  id: string;
  duration_left_s: number;
  duration_right_s: number;
  ended_at: string;
};

export type ConflictResolution = {
  /** id of the feed allowed to keep running, or null if `feeds` was empty. */
  winnerId: string | null;
  /** Every other feed, finalized (never deleted) and flagged for review by the caller. */
  losers: ResolvedLoser[];
};

/**
 * Picks which of several simultaneously "running" feeds for one child is
 * allowed to keep running, and finalizes the rest.
 *
 * The winner-picking rule itself (earliest `occurred_at`, tie-broken by the
 * lexicographically smaller `id` via plain string operators, never
 * `localeCompare` — see core/tracking/running-conflicts for why) is shared
 * by every tracking feature with this problem and lives there; this wrapper
 * only adds feeding's own consequence for a loser: bank its elapsed duration
 * per side up to `jetzt`, ready for the caller to write back alongside
 * `needs_review = 1`. Losers are never deleted — the row stays a flagged
 * event a parent can correct.
 */
export function resolveRunningConflicts(
  feeds: readonly FeedConflictCandidate[],
  jetzt: string,
): ConflictResolution {
  const { winnerId, loserIds } = resolveRunningConflictsGeneric(feeds);

  const losers = loserIds.map((id) => {
    const feed = feeds.find((candidate) => candidate.id === id)!;
    const elapsed = elapsedSeconds(feed, jetzt);
    return {
      id: feed.id,
      duration_left_s: elapsed.left,
      duration_right_s: elapsed.right,
      ended_at: jetzt,
    };
  });

  return { winnerId, losers };
}

/**
 * True when the CURRENT live segment (since `running_since`) has been
 * ticking for at least `thresholdHours` — the "parent forgot to stop the
 * timer" case. Measured from `running_since`, not the feed's total banked
 * duration: a long session built from several short, deliberately paused
 * segments is not a runaway, but one segment nobody stopped is.
 */
export function isRunaway(
  feed: Pick<FeedTimerState, 'running_since'>,
  jetzt: string,
  thresholdHours = 3,
): boolean {
  return isRunawayGeneric(feed.running_since, jetzt, thresholdHours);
}

/** "vor 2 h 15 min" — time since the last feed, in the same format as `formatDuration`. */
export function formatSinceLastFeed(letzteMahlzeitUtcIso: string, jetzt: string): string {
  return `vor ${formatDuration(secondsBetween(letzteMahlzeitUtcIso, jetzt))}`;
}

/**
 * Final `feed_type` for a breastfeed once it ends, from its finished
 * durations: both sides used → 'breast_both', otherwise whichever side has
 * time on it (a still-zero other side means it was never used).
 */
export function resolveBreastFeedType(durationLeftS: number, durationRightS: number): FeedType {
  if (durationLeftS > 0 && durationRightS > 0) {
    return 'breast_both';
  }
  return durationRightS > durationLeftS ? 'breast_right' : 'breast_left';
}

/**
 * Live "MM:SS" clock for a running segment, e.g. "04:32" — distinct from
 * `formatDuration`'s rounded-to-the-minute "18 min": a ticking countdown
 * needs the seconds, a finished feed's summary doesn't. Minutes are not
 * capped at 59 (a 2-hour segment reads "120:00"); the runaway warning is the
 * dedicated signal for "this has gone on too long", not the clock format.
 * Negative input floors to "00:00".
 */
export function formatClock(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** German label for a `feed_type`, e.g. "Stillen links" or "Fläschchen (Nahrung)". */
export function describeFeedType(feedType: FeedType): string {
  switch (feedType) {
    case 'breast_left':
      return 'Stillen links';
    case 'breast_right':
      return 'Stillen rechts';
    case 'breast_both':
      return 'Stillen beidseitig';
    case 'bottle_breastmilk':
      return 'Fläschchen (Muttermilch)';
    case 'bottle_formula':
      return 'Fläschchen (Nahrung)';
  }
}

/** The subset of a feed row `describeFeedAmount` needs. */
export type FeedAmountSummary = {
  feed_type: FeedType;
  duration_left_s: number | null;
  duration_right_s: number | null;
  amount_ml: number | null;
};

/**
 * Bare duration or amount, with no side label — "18 min" or "120 ml". Used
 * where the type is already named separately, e.g. the delete confirmation
 * ("Stillen links, 06:43, 3 min wirklich löschen?").
 */
export function describeFeedQuantity(feed: FeedAmountSummary): string {
  if (feed.feed_type === 'bottle_breastmilk' || feed.feed_type === 'bottle_formula') {
    return `${feed.amount_ml ?? 0} ml`;
  }
  return formatDuration((feed.duration_left_s ?? 0) + (feed.duration_right_s ?? 0));
}

/**
 * Human amount/duration summary for a feed — "links, 18 min", "beidseitig,
 * 25 min", or "120 ml" for a bottle. Shared by the "last feed" status line
 * and the day's feed list, so both read the same way.
 */
export function describeFeedAmount(feed: FeedAmountSummary): string {
  if (feed.feed_type === 'bottle_breastmilk' || feed.feed_type === 'bottle_formula') {
    return describeFeedQuantity(feed);
  }

  const sideLabel =
    feed.feed_type === 'breast_right' ? 'rechts' : feed.feed_type === 'breast_left' ? 'links' : 'beidseitig';
  return `${sideLabel}, ${describeFeedQuantity(feed)}`;
}
