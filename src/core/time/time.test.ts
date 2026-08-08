import { describe, it, expect } from 'vitest';
import { toLocalDate, toDashboardDate, ageInDays } from './index';

const BERLIN = 'Europe/Berlin';

describe('toLocalDate (DST-safe local calendar date)', () => {
  it('summer (+02:00): 22:30Z rolls into next local day', () => {
    expect(toLocalDate('2026-08-08T22:30:00Z', BERLIN)).toBe('2026-08-09');
  });
  it('summer: 21:59Z is still the same local day', () => {
    expect(toLocalDate('2026-08-08T21:59:00Z', BERLIN)).toBe('2026-08-08');
  });
  it('winter (+01:00): 23:30Z rolls into next local day', () => {
    expect(toLocalDate('2026-01-15T23:30:00Z', BERLIN)).toBe('2026-01-16');
  });
});

describe('toDashboardDate (06:00 local day boundary)', () => {
  it('02:30 local belongs to the previous day', () => {
    // Berlin summer 02:30 on Aug 9 == 00:30Z
    expect(toDashboardDate('2026-08-09T00:30:00Z', BERLIN)).toBe('2026-08-08');
  });
  it('exactly 06:00 local belongs to the same day', () => {
    // Berlin summer 06:00 on Aug 9 == 04:00Z
    expect(toDashboardDate('2026-08-09T04:00:00Z', BERLIN)).toBe('2026-08-09');
  });
  it('05:59 local still belongs to the previous day', () => {
    // Berlin summer 05:59 on Aug 9 == 03:59Z
    expect(toDashboardDate('2026-08-09T03:59:00Z', BERLIN)).toBe('2026-08-08');
  });
});

describe('ageInDays', () => {
  it('is 0 on the birth day', () => {
    expect(ageInDays('2026-08-08T20:00:00Z', '2026-08-08T09:00:00Z', BERLIN)).toBe(0);
  });
  it('counts whole days', () => {
    expect(ageInDays('2026-08-10T09:00:00Z', '2026-08-08T09:00:00Z', BERLIN)).toBe(2);
  });
  it('stays correct across the spring DST transition (2026-03-29)', () => {
    expect(ageInDays('2026-03-30T12:00:00Z', '2026-03-28T12:00:00Z', BERLIN)).toBe(2);
  });
});
