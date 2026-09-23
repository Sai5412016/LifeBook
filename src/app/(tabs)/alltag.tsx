/**
 * Alltag — die einzige Versorgungsseite für Marina (task 2026-09-26):
 * Kalender (Wochenstreifen, aufklappbar zum Monat) oben, Tagessummen und
 * Timer-Zeile darunter, EIN gemeinsamer Tagesverlauf über alle Arten in der
 * Mitte — als einziger Bereich scrollend —, Schnelleingabe fest unten.
 *
 * Die vier ausführlichen Formulare (Füttern, Schlafen, Wickeln, Medikamente
 * & Vitamine), vorher hier direkt eingebettet, ziehen in eigene
 * Root-Stack-Routen um (app/alltag/fuettern.tsx, schlafen.tsx, mehr.tsx) —
 * erreichbar über die Timer-Zeile bzw. "Mehr …", oder per Tipp auf eine
 * Tagesverlauf-Zeile. Kein Bedienweg geht verloren, siehe Bericht.
 *
 * Die Tageswahl (b: Wochenstreifen) und die Kopfzeile (a) bauen auf der
 * bestehenden core/tracking/day-selection.ts auf, unverändert seit
 * 2026-09-24/25.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import {
  addDaysToLocalDate,
  ageInDays,
  combineLocalDateAndTime,
  localDateToPickerDate,
  nowUtcIso,
  pickerDateToLocalDate,
  toLocalDate,
} from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { canGoToNextDay, formatDayNavigationLabel, isSelectableDay } from '@/core/tracking/day-selection';
import { zeitraumTage } from '@/features/berichte/logic';
import { useActiveChild } from '@/features/household/repository';
import { formatDayAndWeekLabel } from '@/features/photos/identity';
import type { SchnellEditKind } from '@/features/schnelleingabe/components/schnell-leiste';
import { SchnellLeiste } from '@/features/schnelleingabe/components/schnell-leiste';
import { DayChips } from '@/features/timeline/components/day-chips';
import { DayTimeline } from '@/features/timeline/components/day-timeline';
import { MonthGrid } from '@/features/timeline/components/month-grid';
import { TimerRow } from '@/features/timeline/components/timer-row';
import { WeekStrip } from '@/features/timeline/components/week-strip';
import { useCalendarViewMode } from '@/features/timeline/hooks/use-calendar-view-mode';
import { useDayData, useDayMarkersForRange } from '@/features/timeline/repository';
import type { TimelineKind } from '@/features/timeline/types';

/** Ticks every second so the timer row's live clock stays current. */
function useTickingNow(): string {
  const [now, setNow] = useState(() => nowUtcIso());
  useEffect(() => {
    const id = setInterval(() => setNow(nowUtcIso()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function AlltagScreen() {
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const tz = deviceTimeZone();
  const tickingNow = useTickingNow();
  const todayLocalDate = toLocalDate(tickingNow, tz);
  const earliestLocalDate = child ? toLocalDate(child.birthAtUtcIso, child.birthTz) : todayLocalDate;

  const [selectedLocalDate, setSelectedLocalDate] = useState(() => toLocalDate(nowUtcIso(), tz));
  const [monthAnchor, setMonthAnchor] = useState(selectedLocalDate);
  const [viewMode, setViewMode] = useCalendarViewMode();

  const changeDay = (localDate: string) => {
    if (isSelectableDay(localDate, earliestLocalDate, todayLocalDate)) {
      setSelectedLocalDate(localDate);
    }
  };

  const weekDays = zeitraumTage('woche', selectedLocalDate);
  const monthDays = zeitraumTage('monat', monthAnchor);
  const displayedDays = viewMode === 'week' ? weekDays : monthDays;
  const markersByDate = useDayMarkersForRange(
    child?.childId,
    displayedDays[0],
    displayedDays[displayedDays.length - 1],
    displayedDays,
  );

  const { timeline, berichtDaten } = useDayData(child?.childId, selectedLocalDate, tickingNow);

  const selectedDayNoonUtcIso = combineLocalDateAndTime(selectedLocalDate, '12:00', tz);
  const ageLabel =
    child && selectedDayNoonUtcIso
      ? formatDayAndWeekLabel(ageInDays(selectedDayNoonUtcIso, child.birthAtUtcIso, child.birthTz))
      : null;

  const openEdit = (kind: TimelineKind | SchnellEditKind, id: string) => {
    const editToken = String(Date.now());
    if (kind === 'bottle' || kind === 'breast' || kind === 'feed') {
      router.push({ pathname: '/alltag/fuettern', params: { selectedLocalDate, editId: id, editToken } });
    } else if (kind === 'diaper') {
      router.push({ pathname: '/alltag/mehr', params: { selectedLocalDate, editKind: 'diaper', editId: id, editToken } });
    } else if (kind === 'medication') {
      router.push({
        pathname: '/alltag/mehr',
        params: { selectedLocalDate, editKind: 'medication', editId: id, editToken },
      });
    } else if (kind === 'sleep') {
      router.push({ pathname: '/alltag/schlafen', params: { selectedLocalDate, editId: id, editToken } });
    } else if (kind === 'pumping') {
      router.push('/abpumpen');
    }
    // growth/temperature/note: kein Bearbeiten-Formular vorhanden — siehe
    // Bericht ("was in diesem Auftrag falsch oder unvollständig war").
  };

  if (childLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const isBeforeBirth = selectedLocalDate < earliestLocalDate;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* (a)-(e): feste Höhe, kein Scrollen. */}
        <View style={styles.fixed}>
          <ThemedText type="small" themeColor="textSecondary">
            {child ? child.firstName : 'Heute'}
          </ThemedText>

          <DayNavigationHeader
            selectedLocalDate={selectedLocalDate}
            todayLocalDate={todayLocalDate}
            earliestLocalDate={earliestLocalDate}
            onChange={changeDay}
          />
          {ageLabel ? (
            <ThemedText type="small" themeColor="textSecondary">
              {ageLabel}
            </ThemedText>
          ) : null}

          {viewMode === 'week' ? (
            <WeekStrip
              days={weekDays}
              markersByDate={markersByDate}
              selectedLocalDate={selectedLocalDate}
              todayLocalDate={todayLocalDate}
              earliestLocalDate={earliestLocalDate}
              onSelectDay={changeDay}
            />
          ) : (
            <MonthGrid
              monthAnchor={monthAnchor}
              markersByDate={markersByDate}
              selectedLocalDate={selectedLocalDate}
              todayLocalDate={todayLocalDate}
              earliestLocalDate={earliestLocalDate}
              onSelectDay={changeDay}
              onChangeMonthAnchor={setMonthAnchor}
            />
          )}

          <Pressable
            onPress={() => {
              const next = viewMode === 'week' ? 'month' : 'week';
              if (next === 'month') {
                setMonthAnchor(selectedLocalDate);
              }
              setViewMode(next);
            }}
            hitSlop={8}>
            <ThemedText type="linkPrimary">{viewMode === 'week' ? '▾ Monat anzeigen' : '▴ Monat zuklappen'}</ThemedText>
          </Pressable>

          <DayChips selectedLocalDate={selectedLocalDate} daten={berichtDaten} />

          <TimerRow childId={child?.childId} tickingNow={tickingNow} />
        </View>

        {/* (f): einziger scrollender Bereich. */}
        <ScrollView contentContainerStyle={styles.timelineContent}>
          <DayTimeline entries={timeline} tz={tz} isBeforeBirth={isBeforeBirth} onPressEntry={openEdit} />
        </ScrollView>
      </SafeAreaView>

      {/* (g): fest unten, gewöhnliches Flex-Geschwister — Gerätetest
          2026-09-25: keine Konstante, kein Overlay (siehe frühere Korrektur
          in dieser Datei-Historie). */}
      <SchnellLeiste
        child={child}
        session={session}
        tz={tz}
        selectedLocalDate={selectedLocalDate}
        todayLocalDate={todayLocalDate}
        onRequestEdit={openEdit}
      />
    </ThemedView>
  );
}

/**
 * "‹  Heute · Mi., 23. Sep.  ›  [Heute]" — day-navigation header, unverändert
 * seit 2026-09-24/25 (core/tracking/day-selection.ts#formatDayNavigationLabel
 * trägt seit dem Gerätetest bereits die kurze Form).
 */
function DayNavigationHeader({
  selectedLocalDate,
  todayLocalDate,
  earliestLocalDate,
  onChange,
}: {
  selectedLocalDate: string;
  todayLocalDate: string;
  earliestLocalDate: string;
  onChange: (localDate: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const canGoBack = isSelectableDay(addDaysToLocalDate(selectedLocalDate, -1), earliestLocalDate, todayLocalDate);
  const canGoNext = canGoToNextDay(selectedLocalDate, todayLocalDate);
  const isToday = selectedLocalDate === todayLocalDate;

  return (
    <View style={styles.dayNav}>
      <Pressable
        onPress={() => onChange(addDaysToLocalDate(selectedLocalDate, -1))}
        disabled={!canGoBack}
        hitSlop={12}
        style={styles.dayNavArrow}
        accessibilityLabel="Ein Tag zurück">
        <ThemedText themeColor={canGoBack ? undefined : 'textSecondary'} style={styles.dayNavArrowText}>
          ‹
        </ThemedText>
      </Pressable>

      <Pressable onPress={() => setPickerOpen(true)} style={styles.dayNavLabel} hitSlop={8}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {formatDayNavigationLabel(selectedLocalDate, todayLocalDate)}
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={() => onChange(addDaysToLocalDate(selectedLocalDate, 1))}
        disabled={!canGoNext}
        hitSlop={12}
        style={styles.dayNavArrow}
        accessibilityLabel="Ein Tag vor">
        <ThemedText themeColor={canGoNext ? undefined : 'textSecondary'} style={styles.dayNavArrowText}>
          ›
        </ThemedText>
      </Pressable>

      {!isToday ? (
        <Pressable onPress={() => onChange(todayLocalDate)} hitSlop={8} style={styles.dayNavToday}>
          <ThemedText type="linkPrimary">Heute</ThemedText>
        </Pressable>
      ) : null}

      {pickerOpen ? (
        <DateTimePicker
          mode="date"
          presentation="dialog"
          value={localDateToPickerDate(selectedLocalDate)}
          minimumDate={localDateToPickerDate(earliestLocalDate)}
          maximumDate={localDateToPickerDate(todayLocalDate)}
          onValueChange={(_event, date) => {
            setPickerOpen(false);
            const picked = pickerDateToLocalDate(date);
            if (isSelectableDay(picked, earliestLocalDate, todayLocalDate)) {
              onChange(picked);
            }
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1 },
  fixed: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  timelineContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dayNavArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayNavArrowText: { fontSize: 24, fontWeight: '700' },
  dayNavLabel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one },
  dayNavToday: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
});
