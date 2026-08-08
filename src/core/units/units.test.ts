import { describe, it, expect } from 'vitest';
import {
  mlToOz,
  ozToMl,
  gToKg,
  kgToG,
  gToLbOz,
  lbOzToG,
  mmToCm,
  cmToMm,
  mmToIn,
  inToMm,
  cToF,
  fToC,
  secondsToHms,
  formatDuration,
  ML_PER_OZ,
} from './index';

describe('volume ml <-> oz', () => {
  it('canonical is exact at one ounce', () => {
    expect(mlToOz(ML_PER_OZ)).toBe(1);
  });
  it('rounds to integer ml on input', () => {
    expect(ozToMl(1)).toBe(30); // 29.5735 → 30
    expect(ozToMl(4)).toBe(118); // 118.29 → 118
  });
  it('round-trips through display without drift into storage', () => {
    expect(ozToMl(mlToOz(100))).toBe(100);
  });
});

describe('weight g <-> kg / lb+oz', () => {
  it('kg conversions', () => {
    expect(kgToG(3.5)).toBe(3500);
    expect(gToKg(3500)).toBeCloseTo(3.5, 6);
  });
  it('grams to pounds+ounces', () => {
    const { lb, oz } = gToLbOz(1000);
    expect(lb).toBe(2);
    expect(oz).toBeCloseTo(3.2740, 3);
  });
  it('pounds+ounces to grams (rounded integer)', () => {
    expect(lbOzToG(0, 1)).toBe(28); // 28.349 → 28
    expect(lbOzToG(2, 3.274)).toBeCloseTo(1000, 0);
  });
});

describe('length mm <-> cm / in', () => {
  it('cm conversions', () => {
    expect(mmToCm(1234)).toBeCloseTo(123.4, 6);
    expect(cmToMm(12.34)).toBe(123); // 123.4 → 123
  });
  it('inch conversions', () => {
    expect(mmToIn(25.4)).toBeCloseTo(1, 6);
    expect(inToMm(1)).toBe(25); // 25.4 → 25
  });
});

describe('temperature c <-> f', () => {
  it('body temperature', () => {
    expect(cToF(37)).toBeCloseTo(98.6, 6);
    expect(fToC(98.6)).toBeCloseTo(37, 6);
  });
  it('freezing point', () => {
    expect(cToF(0)).toBe(32);
    expect(fToC(32)).toBe(0);
  });
});

describe('duration seconds', () => {
  it('splits into h/m/s', () => {
    expect(secondsToHms(3661)).toEqual({ h: 1, m: 1, s: 1 });
  });
  it('formats', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});
