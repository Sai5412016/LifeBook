/**
 * ui/color-utils — pure color math, free of any Expo / React Native import
 * so it runs in plain Node under Vitest (and so importing it never pulls in
 * `react-native`, unlike `./colors`, which needs `useTheme()`).
 */

function normalizeHex(hex: string): string {
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
}

function hexChannels(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

/**
 * `#rrggbb` (or `#rgb`) plus an alpha, as an `rgba()` string — for the rare
 * case that genuinely needs a translucent tint of a theme color (e.g. a
 * selection overlay on top of an arbitrary photo) rather than a flat one.
 *
 * NOT for a "muted/second stage" of a brand color on a dark background —
 * Gerätetest 2026-09-25: `withAlpha(accent, 0.6)`/`withAlpha(amber, 0.6)`
 * blended with the app's near-black dark-mode background and came out
 * muddy brown, making "Brust" and "Windel Stuhl" barely distinguishable
 * from each other. Use `lighten` below for that case instead — it mixes
 * toward white at FULL opacity, so the result never depends on whatever
 * happens to sit underneath.
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Mixes `hex` toward white by `amount` (0 = unchanged, 1 = white), at full
 * opacity — a flat, PALETTE-INDEPENDENT pastel tint, unlike `withAlpha`
 * (which blends with whatever background sits behind it — muddy on a dark
 * one, see that function's own doc comment). For a category's "second
 * stage" (e.g. schnelleingabe/components/schnell-leiste.tsx's Brust/Windel
 * Stuhl buttons, Gerätetest 2026-09-25 Befund 3b): same hue, clearly
 * lighter, always legible regardless of theme — pair it with a dark
 * foreground color (this app's own light-mode text tone reads well on any
 * `lighten` result), never the white text a full-strength button uses.
 */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexChannels(hex);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}
