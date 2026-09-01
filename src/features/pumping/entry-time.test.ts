import { describe, expect, it } from 'vitest';

import { addDaysToLocalDate, combineLocalDateAndTime, toLocalDate } from '@/core/time';

import { isBackdatedToYesterday } from './entry-time';

describe('isBackdatedToYesterday', () => {
  it('00:20 aktuell, 23:40 eingestellt -> Vortag', () => {
    expect(isBackdatedToYesterday('23:40', '00:20')).toBe(true);
  });

  it('00:20 aktuell, 00:10 eingestellt -> laufender Tag', () => {
    expect(isBackdatedToYesterday('00:10', '00:20')).toBe(false);
  });

  it('03:00 aktuell, 02:30 eingestellt -> laufender Tag (bestehendes Kriterium 3)', () => {
    expect(isBackdatedToYesterday('02:30', '03:00')).toBe(false);
  });

  it('23:50 aktuell, 23:55 eingestellt -> Vortag (Grenzfall kurz vor Mitternacht)', () => {
    expect(isBackdatedToYesterday('23:55', '23:50')).toBe(true);
  });

  it('eingestellte Zeit gleich der aktuellen Zeit -> laufender Tag, nicht "später"', () => {
    expect(isBackdatedToYesterday('12:00', '12:00')).toBe(false);
  });

  it('eine kaputte Uhrzeit datiert nie um, statt zu raten', () => {
    expect(isBackdatedToYesterday('', '12:00')).toBe(false);
    expect(isBackdatedToYesterday('12:00', '')).toBe(false);
    expect(isBackdatedToYesterday('25:00', '12:00')).toBe(false);
    expect(isBackdatedToYesterday('9:00', '12:00')).toBe(false);
  });
});

describe('Nachtrag über Mitternacht — Zusammenspiel mit core/time', () => {
  const tz = 'Europe/Berlin';

  it('00:20 aktuell, 23:40 eingestellt: occurred_at liegt in der Vergangenheit, auf dem Vortag', () => {
    const now = '2026-08-25T22:20:00.000Z'; // 00:20 Uhr Berlin (CEST, UTC+2) am 26.08.
    const nowLocalDate = toLocalDate(now, tz);
    expect(nowLocalDate).toBe('2026-08-26');

    const entered = '23:40';
    const backdated = isBackdatedToYesterday(entered, '00:20');
    expect(backdated).toBe(true);

    const targetLocalDate = backdated ? addDaysToLocalDate(nowLocalDate, -1) : nowLocalDate;
    expect(targetLocalDate).toBe('2026-08-25');

    const occurredAt = combineLocalDateAndTime(targetLocalDate, entered, tz);
    expect(occurredAt).not.toBeNull();
    expect(new Date(occurredAt!).getTime()).toBeLessThan(new Date(now).getTime());
    expect(toLocalDate(occurredAt!, tz)).toBe('2026-08-25');
  });

  it('bleibt auf ihrem eigenen Tag über die Sommerzeit-Wechselnacht hinweg (25./26.10.2026, Europe/Berlin stellt zurück)', () => {
    // 00:20 Uhr am 26.10. (nach der Umstellung, CET/UTC+1), Nachtrag 23:40
    // vom 25.10. (vor der Umstellung, noch CEST/UTC+2) — die Tagesarithmetik
    // ist reine Kalenderrechnung und darf den Stundenwechsel nicht bemerken.
    const now = '2026-10-25T23:20:00.000Z'; // 00:20 Uhr Berlin (CET) am 26.10.
    const nowLocalDate = toLocalDate(now, tz);
    expect(nowLocalDate).toBe('2026-10-26');

    const entered = '23:40';
    const backdated = isBackdatedToYesterday(entered, '00:20');
    expect(backdated).toBe(true);

    const targetLocalDate = addDaysToLocalDate(nowLocalDate, -1);
    expect(targetLocalDate).toBe('2026-10-25');

    const occurredAt = combineLocalDateAndTime(targetLocalDate, entered, tz);
    expect(occurredAt).not.toBeNull();
    // Die Umstellung liegt am 25.10. bereits um 03:00 CEST -> 02:00 CET
    // hinter uns, 23:40 Uhr abends ist also schon CET (UTC+1) -> 22:40 UTC.
    expect(occurredAt).toBe('2026-10-25T22:40:00.000Z');
    expect(toLocalDate(occurredAt!, tz)).toBe('2026-10-25');
    expect(new Date(occurredAt!).getTime()).toBeLessThan(new Date(now).getTime());
  });

  it('03:00 aktuell, 02:30 eingestellt bleibt auf dem laufenden Tag, auch direkt in der Nacht', () => {
    const now = '2026-08-25T01:00:00.000Z'; // 03:00 Uhr Berlin am 25.08.
    const nowLocalDate = toLocalDate(now, tz);
    expect(nowLocalDate).toBe('2026-08-25');

    const backdated = isBackdatedToYesterday('02:30', '03:00');
    expect(backdated).toBe(false);

    const occurredAt = combineLocalDateAndTime(nowLocalDate, '02:30', tz);
    expect(toLocalDate(occurredAt!, tz)).toBe('2026-08-25');
  });
});
