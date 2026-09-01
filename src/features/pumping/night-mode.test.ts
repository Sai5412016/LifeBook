import { describe, expect, it } from 'vitest';

import {
  isNightTime,
  NIGHT_MAX_BRIGHTNESS,
  NIGHT_PALETTE,
  type PumpingPalette,
} from './night-mode';

describe('isNightTime', () => {
  it.each(['22:00', '22:01', '23:59', '00:00', '02:30', '03:00', '05:59'])(
    'ist Nacht um %s',
    (time) => {
      expect(isNightTime(time)).toBe(true);
    },
  );

  it.each(['06:00', '06:01', '09:00', '12:00', '18:00', '21:59'])('ist Tag um %s', (time) => {
    expect(isNightTime(time)).toBe(false);
  });

  it('schaltet exakt um 22:00 um, nicht um 21:59', () => {
    expect(isNightTime('21:59')).toBe(false);
    expect(isNightTime('22:00')).toBe(true);
  });

  it('endet exakt um 06:00 — 05:59 ist noch Nacht', () => {
    expect(isNightTime('05:59')).toBe(true);
    expect(isNightTime('06:00')).toBe(false);
  });

  it('behandelt eine kaputte Uhrzeit als Tag, statt den Bildschirm zu verdunkeln', () => {
    for (const broken of ['', 'abc', '3:00', '25:00', '22:60', '2200']) {
      expect(isNightTime(broken)).toBe(false);
    }
  });
});

describe('NIGHT_PALETTE', () => {
  const brightness = (hex: string): number => {
    const match = hex.match(/^#([0-9a-fA-F]{6})$/);
    if (!match) {
      throw new Error(`kein 6-stelliger Hexwert: ${hex}`);
    }
    const value = match[1];
    return Math.max(
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    );
  };

  it('enthält nichts, was heller als 80 % Weiss ist', () => {
    const limit = brightness(NIGHT_MAX_BRIGHTNESS);
    expect(limit).toBe(204); // 0.8 * 255
    for (const [name, color] of Object.entries(NIGHT_PALETTE) as [keyof PumpingPalette, string][]) {
      expect(brightness(color), `${name} ist zu hell`).toBeLessThanOrEqual(limit);
    }
  });

  it('hat keine hellen Flächen: Grund und Flächen bleiben deutlich dunkel', () => {
    expect(brightness(NIGHT_PALETTE.background)).toBeLessThanOrEqual(40);
    expect(brightness(NIGHT_PALETTE.surface)).toBeLessThanOrEqual(60);
  });

  it('führt keinen Rotton — dieser Tab bewertet die Menge nie', () => {
    for (const color of Object.values(NIGHT_PALETTE)) {
      const red = parseInt(color.slice(1, 3), 16);
      const green = parseInt(color.slice(3, 5), 16);
      const blue = parseInt(color.slice(5, 7), 16);
      expect(red - Math.max(green, blue), `${color} sticht rot heraus`).toBeLessThanOrEqual(8);
    }
  });
});
