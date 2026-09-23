/**
 * timeline/components/timer-row — the Alltag tab's narrow "everything else"
 * row (task 2026-09-26): "⏱ Stillen  ⏱ Schlaf  ⏱ Abpumpen  Mehr …". Each of
 * the first three opens the corresponding feature's own FULL screen with
 * its complete controls (nothing is reimplemented here); a RUNNING timer
 * shows its live clock right in this row in the accent color, so a running
 * session can never become invisible after the redesign (task requirement).
 * "Mehr …" opens every other full form (Wickeln, Medikamente & Vitamine)
 * that doesn't have a timer of its own.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useRunningFeed } from '@/features/feeding/repository';
import { elapsedSeconds, formatClock } from '@/features/feeding/timer';
import { useRunningSleep } from '@/features/sleep/repository';
import { sleepDurationSeconds } from '@/features/sleep/timer';
import { useUiColors } from '@/ui';

export type TimerRowProps = {
  childId: string | undefined;
  tickingNow: string;
};

export function TimerRow({ childId, tickingNow }: TimerRowProps) {
  const { accent } = useUiColors();
  const { feed: runningFeed } = useRunningFeed(childId);
  const { sleep: runningSleep } = useRunningSleep(childId);

  const stillenLabel = runningFeed
    ? `⏱ Stillen läuft · ${formatClock(elapsedSeconds(runningFeed, tickingNow).left + elapsedSeconds(runningFeed, tickingNow).right)}`
    : '⏱ Stillen';
  const schlafLabel = runningSleep
    ? `⏱ Schlaf läuft · ${formatClock(sleepDurationSeconds(runningSleep, tickingNow))}`
    : '⏱ Schlaf';

  return (
    <View style={styles.row}>
      <TimerItem
        label={stillenLabel}
        active={!!runningFeed}
        accent={accent}
        onPress={() => router.push('/alltag/fuettern')}
      />
      <TimerItem
        label={schlafLabel}
        active={!!runningSleep}
        accent={accent}
        onPress={() => router.push('/alltag/schlafen')}
      />
      <TimerItem label="⏱ Abpumpen" active={false} accent={accent} onPress={() => router.push('/abpumpen')} />
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
