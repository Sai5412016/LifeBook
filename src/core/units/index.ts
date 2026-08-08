/**
 * core/units — canonical <-> display conversion (Master-Spec §7).
 *
 * Canonical storage (never deviate):
 *   volume      → milliliter (INTEGER)
 *   weight      → gram       (INTEGER)
 *   length      → millimeter (INTEGER)
 *   temperature → celsius    (REAL)
 *   duration    → seconds    (INTEGER)
 *
 * Rule: rounding happens ONLY when converting user input INTO the canonical
 * (integer) form. Reads out to display stay full-precision floats and are
 * formatted separately. Never write a rounded display value back to storage.
 */

/* ────────────── Volume: ml (canonical) <-> oz ────────────── */

export const ML_PER_OZ = 29.5735295625;

/** Canonical ml → display fluid ounces (float, format separately). */
export const mlToOz = (ml: number): number => ml / ML_PER_OZ;

/** User input in fluid ounces → canonical ml (INTEGER). */
export const ozToMl = (oz: number): number => Math.round(oz * ML_PER_OZ);

/* ────────────── Weight: g (canonical) <-> kg / lb+oz ────────────── */

export const G_PER_LB = 453.59237;
export const G_PER_OZ = 28.349523125;

/** Canonical g → display kilograms (float). */
export const gToKg = (g: number): number => g / 1000;

/** User input in kilograms → canonical g (INTEGER). */
export const kgToG = (kg: number): number => Math.round(kg * 1000);

/** Canonical g → display pounds + ounces (imperial). oz is a float for formatting. */
export const gToLbOz = (g: number): { lb: number; oz: number } => {
  const totalOz = g / G_PER_OZ;
  const lb = Math.floor(totalOz / 16);
  const oz = totalOz - lb * 16;
  return { lb, oz };
};

/** User input in pounds + ounces → canonical g (INTEGER). */
export const lbOzToG = (lb: number, oz: number): number =>
  Math.round(lb * G_PER_LB + oz * G_PER_OZ);

/* ────────────── Length: mm (canonical) <-> cm / in ────────────── */

export const MM_PER_IN = 25.4;

/** Canonical mm → display centimeters (float). */
export const mmToCm = (mm: number): number => mm / 10;

/** User input in centimeters → canonical mm (INTEGER). */
export const cmToMm = (cm: number): number => Math.round(cm * 10);

/** Canonical mm → display inches (float). */
export const mmToIn = (mm: number): number => mm / MM_PER_IN;

/** User input in inches → canonical mm (INTEGER). */
export const inToMm = (inch: number): number => Math.round(inch * MM_PER_IN);

/* ────────────── Temperature: celsius (canonical, REAL) <-> fahrenheit ────────────── */

/** Canonical °C → display °F. Temperature is REAL — no rounding to canonical. */
export const cToF = (c: number): number => (c * 9) / 5 + 32;

/** User input in °F → canonical °C (REAL). */
export const fToC = (f: number): number => ((f - 32) * 5) / 9;

/* ────────────── Duration: seconds (canonical) ────────────── */

/** Split canonical seconds into h/m/s parts. */
export const secondsToHms = (
  totalSeconds: number,
): { h: number; m: number; s: number } => {
  const sign = totalSeconds < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(totalSeconds));
  return {
    h: sign * Math.floor(abs / 3600),
    m: Math.floor((abs % 3600) / 60),
    s: abs % 60,
  };
};

/** Format canonical seconds as "H:MM:SS" (h omitted when 0 → "M:SS"). */
export const formatDuration = (totalSeconds: number): string => {
  const { h, m, s } = secondsToHms(totalSeconds);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h !== 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};

/* ────────────── Preference-driven dispatch ────────────── */

export type VolumeUnit = 'ml' | 'oz';
export type WeightUnit = 'g' | 'lb_oz';
export type LengthUnit = 'cm' | 'in';
export type TempUnit = 'c' | 'f';
