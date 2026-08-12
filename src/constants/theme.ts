/**
 * The active theme. Every color in the app is read from here (via
 * `useTheme()` / `ThemedView` / `ThemedText`, or `@/ui`'s `useUiColors()`
 * for the non-surface accent/status colors) — nowhere in feature code
 * should a hex literal appear.
 *
 * TO RESKIN THE APP: add a new file under `./themes/` that satisfies the
 * `Theme` type (see `./themes/types.ts`) and swap the import below to point
 * at it. That is the whole change — no other file needs touching.
 */

import '@/global.css';

import { Platform } from 'react-native';

import { oktopusTheme } from './themes/oktopus';

export const Colors = oktopusTheme;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
