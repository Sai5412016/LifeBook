/**
 * The "Oktopus" theme (2026-08-12 rebrand) — warm terracotta accent on a
 * cream/espresso palette, replacing the earlier default blue-on-neutral-gray
 * scheme.
 *
 * `accent`, `accentPressed`, `amber` and `green` are deliberately IDENTICAL
 * in both palettes below: they are brand/action-button hues (e.g. the
 * diaper section's "Nass"/"Stuhl"/"Beides" buttons), not surface colors —
 * a button's fill isn't supposed to shift when the OS switches color scheme.
 *
 * `warningBackground` / `warningText` / `dangerBackground` / `dangerText` /
 * `chipBorder` DO differ: unlike a button fill, a banner sits directly on
 * `background` and has to read as a warning/danger against whichever
 * background is currently showing. The exact tones below aren't from the
 * design brief (only the nine core colors were specified) — dark-mode kept
 * the previously-shipped values unchanged (already verified to work against
 * a near-black background), light-mode is newly derived to sit on the cream
 * background with the same relative contrast.
 */

import type { Theme } from './types';

const ACCENT = '#E9613A';
const ACCENT_PRESSED = '#C64A26';
const AMBER = '#d9822b';
const GREEN = '#3ba55d';

export const oktopusTheme: Theme = {
  name: 'oktopus',
  light: {
    text: '#3B2A24',
    textSecondary: '#7A6459',
    background: '#FFFDF8',
    backgroundElement: '#FAF3E3',
    backgroundSelected: '#F1E2C4',
    accent: ACCENT,
    accentPressed: ACCENT_PRESSED,
    amber: AMBER,
    green: GREEN,
    warningBackground: '#F6E4BC',
    warningText: '#7A4B12',
    dangerBackground: '#F6DCD2',
    dangerText: '#B23A1E',
    chipBorder: '#D8C6A8',
  },
  dark: {
    text: '#F5EFE6',
    textSecondary: '#B6A796',
    background: '#1A1512',
    backgroundElement: '#262019',
    backgroundSelected: '#332A20',
    accent: ACCENT,
    accentPressed: ACCENT_PRESSED,
    amber: AMBER,
    green: GREEN,
    warningBackground: '#3a2c10',
    warningText: '#ffd54f',
    dangerBackground: '#3a1414',
    dangerText: '#ff8a80',
    chipBorder: '#4A3F35',
  },
};
