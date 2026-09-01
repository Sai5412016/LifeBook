/**
 * pumping/hooks/use-pumping-palette — resolves the colors the "Abpumpen"
 * tab draws with, and flips them to the night palette between 22:00 and
 * 06:00 device time, independently of the app's light/dark theme.
 *
 * The clock is read through core/time only (`nowUtcIso` +
 * `formatTimeLabel` in the device timezone) — no `new Date()` here — and
 * the actual decision is the pure, tested `isNightTime` in ../night-mode.
 *
 * Re-checked every 30 s rather than once per mount: somebody who opens the
 * tab at 21:58 and is still pumping at 22:01 should have the screen dim
 * itself, not stay bright until they navigate away and back.
 */

import { useEffect, useState } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { nowUtcIso, formatTimeLabel } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';

import { isNightTime, NIGHT_PALETTE, type PumpingPalette } from '../night-mode';

/** How often the night window is re-evaluated while the tab stays open. */
const CLOCK_POLL_MS = 30_000;

function useIsNight(): boolean {
  const [isNight, setIsNight] = useState(() =>
    isNightTime(formatTimeLabel(nowUtcIso(), deviceTimeZone())),
  );

  useEffect(() => {
    const check = () => setIsNight(isNightTime(formatTimeLabel(nowUtcIso(), deviceTimeZone())));
    check();
    const id = setInterval(check, CLOCK_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return isNight;
}

export function usePumpingPalette(): { palette: PumpingPalette; isNight: boolean } {
  const theme = useTheme();
  const isNight = useIsNight();

  if (isNight) {
    return { palette: NIGHT_PALETTE, isNight };
  }

  return {
    palette: {
      background: theme.background,
      surface: theme.backgroundElement,
      surfacePressed: theme.backgroundSelected,
      text: theme.text,
      textSecondary: theme.textSecondary,
      accent: theme.accent,
      accentText: '#FFFFFF',
      border: theme.chipBorder,
    },
    isNight,
  };
}
