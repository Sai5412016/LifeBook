/**
 * Non-surface theme colors — brand accent and status (warning/danger)
 * colors — for the "Heute" screen's tracking sections and other places that
 * need a color rather than a `ThemedView`/`ThemedText` surface.
 *
 * A hook, not flat constants: `warningBackground`/`dangerBackground` (and
 * their text pairs) DO differ between light and dark (see
 * `constants/themes/oktopus.ts`'s doc comment), so resolving them requires
 * knowing the current color scheme, the same way `useTheme()` does.
 */

import { useTheme } from '@/hooks/use-theme';

export { withAlpha } from './color-utils';

export type UiColors = {
  accent: string;
  accentPressed: string;
  amber: string;
  green: string;
  warningBg: string;
  warningText: string;
  dangerBg: string;
  dangerText: string;
  chipBorder: string;
};

export function useUiColors(): UiColors {
  const theme = useTheme();
  return {
    accent: theme.accent,
    accentPressed: theme.accentPressed,
    amber: theme.amber,
    green: theme.green,
    warningBg: theme.warningBackground,
    warningText: theme.warningText,
    dangerBg: theme.dangerBackground,
    dangerText: theme.dangerText,
    chipBorder: theme.chipBorder,
  };
}
