/**
 * timeline/components/timer-row — the Alltag tab's narrow "everything else"
 * row: "⏱ Schlaf   Mehr …". Opens the corresponding feature's own FULL
 * screen with its complete controls (nothing is reimplemented here); a
 * RUNNING sleep shows its live clock right in this row in the accent
 * color, so a running session can never become invisible.
 *
 * 2026-09-26: "⏱ Stillen" and "⏱ Abpumpen" removed — Marina is fed
 * exclusively by bottle (Stillen) and pumping has no entry UI anymore
 * (Abpumpen). Füttern (now timer-less: just Fläschchen) moved under
 * "Mehr …" alongside Wickeln/Medikamente & Vitamine — see
 * app/alltag/mehr.tsx's own doc comment. Kept as its OWN row rather than
 * folded into day-chips.tsx's chip row: chips are a data display (pill
 * shapes, a category color, a count), these are plain navigation links —
 * merging the two would blur that distinction for a row that, at two
 * short items, was never the one taking up too much space.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useRunningSleep } from '@/features/sleep/repository';
import { sleepDurationSeconds } from '@/features/sleep/timer';
import { formatClock } from '@/features/feeding/timer';
import { useUiColors } from '@/ui';

export type TimerRowProps = {
  childId: string | undefined;
  tickingNow: string;
};

export function TimerRow({ childId, tickingNow }: TimerRowProps) {
  const { accent } = useUiColors();
  const { sleep: runningSleep } = useRunningSleep(childId);

  const schlafLabel = runningSleep
    ? `⏱ Schlaf läuft · ${formatClock(sleepDurationSeconds(runningSleep, tickingNow))}`
    : '⏱ Schlaf';

  return (
    <View style={styles.row}>
      <TimerItem
        label={schlafLabel}
        active={!!runningSleep}
        accent={accent}
        onPress={() => router.push('/alltag/schlafen')}
      />
      <TimerItem label="Mehr …" active={false} accent={accent} onPress={() => router.push('/alltag/mehr')} />
    </View>
  );
}

function TimerItem({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.item}>
      <ThemedText type="small" style={active ? { color: accent, fontWeight: '700' } : undefined} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  item: { paddingVertical: Spacing.half },
});
