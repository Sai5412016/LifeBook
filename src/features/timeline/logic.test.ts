import { describe, expect, it } from 'vitest';

import { buildDayTimeline, formatEmptyDayLabel } from './logic';

const JETZT = '2026-09-23T12:00:00.000Z';

describe('buildDayTimeline', () => {
  it('merges feeds, diapers and medications into one ascending list', () => {
    const result = buildDayTimeline(
      {
        feeds: [
          {
            id: 'feed-1',
            occurred_at: '2026-09-23T09:00:00.000Z',
            deleted_at: null,
            needs_review: 0,
            feed_type: 'bottle_formula',
            amount_ml: 75,
            duration_left_s: null,
            duration_right_s: null,
          },
        ],
        diapers: [
          { id: 'diaper-1', occurred_at: '2026-09-23T10:30:00.000Z', deleted_at: null, kind: 'dirty' },
        ],
        medications: [
          {
            id: 'med-1',
            occurred_at: '2026-09-23T09:05:00.000Z',
            deleted_at: null,
            name: 'Vitamin D3',
            dose_amount: 400,
            dose_unit: 'ie',
          },
        ],
      },
      JETZT,
    );

    expect(result.map((entry) => entry.id)).toEqual(['feed-1', 'med-1', 'diaper-1']);
    expect(result[0]).toMatchObject({ kind: 'feed', label: 'Fläschchen (Nahrung)', valueLabel: '75 ml' });
    expect(result[1]).toMatchObject({ kind: 'medication', label: 'Vitamin D3', valueLabel: '400 IE' });
    expect(result[2]).toMatchObject({ kind: 'diaper', label: 'Windel Stuhl', valueLabel: '' });
  });

  it('excludes soft-deleted rows from every source', () => {
    const result = buildDayTimeline(
      {
        diapers: [{ id: 'diaper-1', occurred_at: '2026-09-23T10:00:00.000Z', deleted_at: '2026-09-23T10:01:00.000Z', kind: 'wet' }],
      },
      JETZT,
    );

    expect(result).toHaveLength(0);
  });

  it('marks needs_review through from feeds/sleeps/pumping, never from diapers/medications', () => {
    const result = buildDayTimeline(
      {
        feeds: [
          {
            id: 'feed-1',
            occurred_at: '2026-09-23T09:00:00.000Z',
            deleted_at: null,
            needs_review: 1,
            feed_type: 'bottle_formula',
            amount_ml: null,
            duration_left_s: null,
            duration_right_s: null,
          },
        ],
        diapers: [{ id: 'diaper-1', occurred_at: '2026-09-23T10:00:00.000Z', deleted_at: null, kind: 'wet' }],
      },
      JETZT,
    );

    expect(result.find((entry) => entry.kind === 'feed')?.needsReview).toBe(true);
    expect(result.find((entry) => entry.kind === 'diaper')?.needsReview).toBe(false);
  });

  it('shows "läuft" for a sleep still running, a fixed duration for one that ended', () => {
    const result = buildDayTimeline(
      {
        sleeps: [
          { id: 'running', occurred_at: '2026-09-23T11:00:00.000Z', deleted_at: null, ended_at: null, needs_review: 0 },
          {
            id: 'finished',
            occurred_at: '2026-09-23T07:00:00.000Z',
            deleted_at: null,
            ended_at: '2026-09-23T07:30:00.000Z',
            needs_review: 0,
          },
        ],
      },
      JETZT,
    );

    expect(result.find((entry) => entry.id === 'running')?.valueLabel).toBe('läuft');
    expect(result.find((entry) => entry.id === 'finished')?.valueLabel).toBe('30 min');
  });

  it('returns an empty list when nothing is passed at all', () => {
    expect(buildDayTimeline({}, JETZT)).toEqual([]);
  });
});

describe('formatEmptyDayLabel', () => {
  it('plain empty-day message', () => {
    expect(formatEmptyDayLabel(false)).toBe('Für diesen Tag ist nichts eingetragen.');
  });

  it('adds "vor der Geburt" for a day before the child was born', () => {
    expect(formatEmptyDayLabel(true)).toBe('Für diesen Tag ist nichts eingetragen — vor der Geburt.');
  });
});
