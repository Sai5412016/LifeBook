/**
 * pumping/night-mode — "ist gerade Nacht?", pure and testable.
 *
 * Abpumpen happens at 03:00 more often than at any civilised hour, usually
 * one-handed, usually next to a sleeping baby. Between 22:00 and 06:00 the
 * tab therefore switches to its own dark palette REGARDLESS of the app
 * theme (`useColorScheme`): a light-theme phone would otherwise throw a
 * full-brightness white screen at somebody in a dark room.
 *
 * The decision takes a "HH:mm" string rather than reading a clock itself,
 * so it stays pure — the caller (./hooks/use-night-mode) produces that
 * string via `core/time#formatTimeLabel(nowUtcIso(), deviceTimeZone())`,
 * keeping every `new Date()` inside core/time where it belongs.
 */

/** Night starts at 22:00 (inclusive). */
export const NIGHT_START_HOUR = 22;
/** Night ends at 06:00 (exclusive) — 06:00 itself is already day. */
export const NIGHT_END_HOUR = 6;

/**
 * Whether a wall-clock "HH:mm" falls in the night window. The window wraps
 * midnight, so this is an OR of two ranges, not a single comparison — the
 * classic off-by-one here is treating 23:00 < 06:00 as false and 02:00 as
 * outside.
 *
 * An unparseable input reads as "not night": a broken clock string must
 * not be able to darken the screen for a whole day.
 */
export function isNightTime(localTimeHhMm: string): boolean {
  const match = localTimeHhMm.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  if (hour > 23 || Number(match[2]) > 59) {
    return false;
  }
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * The tab's night palette. Deliberately its own set rather than the app's
 * dark theme: the requirement is stricter than "dark mode" — nothing
 * brighter than 80 % white (`#CCCCCC`), no bright surfaces at all, and
 * muted contrast throughout.
 *
 * No red anywhere, in either palette: this tab shows an amount, never a
 * verdict on it (explicit product decision — no target, no warning color).
 */
export type PumpingPalette = {
  background: string;
  surface: string;
  surfacePressed: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  border: string;
};

/** Brightest value the night palette may use: 80 % white. */
export const NIGHT_MAX_BRIGHTNESS = '#CCCCCC';

export const NIGHT_PALETTE: PumpingPalette = {
  background: '#0B0B0D',
  surface: '#16161A',
  surfacePressed: '#202027',
  text: NIGHT_MAX_BRIGHTNESS,
  textSecondary: '#8A8A93',
  accent: '#2A2F3A',
  accentText: NIGHT_MAX_BRIGHTNESS,
  border: '#2A2A31',
};
