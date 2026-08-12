/**
 * household/measurements — pure unit conversion and display formatting for a
 * child's birth measurements. Deliberately free of any Expo / React Native /
 * PowerSync import so it runs in plain Node under Vitest; the device- and
 * database-touching side lives in ./repository.
 *
 * The edit form takes kg/cm (what a parent actually thinks in); the database
 * stores grams/millimeters (whole-number precision, no float rounding drift
 * across repeated edits). These functions are the ONLY place that boundary
 * is crossed.
 */

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

/** kg → grams, rounded to the nearest gram — grams is the storage unit. */
export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000);
}

/** cm → millimeters, rounded to the nearest millimeter — millimeters is the storage unit. */
export function cmToMm(cm: number): number {
  return Math.round(cm * 10);
}

/** grams → kg, for pre-filling the edit form's input field (no unit suffix, no rounding beyond one decimal). */
export function gramsToKgInput(grams: number): string {
  return (grams / 1000).toFixed(1).replace('.', ',');
}

/** millimeters → cm, for pre-filling the edit form's input field. */
export function mmToCmInput(mm: number): string {
  return (mm / 10).toFixed(1).replace('.', ',');
}

const oneDecimal = (value: number): string => value.toFixed(1).replace('.', ',');

/** "3,4 kg" — one decimal place, German comma. Null in, null out. */
export function formatWeightKg(grams: number | null): FormattedMeasurement {
  return grams === null ? null : `${oneDecimal(grams / 1000)} kg`;
}

/** "51,0 cm" — one decimal place, German comma. Null in, null out. */
export function formatLengthCm(mm: number | null): FormattedMeasurement {
  return mm === null ? null : `${oneDecimal(mm / 10)} cm`;
}

/** "34,5 cm" — one decimal place, German comma. Null in, null out. */
export function formatHeadCircumferenceCm(mm: number | null): FormattedMeasurement {
  return mm === null ? null : `${oneDecimal(mm / 10)} cm`;
}
