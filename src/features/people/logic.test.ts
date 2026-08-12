import { describe, expect, it } from 'vitest';

import { ROLE_OPTIONS, describeRole, formatPeriodLabel, initialsForName, sortPeople } from './logic';

describe('describeRole', () => {
  it('labels every role in German', () => {
    expect(describeRole('midwife')).toBe('Hebamme');
    expect(describeRole('doctor')).toBe('Ärztin/Arzt');
    expect(describeRole('nurse')).toBe('Pflegekraft');
    expect(describeRole('family')).toBe('Familie');
    expect(describeRole('godparent')).toBe('Patin/Pate');
    expect(describeRole('other')).toBe('Sonstige');
  });

  it('ROLE_OPTIONS covers exactly the roles describeRole understands', () => {
    expect(ROLE_OPTIONS.map((option) => option.value)).toEqual([
      'midwife',
      'doctor',
      'nurse',
      'family',
      'godparent',
      'other',
    ]);
  });
});

describe('initialsForName', () => {
  it('takes the first two letters of a single name', () => {
    expect(initialsForName('Maria')).toBe('MA');
  });

  it('takes first-letter-of-first and first-letter-of-last for multiple names', () => {
    expect(initialsForName('Anna Schmidt')).toBe('AS');
    expect(initialsForName('Anna Maria Schmidt')).toBe('AS');
  });

  it('is empty for a blank name', () => {
    expect(initialsForName('   ')).toBe('');
  });

  it('collapses extra whitespace between names', () => {
    expect(initialsForName('  Anna   Schmidt  ')).toBe('AS');
  });
});

describe('sortPeople', () => {
  it('orders by sort_index ascending', () => {
    const people = [
      { id: 'b', sort_index: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: 'a', sort_index: 1, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(sortPeople(people).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('falls back to created_at when sort_index ties', () => {
    const people = [
      { id: 'later', sort_index: 0, created_at: '2026-02-01T00:00:00Z' },
      { id: 'earlier', sort_index: 0, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(sortPeople(people).map((p) => p.id)).toEqual(['earlier', 'later']);
  });

  it('does not mutate the input array', () => {
    const people = [
      { id: 'b', sort_index: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: 'a', sort_index: 1, created_at: '2026-01-01T00:00:00Z' },
    ];
    const original = [...people];
    sortPeople(people);
    expect(people).toEqual(original);
  });
});

describe('formatPeriodLabel', () => {
  it('formats a full range', () => {
    expect(formatPeriodLabel('2026-03-05', '2026-07-20')).toBe('05.03.2026 – 20.07.2026');
  });

  it('formats an open start only as "seit"', () => {
    expect(formatPeriodLabel('2026-03-05', null)).toBe('seit 05.03.2026');
  });

  it('formats an open end only as "bis"', () => {
    expect(formatPeriodLabel(null, '2026-07-20')).toBe('bis 20.07.2026');
  });

  it('is null when neither end is set', () => {
    expect(formatPeriodLabel(null, null)).toBeNull();
  });
});
