import { describe, expect, it } from 'vitest';

import {
  hasUnresolvedRunningConflict,
  isRunaway,
  resolveRunningConflicts,
  type RunningConflictCandidate,
} from './running-conflicts';

const candidate = (id: string, occurred_at: string): RunningConflictCandidate => ({ id, occurred_at });

describe('resolveRunningConflicts', () => {
  it('reports no winner and no losers for an empty list', () => {
    expect(resolveRunningConflicts([])).toEqual({ winnerId: null, loserIds: [] });
  });

  it('the only running row wins outright, no losers', () => {
    const result = resolveRunningConflicts([candidate('a', '2026-08-08T10:00:00Z')]);
    expect(result).toEqual({ winnerId: 'a', loserIds: [] });
  });

  it('picks the earliest occurred_at as winner', () => {
    const result = resolveRunningConflicts([
      candidate('b', '2026-08-08T11:00:00Z'),
      candidate('a', '2026-08-08T09:00:00Z'),
    ]);
    expect(result).toEqual({ winnerId: 'a', loserIds: ['b'] });
  });

  it('breaks a tie in occurred_at by the lexicographically smaller id, regardless of input order', () => {
    const sameTime = '2026-08-08T10:00:00Z';
    expect(resolveRunningConflicts([candidate('bbb', sameTime), candidate('aaa', sameTime)]).winnerId).toBe(
      'aaa',
    );
    expect(resolveRunningConflicts([candidate('aaa', sameTime), candidate('bbb', sameTime)]).winnerId).toBe(
      'aaa',
    );
  });

  it('every candidate but the winner appears in loserIds, however many there are', () => {
    const result = resolveRunningConflicts([
      candidate('c', '2026-08-08T12:00:00Z'),
      candidate('a', '2026-08-08T09:00:00Z'),
      candidate('b', '2026-08-08T11:00:00Z'),
    ]);
    expect(result.winnerId).toBe('a');
    expect(result.loserIds.sort()).toEqual(['b', 'c']);
  });

  it('ignores an is_running field on the candidate — it is documentation only, not part of the algorithm', () => {
    const result = resolveRunningConflicts([
      { id: 'a', occurred_at: '2026-08-08T09:00:00Z', is_running: 1 },
      { id: 'b', occurred_at: '2026-08-08T10:00:00Z', is_running: 1 },
    ]);
    expect(result.winnerId).toBe('a');
  });
});

describe('hasUnresolvedRunningConflict', () => {
  it('is false for no running rows — an already-resolved state must never trigger a write', () => {
    expect(hasUnresolvedRunningConflict([])).toBe(false);
  });

  it('is false for exactly one running row — also already resolved, no write', () => {
    expect(hasUnresolvedRunningConflict([candidate('a', '2026-08-08T10:00:00Z')])).toBe(false);
  });

  it('is true for two or more running rows — a write is needed', () => {
    expect(
      hasUnresolvedRunningConflict([
        candidate('a', '2026-08-08T10:00:00Z'),
        candidate('b', '2026-08-08T11:00:00Z'),
      ]),
    ).toBe(true);
  });
});

describe('isRunaway', () => {
  it('is false when nothing is running', () => {
    expect(isRunaway(null, '2026-08-08T12:00:00Z', 3)).toBe(false);
  });

  it('is false just under the threshold', () => {
    expect(isRunaway('2026-08-08T09:00:01Z', '2026-08-08T12:00:00Z', 3)).toBe(false);
  });

  it('is true exactly at the threshold (inclusive)', () => {
    expect(isRunaway('2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z', 3)).toBe(true);
  });

  it('is true well past the threshold', () => {
    expect(isRunaway('2026-08-08T06:00:00Z', '2026-08-08T12:00:00Z', 3)).toBe(true);
  });

  it('honours a 12-hour threshold, the one sleep uses', () => {
    const since = '2026-08-08T00:00:00Z';
    expect(isRunaway(since, '2026-08-08T11:59:59Z', 12)).toBe(false);
    expect(isRunaway(since, '2026-08-08T12:00:00Z', 12)).toBe(true);
  });
});
