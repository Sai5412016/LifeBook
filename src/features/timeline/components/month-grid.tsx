/**
 * timeline/components/month-grid — the Alltag calendar's expanded view
 * (task 2026-09-26): a full Monday-first month grid, same three dots per
 * cell as week-strip.tsx, with its own ‹ › month navigation. Day range and
 * label reuse features/berichte/logic.ts's `zeitraumTage('monat', …)` /
 * `formatZeitraumLabel` / `verschobenerAnker` / `canGoToNextPeriod` — the
 * exact date-range math that feature already has, not re-derived here.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { DayMarkers } from '@/core/tracking/day-markers';
import { isSelectableDay } from '@/core/tracking/day-selection';
import { isoWeekdayOfLocalDate } from '@/core/time';
import { canGoToNextPeriod, formatZeitraumLabel, verschobenerAnker, zeitraumTage } from '@/features/berichte/logic';

import { DayColumn } from './week-strip';

const WEEKDAY_HEADER_LETTERS = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

export type MonthGridProps = {
  monthAnchor: string;
  markersByDate: ReadonlyMap<string, DayMarkers>;
  selectedLocalDate: string;
  todayLocalDate: string;
  earliestLocalDate: string;
  onSelectDay: (localDate: string) => void;
  onChangeMonthAnchor: (anchor: string) => void;
};

export function MonthGrid({
  monthAnchor,
  markersByDate,
  selectedLocalDate,
  todayLocalDate,
  earliestLocalDate,
  onSelectDay,
  onChangeMonthAnchor,
}: MonthGridProps) {
  const days = zeitraumTage('monat', monthAnchor);
  const label = formatZeitraumLabel('monat', days);
  const leadingBlanks = isoWeekdayOfLocalDate(days[0]) - 1;
  const canGoNext = canGoToNextPeriod(days, todayLocalDate);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onChangeMonthAnchor(verschobenerAnker('monat', monthAnchor, -1))}
          hitSlop={12}
          style={styles.headerArrow}
          accessibilityLabel="Ein Monat zurück">
          <ThemedText style={styles.headerArrowText}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{label}</ThemedText>
        <Pressable
          onPress={() => canGoNext && onChangeMonthAnchor(verschobenerAnker('monat', monthAnchor, 1))}
          disabled={!canGoNext}
          hitSlop={12}
          style={styles.headerArrow}
          accessibilityLabel="Ein Monat vor">
          <ThemedText
            themeColor={canGoNext ? undefined : 'textSecondary'}
            style={styles.headerArrowText}>
            ›
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.weekdayHeaderRow}>
        {WEEKDAY_HEADER_LETTERS.map((letter, index) => (
          <ThemedText key={index} type="small" themeColor="textSecondary" style={styles.weekdayHeaderCell}>
            {letter}
          </ThemedText>
        ))}
      </View>

      <View style={styles.grid}>
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <View key={`blank-${index}`} style={styles.blankCell} />
        ))}
        {days.map((day) => (
          <DayColumn
            key={day}
            localDate={day}
            weekdayLetter=""
            markers={markersByDate.get(day)}
            isSelected={day === selectedLocalDate}
            isFuture={day > todayLocalDate}
            isSelectable={isSelectableDay(day, earliestLocalDate, todayLocalDate)}
            onPress={() => onSelectDay(day)}
            style={styles.cell}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerArrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerArrowText: { fontSize: 20, fontWeight: '700' },
  weekdayHeaderRow: { flexDirection: 'row' },
  weekdayHeaderCell: { width: '14.2857%', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  blankCell: { width: '14.2857%' },
  cell: { width: '14.2857%', flex: undefined },
});
