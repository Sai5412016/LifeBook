/**
 * timeline/components/week-strip — the Alltag calendar's default view (task
 * 2026-09-26): seven columns, Monday through Sunday of the week containing
 * the selected day, each with three small presence dots
 * (Mahlzeit/Medikament/Windel, always in that left-to-right order — the
 * POSITION carries the meaning, color is only support, never the sole
 * signal). Day range comes from features/berichte/logic.ts#zeitraumTage
 * ('woche') — reused, not re-derived.
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isSelectableDay } from '@/core/tracking/day-selection';
import type { DayMarkers } from '@/core/tracking/day-markers';
import { useUiColors } from '@/ui';

/** German single weekday initial, Monday first — isoWeekdayOfLocalDate's 1..7. Adjacent duplicates (Mi/Mo, Sa/So) are disambiguated by column position, same convention as most calendar UIs. */
const WEEKDAY_LETTERS = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

export type WeekStripProps = {
  days: readonly string[];
  markersByDate: ReadonlyMap<string, DayMarkers>;
  selectedLocalDate: string;
  todayLocalDate: string;
  earliestLocalDate: string;
  onSelectDay: (localDate: string) => void;
};

export function WeekStrip({
  days,
  markersByDate,
  selectedLocalDate,
  todayLocalDate,
  earliestLocalDate,
  onSelectDay,
}: WeekStripProps) {
  return (
    <View style={styles.row}>
      {days.map((day, index) => (
        <DayColumn
          key={day}
          localDate={day}
          weekdayLetter={WEEKDAY_LETTERS[index] ?? ''}
          markers={markersByDate.get(day)}
          isSelected={day === selectedLocalDate}
          isFuture={day > todayLocalDate}
          isSelectable={isSelectableDay(day, earliestLocalDate, todayLocalDate)}
          onPress={() => onSelectDay(day)}
        />
      ))}
    </View>
  );
}

export function DayColumn({
  localDate,
  weekdayLetter,
  markers,
  isSelected,
  isFuture,
  isSelectable,
  onPress,
  style,
}: {
  localDate: string;
  weekdayLetter: string;
  markers: DayMarkers | undefined;
  isSelected: boolean;
  isFuture: boolean;
  isSelectable: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { accent, amber, green, chipBorder } = useUiColors();
  const dayNumber = Number(localDate.slice(-2));
  // Zukünftige Tage: blass, ohne Punkte (task requirement — es kann dort
  // naturgemäß noch nichts eingetragen sein). Tage vor der Geburt: blass
  // UND nicht antippbar (isSelectable deckt beides über
  // core/tracking/day-selection.ts#isSelectableDay ab).
  const isDimmed = isFuture || !isSelectable;

  return (
    <Pressable
      onPress={onPress}
      disabled={!isSelectable}
      style={[
        styles.column,
        style,
        isSelected && { backgroundColor: chipBorder, borderColor: accent, borderWidth: 2 },
      ]}
      accessibilityLabel={localDate}>
      <ThemedText type="small" themeColor={isDimmed ? 'textSecondary' : undefined} style={styles.weekday}>
        {weekdayLetter}
      </ThemedText>
      <ThemedText type="smallBold" themeColor={isDimmed ? 'textSecondary' : undefined}>
        {dayNumber}
      </ThemedText>
      {!isFuture ? (
        <View style={styles.dotsRow}>
          <Dot filled={!!markers?.hasFeed} color={accent} />
          <Dot filled={!!markers?.hasMedication} color={green} />
          <Dot filled={!!markers?.hasDiaper} color={amber} />
        </View>
      ) : (
        <View style={styles.dotsRow} />
      )}
    </Pressable>
  );
}

function Dot({ filled, color }: { filled: boolean; color: string }) {
  const { chipBorder } = useUiColors();
  return (
    <View
      style={[
        styles.dot,
        filled ? { backgroundColor: color } : { backgroundColor: 'transparent', borderWidth: 1, borderColor: chipBorder },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.half },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  weekday: { fontSize: 11 },
  dotsRow: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
