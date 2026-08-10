import { describe, expect, it } from 'vitest';

import {
  elapsedSeconds,
  formatDuration,
  formatSinceLastFeed,
  isRunaway,
  resolveBreastFeedType,
  resolveRunningConflicts,
  type FeedConflictCandidate,
} from './timer';

describe('elapsedSeconds', () => {
  it('returns the stored totals unchanged when nothing is running', () => {
    const feed = {
      duration_left_s: 120,
      duration_right_s: 300,
      running_side: null,
      running_since: null,
    };
    expect(elapsedSeconds(feed, '2026-08-08T12:00:00Z')).toEqual({ left: 120, right: 300 });
  });

  it('treats null stored durations as 0 for a never-started feed', () => {
    const feed = {
      duration_left_s: null,
      duration_right_s: null,
      running_side: null,
      running_since: null,
    };
    expect(elapsedSeconds(feed, '2026-08-08T12:00:00Z')).toEqual({ left: 0, right: 0 });
  });

  it('adds the live delta to the running side only', () => {
    const feed = {
      duration_left_s: 60,
      duration_right_s: 300,
      running_side: 'left' as const,
      running_since: '2026-08-08T12:00:00Z',
    };
    expect(elapsedSeconds(feed, '2026-08-08T12:02:00Z')).toEqual({ left: 180, right: 300 });
  });

  it('adds the live delta to the right side when that is the running one', () => {
    const feed = {
      duration_left_s: 60,
      duration_right_s: 0,
      running_side: 'right' as const,
      running_since: '2026-08-08T12:00:00Z',
    };
    expect(elapsedSeconds(feed, '2026-08-08T12:01:30Z')).toEqual({ left: 60, right: 90 });
  });

  it('applies a negative delta as-is when `jetzt` is before `running_since` (clock skew)', () => {
    const feed = {
      duration_left_s: 60,
      duration_right_s: 0,
      running_side: 'left' as const,
      running_since: '2026-08-08T12:00:10Z',
    };
    expect(elapsedSeconds(feed, '2026-08-08T12:00:00Z')).toEqual({ left: 50, right: 0 });
  });

  it('is unaffected by a DST transition between running_since and jetzt', () => {
    const feed = {
      duration_left_s: 0,
      duration_right_s: 0,
      running_side: 'left' as const,
      running_since: '2026-03-29T00:00:00Z',
    };
    // Europe/Berlin springs forward inside this window; both inputs are UTC.
    expect(elapsedSeconds(feed, '2026-03-29T02:00:00Z')).toEqual({ left: 7200, right: 0 });
  });
});

describe('resolveRunningConflicts', () => {
  const candidate = (
    id: string,
    occurred_at: string,
    overrides: Partial<FeedConflictCandidate> = {},
  ): FeedConflictCandidate => ({
    id,
    occurred_at,
    duration_left_s: 0,
    duration_right_s: 0,
    running_side: 'left',
    running_since: occurred_at,
    ...overrides,
  });

  it('reports no winner and no losers for an empty list', () => {
    expect(resolveRunningConflicts([], '2026-08-08T12:00:00Z')).toEqual({
      winnerId: null,
      losers: [],
    });
  });

  it('the only running feed wins outright, no losers', () => {
    const feeds = [candidate('a', '2026-08-08T10:00:00Z')];
    const result = resolveRunningConflicts(feeds, '2026-08-08T12:00:00Z');
    expect(result.winnerId).toBe('a');
    expect(result.losers).toEqual([]);
  });

  it('picks the earliest occurred_at as winner', () => {
    const feeds = [candidate('b', '2026-08-08T11:00:00Z'), candidate('a', '2026-08-08T09:00:00Z')];
    const result = resolveRunningConflicts(feeds, '2026-08-08T12:00:00Z');
    expect(result.winnerId).toBe('a');
    expect(result.losers.map((l) => l.id)).toEqual(['b']);
  });

  it('breaks a tie in occurred_at by the lexicographically smaller id, regardless of input order', () => {
    const sameTime = '2026-08-08T10:00:00Z';
    const feedsAscending = [candidate('bbb', sameTime), candidate('aaa', sameTime)];
    const feedsDescending = [candidate('aaa', sameTime), candidate('bbb', sameTime)];

    expect(resolveRunningConflicts(feedsAscending, '2026-08-08T12:00:00Z').winnerId).toBe('aaa');
    expect(resolveRunningConflicts(feedsDescending, '2026-08-08T12:00:00Z').winnerId).toBe('aaa');
  });

  it('finalizes losers with their elapsed duration banked, never deleting them', () => {
    const feeds = [
      candidate('winner', '2026-08-08T09:00:00Z'),
      candidate('loser', '2026-08-08T10:00:00Z', {
        duration_left_s: 30,
        running_side: 'left',
        running_since: '2026-08-08T10:00:00Z',
      }),
    ];
    const result = resolveRunningConflicts(feeds, '2026-08-08T10:05:00Z');

    expect(result.losers).toEqual([
      { id: 'loser', duration_left_s: 330, duration_right_s: 0, ended_at: '2026-08-08T10:05:00Z' },
    ]);
  });

  it('every candidate but the winner appears in losers, however many there are', () => {
    const feeds = [
      candidate('c', '2026-08-08T12:00:00Z'),
      candidate('a', '2026-08-08T09:00:00Z'),
      candidate('b', '2026-08-08T11:00:00Z'),
    ];
    const result = resolveRunningConflicts(feeds, '2026-08-08T13:00:00Z');
    expect(result.winnerId).toBe('a');
    expect(result.losers.map((l) => l.id).sort()).toEqual(['b', 'c']);
  });
});

