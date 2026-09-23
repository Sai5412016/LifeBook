import { describe, expect, it } from 'vitest';

import { toLocalDate } from '@/core/time';

import {
  DEFAULT_BOTTLE_FEED_TYPE,
  DEFAULT_BREAST_FEED_TYPE,
  formatSnackbarLabel,
  isDoubleTap,
  letzterBrusttyp,
  letzterFlaschentyp,
  resolveSchnellOccurredAt,
} from './logic';

const TZ = 'Europe/Berlin';

describe('letzterFlaschentyp', () => {
  it('ermittelt die zuletzt benutzte Menge korrekt, auch wenn der letzte Eintrag insgesamt eine andere feed_type hatte', () => {
    const feeds = [
      { feed_type: 'bottle_formula' as const, amount_ml: 90, occurred_at: '2026-09-20T08:00:00.000Z', deleted_at: null },
      { feed_type: 'bottle_breastmilk' as const, amount_ml: 70, occurred_at: '2026-09-22T08:00:00.000Z', deleted_at: null },
      // Der insgesamt jüngste Eintrag ist eine Brust-Mahlzeit — darf die
      // Flaschen-Vorgabe nicht verfälschen.
      { feed_type: 'breast_left' as const, amount_ml: null, occurred_at: '2026-09-23T09:00:00.000Z', deleted_at: null },
    ];

    expect(letzterFlaschentyp(feeds)).toEqual({ feedType: 'bottle_breastmilk', amountMl: 70 });
  });

  it('kein früherer Flaschen-Eintrag vorhanden -> amount_ml ist null, kein Absturz', () => {
    expect(letzterFlaschentyp([])).toEqual({ feedType: DEFAULT_BOTTLE_FEED_TYPE, amountMl: null });

    const nurBrust = [
      { feed_type: 'breast_left' as const, amount_ml: null, occurred_at: '2026-09-23T09:00:00.000Z', deleted_at: null },
    ];
    expect(letzterFlaschentyp(nurBrust)).toEqual({ feedType: DEFAULT_BOTTLE_FEED_TYPE, amountMl: null });
  });

  it('ignoriert weich gelöschte Einträge', () => {
    const feeds = [
      { feed_type: 'bottle_formula' as const, amount_ml: 120, occurred_at: '2026-09-23T09:00:00.000Z', deleted_at: '2026-09-23T09:05:00.000Z' },
      { feed_type: 'bottle_breastmilk' as const, amount_ml: 60, occurred_at: '2026-09-22T09:00:00.000Z', deleted_at: null },
    ];
    expect(letzterFlaschentyp(feeds)).toEqual({ feedType: 'bottle_breastmilk', amountMl: 60 });
  });
});

describe('letzterBrusttyp', () => {
  it('liefert den zuletzt benutzten Brust-Typ', () => {
    const feeds = [
      { feed_type: 'breast_left' as const, occurred_at: '2026-09-20T08:00:00.000Z', deleted_at: null },
      { feed_type: 'breast_right' as const, occurred_at: '2026-09-22T08:00:00.000Z', deleted_at: null },
      { feed_type: 'bottle_formula' as const, occurred_at: '2026-09-23T09:00:00.000Z', deleted_at: null },
    ];
    expect(letzterBrusttyp(feeds)).toBe('breast_right');
  });

  it('kein früherer Brust-Eintrag vorhanden -> Standardwert, kein Absturz', () => {
    expect(letzterBrusttyp([])).toBe(DEFAULT_BREAST_FEED_TYPE);
  });
});

describe('resolveSchnellOccurredAt', () => {
  it('gewählter Tag ist nicht heute -> occurred_at liegt auf dem gewählten Tag (12:00)', () => {
    const resolved = resolveSchnellOccurredAt(TZ, '2026-09-21', '2026-09-23');
    expect(resolved.localDate).toBe('2026-09-21');
    expect(resolved.occurredAtUtcIso).toBe('2026-09-21T10:00:00.000Z');
  });

  it('gewählter Tag ist heute -> occurred_at ist die aktuelle Zeit, nicht 12:00', () => {
    const before = Date.now();
    const resolved = resolveSchnellOccurredAt(TZ, '2026-09-23', '2026-09-23');
    const after = Date.now();

    const resolvedMillis = new Date(resolved.occurredAtUtcIso).getTime();
    expect(resolvedMillis).toBeGreaterThanOrEqual(before);
    expect(resolvedMillis).toBeLessThanOrEqual(after);
  });

  it('local_date passt in allen Fällen zu occurred_at und tz', () => {
    const backdated = resolveSchnellOccurredAt(TZ, '2026-09-21', '2026-09-23');
    expect(backdated.localDate).toBe(toLocalDate(backdated.occurredAtUtcIso, TZ));

    const today = resolveSchnellOccurredAt(TZ, '2026-09-23', '2026-09-23');
    expect(today.localDate).toBe(toLocalDate(today.occurredAtUtcIso, TZ));
  });
});

describe('isDoubleTap', () => {
  it('Doppel-Tipp innerhalb von 2 Sekunden erzeugt einen Eintrag (der zweite Tipp wird verworfen)', () => {
    const writes: string[] = [];
    let lastTap: string | null = null;

    const tap = (nowUtcIso: string) => {
      if (isDoubleTap(lastTap, nowUtcIso)) {
        return;
      }
      lastTap = nowUtcIso;
      writes.push(nowUtcIso);
    };

    tap('2026-09-23T03:00:00.000Z');
    tap('2026-09-23T03:00:01.000Z'); // 1s später — verworfen

    expect(writes).toHaveLength(1);
  });

  it('kein vorheriger Tipp -> kein Doppel-Tipp', () => {
    expect(isDoubleTap(null, '2026-09-23T03:00:00.000Z')).toBe(false);
  });

  it('mehr als 2 Sekunden Abstand -> kein Doppel-Tipp, ein zweiter Eintrag ist erlaubt', () => {
    expect(isDoubleTap('2026-09-23T03:00:00.000Z', '2026-09-23T03:00:02.000Z')).toBe(false);
  });

  it('genau am Rand (unter 2 Sekunden) -> Doppel-Tipp', () => {
    expect(isDoubleTap('2026-09-23T03:00:00.000Z', '2026-09-23T03:00:01.999Z')).toBe(true);
  });
});

describe('formatSnackbarLabel', () => {
  it('mit Menge', () => {
    expect(formatSnackbarLabel('Flasche', 70, '14:05')).toBe('Flasche 70 ml · 14:05');
  });

  it('ohne Menge — nicht "Flasche null ml"', () => {
    expect(formatSnackbarLabel('Flasche', null, '14:05')).toBe('Flasche · 14:05');
  });
});
