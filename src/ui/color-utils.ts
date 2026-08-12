/**
 * ui/color-utils — pure color math, free of any Expo / React Native import
 * so it runs in plain Node under Vitest (and so importing it never pulls in
 * `react-native`, unlike `./colors`, which needs `useTheme()`).
 */

/**
 * `#rrggbb` (or `#rgb`) plus an alpha, as an `rgba()` string — for the rare
 * case that genuinely needs a translucent tint of a theme color (e.g. a
 * selection overlay on top of an arbitrary photo) rather than a flat one.
 */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