describe('isRunaway', () => {
  it('is false when nothing is running', () => {
    expect(isRunaway({ running_since: null }, '2026-08-08T12:00:00Z')).toBe(false);
  });

  it('is false just under the default 3-hour threshold', () => {
    const feed = { running_since: '2026-08-08T09:00:01Z' };
    expect(isRunaway(feed, '2026-08-08T12:00:00Z')).toBe(false);
  });

  it('is true exactly at the threshold (inclusive)', () => {
    const feed = { running_since: '2026-08-08T09:00:00Z' };
    expect(isRunaway(feed, '2026-08-08T12:00:00Z')).toBe(true);
  });

  it('is true well past the threshold', () => {
    const feed = { running_since: '2026-08-08T06:00:00Z' };
    expect(isRunaway(feed, '2026-08-08T12:00:00Z')).toBe(true);
  });

  it('honours a custom threshold', () => {
    const feed = { running_since: '2026-08-08T11:00:00Z' };
    expect(isRunaway(feed, '2026-08-08T12:00:00Z', 0.5)).toBe(true);
    expect(isRunaway(feed, '2026-08-08T12:00:00Z', 2)).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [1080, '18 min'],
    [3540, '59 min'],
    [3600, '1 h 00 min'],
    [3900, '1 h 05 min'],
    [7325, '2 h 02 min'],
  ])('formats %i seconds as "%s"', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('floors a negative duration to "0 min" instead of showing a negative time', () => {
    expect(formatDuration(-90)).toBe('0 min');
  });

  it('rounds to the nearest minute', () => {
    expect(formatDuration(89)).toBe('1 min'); // 1.48 min
    expect(formatDuration(91)).toBe('2 min'); // 1.52 min
  });
});

describe('formatSinceLastFeed', () => {
  it('formats a multi-hour gap', () => {
    expect(formatSinceLastFeed('2026-08-08T09:45:00Z', '2026-08-08T12:00:00Z')).toBe(
      'vor 2 h 15 min',
    );
  });

  it('formats a short gap', () => {
    expect(formatSinceLastFeed('2026-08-08T11:55:00Z', '2026-08-08T12:00:00Z')).toBe('vor 5 min');
  });

  it('never shows negative time for a last-feed timestamp in the future', () => {
    expect(formatSinceLastFeed('2026-08-08T12:05:00Z', '2026-08-08T12:00:00Z')).toBe('vor 0 min');
  });
});

describe('resolveBreastFeedType', () => {
  it('reports breast_left when only the left side has time', () => {
    expect(resolveBreastFeedType(120, 0)).toBe('breast_left');
  });

  it('reports breast_right when only the right side has time', () => {
    expect(resolveBreastFeedType(0, 90)).toBe('breast_right');
  });

  it('reports breast_both when both sides were used', () => {
    expect(resolveBreastFeedType(60, 60)).toBe('breast_both');
  });

  it('falls back to breast_left when both sides are still zero', () => {
    expect(resolveBreastFeedType(0, 0)).toBe('breast_left');
  });
});
