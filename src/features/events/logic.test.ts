import { describe, expect, it } from 'vitest';

import {
  formatEventAgeLabel,
  formatEventTextPreview,
  formatShortGermanDate,
  normalizeEventNote,
  normalizeEventTitle,
  planEventPhotoOrder,
  sortEventsByOccurredAtDesc,
} from './logic';

const BERLIN = 'Europe/Berlin';

describe('sortEventsByOccurredAtDesc', () => {
  it('orders newest first', () => {
    const events = [
      { id: 'a', occurred_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', occurred_at: '2026-03-01T00:00:00.000Z' },
      { id: 'c', occurred_at: '2026-02-01T00:00:00.000Z' },
    ];
    expect(sortEventsByOccurredAtDesc(events).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on occurred_at by id, descending, so ordering is stable', () => {
    const events = [
      { id: 'aaa', occurred_at: '2026-01-01T00:00:00.000Z' },
      { id: 'bbb', occurred_at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(sortEventsByOccurredAtDesc(events).map((e) => e.id)).toEqual(['bbb', 'aaa']);
  });

  it('does not mutate the input array', () => {
    const events = [
      { id: 'a', occurred_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', occurred_at: '2026-02-01T00:00:00.000Z' },
    ];
    const copy = [...events];
    sortEventsByOccurredAtDesc(events);
    expect(events).toEqual(copy);
  });
});

describe('formatEventAgeLabel', () => {
  it('reuses the existing age label for a normal day', () => {
    expect(formatEventAgeLabel('2026-01-13T10:00:00.000Z', '2026-01-01T00:00:00.000Z', BERLIN)).toBe('Tag 12');
  });

  it('reuses the existing age label for the birth day itself', () => {
    expect(formatEventAgeLabel('2026-01-01T10:00:00.000Z', '2026-01-01T00:00:00.000Z', BERLIN)).toBe('Geburtstag');
  });
});

describe('formatShortGermanDate', () => {
  it('renders DD.MM.YYYY', () => {
    expect(formatShortGermanDate('2026-08-05')).toBe('05.08.2026');
  });
});

describe('formatEventTextPreview', () => {
  it('returns the whole note when it fits on one line', () => {
    expect(formatEventTextPreview('Erstes Lächeln heute Morgen')).toBe('Erstes Lächeln heute Morgen');
  });

  it('cuts off everything after the first line', () => {
    expect(formatEventTextPreview('Erste Zeile\nZweite Zeile, nie sichtbar')).toBe('Erste Zeile');
  });

  it('truncates a long first line with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const preview = formatEventTextPreview(long, 10);
    expect(preview).toBe(`${'x'.repeat(10)}…`);
  });

  it('returns an empty string for null', () => {
    expect(formatEventTextPreview(null)).toBe('');
  });

  it('returns an empty string for a note that is only whitespace on its first line', () => {
    expect(formatEventTextPreview('   \nrest')).toBe('');
  });
});

describe('normalizeEventTitle / normalizeEventNote', () => {
  it('trims a title', () => {
    expect(normalizeEventTitle('  Erste Schritte  ')).toBe('Erste Schritte');
  });

  it('turns a blank note into null', () => {
    expect(normalizeEventNote('   ')).toBeNull();
  });

  it('trims a note and keeps its content', () => {
    expect(normalizeEventNote('  Ganz allein gelaufen  ')).toBe('Ganz allein gelaufen');
  });
});

describe('planEventPhotoOrder', () => {
  it('makes the first selected photo the title image', () => {
    const plan = planEventPhotoOrder(['p2', 'p1', 'p3']);
    expect(plan.titlePhotoId).toBe('p2');
  });

  it('assigns sort_index in selection order, starting at 0', () => {
    const plan = planEventPhotoOrder(['p2', 'p1', 'p3']);
    expect(plan.photos).toEqual([
      { photoId: 'p2', sortIndex: 0 },
      { photoId: 'p1', sortIndex: 1 },
      { photoId: 'p3', sortIndex: 2 },
    ]);
  });

  it('has no title image when nothing is selected', () => {
    const plan = planEventPhotoOrder([]);
    expect(plan.titlePhotoId).toBeNull();
    expect(plan.photos).toEqual([]);
  });
});
