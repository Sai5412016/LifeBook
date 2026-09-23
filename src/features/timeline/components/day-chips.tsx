/**
 * timeline/components/day-chips — the selected day's three small totals
 * (task 2026-09-26): "• 5 Mahlzeiten · 340 ml", "• 5 Windeln", "• 3
 * Medizin". Reuses features/berichte/logic.ts#berichtBerechnen for the
 * actual counting (called with the SELECTED DAY as a one-day "period")
 * instead of a second aggregation — task requirement: check first whether
 * berichte already computes this before writing new logic. A chip is never
 * hidden at zero — it shows "0" (task requirement: a hidden chip would
 * read as "not loaded yet", not "nothing happened").
 */

import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { berichtBerechnen } from '@/features/berichte/logic';
import type { BerichtDaten } from '@/features/berichte/logic';
import { useUiColors } from '@/ui';

export type DayChipsProps = {
  selectedLocalDate: string;
  daten: BerichtDaten;
};

export function DayChips({ selectedLocalDate, daten }: DayChipsProps) {
  const { accent, amber, green } = useUiColors();
  const bericht = berichtBerechnen([selectedLocalDate], daten, selectedLocalDate);
  const medicationCount = bericht.medications.reduce((sum, entry) => sum + entry.countInPeriod, 0);

  return (
    <View style={styles.row}>
      <Chip color={accent} label={`${bericht.feeding.count} Mahlzeiten · ${bericht.feeding.totalMl} ml`} />
      <Chip color={amber} label={`${bericht.diapers.count} Windeln`} />
      <Chip color={green} label={`${medicationCount} Medizin`} />
    </View>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  const { chipBorder } = useUiColors();
  return (
    <View style={[styles.chip, { borderColor: chipBorder }]}>
      <View style={[styles.bullet, { backgroundColor: color }]} />
      <ThemedText type="small" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.four,
    borderWidth: 1,
  },
  bullet: { width: 8, height: 8, borderRadius: 4 },
});
