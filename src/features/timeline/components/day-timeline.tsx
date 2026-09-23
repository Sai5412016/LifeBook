/**
 * timeline/components/day-timeline — the Alltag tab's ONE scrolling area
 * (task 2026-09-26): every entry of the selected day, merged across all
 * sources, ascending by time. Compact rows (~34dp), no cards, no big gaps —
 * deliberately the opposite visual density of the old full-width tracking
 * sections. Tapping a row opens the matching full form via `onPressEntry`;
 * the caller (app/(tabs)/alltag.tsx) owns what that actually navigates to
 * for each `TimelineKind`.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatTimeLabel } from '@/core/time';
import { useUiColors } from '@/ui';

import { formatEmptyDayLabel } from '../logic';
import type { TimelineEntry, TimelineKind } from '../types';

export type DayTimelineProps = {
  entries: readonly TimelineEntry[];
  tz: string;
  isBeforeBirth: boolean;
  onPressEntry: (kind: TimelineKind, id: string) => void;
};

export function DayTimeline({ entries, tz, isBeforeBirth, onPressEntry }: DayTimelineProps) {
  if (entries.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
        {formatEmptyDayLabel(isBeforeBirth)}
      </ThemedText>
    );
  }

  return (
    <View>
      {entries.map((entry) => (
        <TimelineRow key={`${entry.kind}-${entry.id}`} entry={entry} tz={tz} onPress={() => onPressEntry(entry.kind, entry.id)} />
      ))}
    </View>
  );
}

function categoryColor(kind: TimelineKind, colors: ReturnType<typeof useUiColors>): string {
  switch (kind) {
    case 'feed':
      return colors.accent;
    case 'diaper':
      return colors.amber;
    case 'medication':
      return colors.green;
    // Schlaf/Abpumpen/Gewicht/Temperatur/Notiz teilen sich einen
    // neutralen Balken — der Palette fehlen weitere eigene Markenfarben
    // (nur drei: accent/amber/green), und Position + Beschriftung tragen
    // die Bedeutung ohnehin schon (dieselbe Regel wie bei den
    // Kalender-Punkten oben in dieser Datei).
    default:
      return colors.chipBorder;
  }
}

function TimelineRow({ entry, tz, onPress }: { entry: TimelineEntry; tz: string; onPress: () => void }) {
  const colors = useUiColors();
  const timeLabel = formatTimeLabel(entry.occurredAtUtcIso, tz);

  return (
    <Pressable onPress={onPress} style={styles.row}>
      <ThemedText type="small" style={styles.time}>
        {timeLabel}
      </ThemedText>
      <View style={[styles.bar, { backgroundColor: categoryColor(entry.kind, colors) }]} />
      <ThemedText type="small" style={styles.label} numberOfLines={1}>
        {entry.label}
      </ThemedText>
      {/* "Menge/Angabe noch nicht geprüft" — derselbe zurückhaltende Marker
          wie in der Füttern-Tagesliste (Gerätetest 2026-09-23), keine
          Warnfarbe, kein Ausrufezeichen. */}
      {entry.needsReview ? (
        <ThemedText themeColor="textSecondary" accessibilityLabel="Noch nicht geprüft">
          ○{' '}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" style={styles.value} numberOfLines={1}>
        {entry.valueLabel}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: Spacing.three, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 34,
    paddingVertical: Spacing.half,
  },
  time: { width: 44 },
  bar: { width: 3, height: 18, borderRadius: 2 },
  label: { flex: 1 },
  value: { textAlign: 'right' },
});
