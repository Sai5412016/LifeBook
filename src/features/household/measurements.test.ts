import { describe, expect, it } from 'vitest';

import {
  cmToMm,
  formatHeadCircumferenceCm,
  formatLengthCm,
  formatWeightKg,
  gramsToKgInput,
  kgToGrams,
  mmToCmInput,
  parseDecimalInput,
} from './measurements';

describe('parseDecimalInput', () => {
  it('parses a period decimal', () => {
    expect(parseDecimalInput('3.4')).toBe(3.4);
  });

  it('parses a German comma decimal', () => {
    expect(parseDecimalInput('3,4')).toBe(3.4);
  });

  it('parses a whole number', () => {
    expect(parseDecimalInput('51')).toBe(51);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDecimalInput('  3,4  ')).toBe(3.4);
  });

  it('returns null for an empty field — blank stays blank, not zero', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('   ')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseDecimalInput('abc')).toBeNull();
  });
});

describe('kgToGrams', () => {
  it('converts and rounds to the nearest gram', () => {
    expect(kgToGrams(3.4)).toBe(3400);
    expect(kgToGrams(3.456)).toBe(3456);
    expect(kgToGrams(3.4567)).toBe(3457);
  });
});

describe('cmToMm', () => {
  it('converts and rounds to the nearest millimeter', () => {
    expect(cmToMm(51)).toBe(510);
    expect(cmToMm(51.4)).toBe(514);
    expect(cmToMm(51.46)).toBe(515);
  });
});

describe('gramsToKgInput / mmToCmInput', () => {
  it('formats grams as a one-decimal kg input value with a German comma', () => {
    expect(gramsToKgInput(3400)).toBe('3,4');
    expect(gramsToKgInput(3456)).toBe('3,5');
  });

  it('formats millimeters as a one-decimal cm input value with a German comma', () => {
    expect(mmToCmInput(510)).toBe('51,0');
    expect(mmToCmInput(514)).toBe('51,4');
  });

  // 2026-08-17: the exact stored values from the "Kind bearbeiten lädt
  // nicht" report (Marina Philomena's real birth measurements) — the bug
  // was never in this conversion, it was in kind/bearbeiten.tsx never
  // CALLING it with real data. Pinned here anyway so this specific
  // regression can never silently recur.
  it('pre-fills the exact values from the bug report', () => {
    expect(gramsToKgInput(1800)).toBe('1,8');
    expect(mmToCmInput(430)).toBe('43,0');
    expect(mmToCmInput(295)).toBe('29,5');
  });

  it('round-trips storage -> input -> parsed -> storage for the report values', () => {
    expect(kgToGrams(parseDecimalInput(gramsToKgInput(1800))!)).toBe(1800);
    expect(cmToMm(parseDecimalInput(mmToCmInput(430))!)).toBe(430);
    expect(cmToMm(parseDecimalInput(mmToCmInput(295))!)).toBe(295);
  });
});

describe('formatWeightKg / formatLengthCm / formatHeadCircumferenceCm', () => {
  it('formats with one decimal and a German comma', () => {
    expect(formatWeightKg(3400)).toBe('3,4 kg');
    expect(formatLengthCm(510)).toBe('51,0 cm');
    expect(formatHeadCircumferenceCm(345)).toBe('34,5 cm');
  });

  it('returns null for an unset value — the caller omits the line, no dash', () => {
    expect(formatWeightKg(null)).toBeNull();
    expect(formatLengthCm(null)).toBeNull();
    expect(formatHeadCircumferenceCm(null)).toBeNull();
  });

  it('round-trips a parsed input through storage and back to the same display', () => {
    const grams = kgToGrams(parseDecimalInput('3,4')!);
    expect(formatWeightKg(grams)).toBe('3,4 kg');
  });
});
