/**
 * household/measurements — text-field parsing and German-comma display
 * formatting for a child's birth measurements. Deliberately free of any
 * Expo / React Native / PowerSync import so it runs in plain Node under
 * Vitest; the device- and database-touching side lives in ./repository.
 *
 * The edit form takes kg/cm (what a parent actually thinks in); the
 * database stores grams/millimeters (whole-number precision, no float
 * rounding drift across repeated edits). The actual canonical<->display
 * NUMBER conversion (`gToKg`/`kgToG`/`mmToCm`/`cmToMm`) lives in
 * `@/core/units` — every feature that touches weight/length shares that
 * one implementation (Master-Spec §7); this module only adds the
 * text-input-specific layer on top: parsing a typed German decimal,
 * rounding to one displayed decimal, formatting the unit suffix.
 * 2026-08-17: this module used to re-implement `Math.round(kg * 1000)` /
 * `Math.round(cm * 10)` itself, duplicating core/units — removed in favour
 * of importing it, so a future rounding-rule change can't drift between
 * the two copies.
 */

import { cmToMm as canonicalCmToMm, gToKg, kgToG, mmToCm } from '@/core/units';

/** A birth-card measurement line, or null when the value isn't set — the caller omits the line entirely rather than showing a dash. */
type FormattedMeasurement = string | null;

/** Parses a text field's typed value into a number, accepting both "3.4" and the German "3,4". Empty/invalid input is null, not 0 — a blank field must stay blank, not silently become zero. */
export function parseDecimalInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** kg → grams, rounded to the nearest gram — grams is the storage unit. Thin re-export of core/units#kgToG so callers in this feature don't need a second import. */
export const kgToGrams = kgToG;

/** cm → millimeters, rounded to the nearest millimeter — millimeters is the storage unit. Thin re-export of core/units#cmToMm. */
export const cmToMm = canonicalCmToMm;

const oneDecimal = (value: number): string => value.toFixed(1).replace('.', ',');

/** grams → kg, for pre-filling the edit form's input field (no unit suffix, one displayed decimal, German comma). */
export function gramsToKgInput(grams: number): string {
  return oneDecimal(gToKg(grams));
}

/** millimeters → cm, for pre-filling the edit form's input field. */
export function mmToCmInput(mm: number): string {
  return oneDecimal(mmToCm(mm));
}

/** "3,4 kg" — one decimal place, German comma. Null in, null out. */
export function formatWeightKg(grams: number | null): FormattedMeasurement {
  return grams === null ? null : `${oneDecimal(gToKg(grams))} kg`;
}

/** "51,0 cm" — one decimal place, German comma. Null in, null out. */
export function formatLengthCm(mm: number | null): FormattedMeasurement {
  return mm === null ? null : `${oneDecimal(mmToCm(mm))} cm`;
}

/** "34,5 cm" — one decimal place, German comma. Null in, null out. */
export function formatHeadCircumferenceCm(mm: number | null): FormattedMeasurement {
  return mm === null ? null : `${oneDecimal(mmToCm(mm))} cm`;
}
