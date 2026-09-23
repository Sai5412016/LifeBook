/**
 * Alltag — one screen, one section per tracking feature: Füttern (needed ten
 * times a day), Wickeln, Medikamente & Vitamine, Schlafen. Each section owns
 * its own data and state; this file supplies the shared shell (child,
 * session, device timezone, the live clock) AND, since 2026-09-24, the day
 * selector: which single calendar day every section currently shows and
 * backfills to. That selected day is held ONCE here (`useState`, no
 * context/store — task requirement) and passed down as a prop, the same way
 * `tickingNow` already was.
 *
 * Formerly the app's launch screen at route "index" — moved to tab 3 (still
 * functionally identical) when tab 1 became the child profile ("Marina",
 * `index.tsx`). See components/app-tabs.tsx.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import {
  addDaysToLocalDate,
  localDateToPickerDate,
  nowUtcIso,
  pickerDateToLocalDate,
  toLocalDate,
} from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import {
  canGoToNextDay,
  formatBackfillHint,
  formatDayNavigationLabel,
  isSelectableDay,
} from '@/core/tracking/day-selection';
import { DiaperSection } from '@/features/diaper/components/diaper-section';
import { FeedingSection } from '@/features/feeding/components/feeding-section';
import { useActiveChild } from '@/features/household/repository';
import { MedicationSection } from '@/features/medication/components/medication-section';
import type { SchnellEditKind } from '@/features/schnelleingabe/components/schnell-leiste';
import { SchnellLeiste } from '@/features/schnelleingabe/components/schnell-leiste';
import { SleepSection } from '@/features/sleep/components/sleep-section';
import { KeyboardSafeScreen } from '@/ui';

/** Welche Sektion ein von der Schnelleingabe-Leiste angeforderter "Ändern"-Tipp öffnet. */
type QuickEditRequest = { kind: SchnellEditKind; id: string; token: number };

/** Ticks every second so Füttern's running timer and "vor …" labels stay live. */
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
  const insets = useSafeAreaInsets();
  // Live, not frozen at mount: if the app stays open across midnight, the
  // right arrow un-grays itself the moment "heute" genuinely advances,
  // without needing any special-cased reset of `selectedLocalDate` itself.
  const todayLocalDate = toLocalDate(tickingNow, tz);
  const earliestLocalDate = child ? toLocalDate(child.birthAtUtcIso, child.birthTz) : todayLocalDate;

  const [selectedLocalDate, setSelectedLocalDate] = useState(() => toLocalDate(nowUtcIso(), tz));

  const changeDay = (localDate: string) => {
    if (isSelectableDay(localDate, earliestLocalDate, todayLocalDate)) {
      setSelectedLocalDate(localDate);
    }
  };

  // "Ändern" auf der Schnelleingabe-Snackbar: innerhalb dieses Tabs direkt
  // gesetzt, vom ersten Tab aus über Navigationsparameter angefordert (die
  // Karte dort hat keinen Zugriff auf diesen lokalen State) — task 2026-09-23.
  const [quickEdit, setQuickEdit] = useState<QuickEditRequest | null>(null);
  const params = useLocalSearchParams<{ editKind?: string; editId?: string; editToken?: string }>();
  useEffect(() => {
    if (params.editKind && params.editId && params.editToken) {
      setQuickEdit({ kind: params.editKind as SchnellEditKind, id: params.editId, token: Number(params.editToken) });
    }
  }, [params.editKind, params.editId, params.editToken]);

  if (childLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const isViewingToday = selectedLocalDate === todayLocalDate;

  const feedingEdit =
    quickEdit && (quickEdit.kind === 'bottle' || quickEdit.kind === 'breast') ? quickEdit : null;
  const diaperEdit = quickEdit && quickEdit.kind === 'diaper' ? quickEdit : null;
  const medicationEdit = quickEdit && quickEdit.kind === 'medication' ? quickEdit : null;

  return (
    <ThemedView style={styles.container}>
      {/* Die Schnelleingabe-Leiste sitzt AUSSERHALB des scrollenden
          KeyboardSafeScreen, als eigener Fuß darunter — deshalb hier kein
          `hasTabBar` mehr auf KeyboardSafeScreen: der Reiterleisten-Abstand
          wird jetzt einmal, vom Fuß selbst, reserviert (Spacing.safeFooter
          unten), nicht mehr zusätzlich vom Scroll-Inhalt. */}
      <KeyboardSafeScreen style={styles.safeArea} contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          {child ? child.firstName : 'Heute'}
        </ThemedText>

        <DayNavigationHeader
          selectedLocalDate={selectedLocalDate}
          todayLocalDate={todayLocalDate}
          earliestLocalDate={earliestLocalDate}
          onChange={changeDay}
        />

        {!isViewingToday ? (
          <ThemedText type="small" themeColor="textSecondary">
            {formatBackfillHint(selectedLocalDate)}
          </ThemedText>
        ) : null}

        <ThemedText type="subtitle">Füttern</ThemedText>
        <FeedingSection
          child={child}
          session={session}
          tz={tz}
          tickingNow={tickingNow}
          selectedLocalDate={selectedLocalDate}
          requestedEdit={feedingEdit}
        />

        <ThemedText type="subtitle">Wickeln</ThemedText>
        <DiaperSection
          child={child}
          session={session}
          tz={tz}
          selectedLocalDate={selectedLocalDate}
          requestedEdit={diaperEdit}
        />

        <ThemedText type="subtitle">Medikamente & Vitamine</ThemedText>
        <MedicationSection
          child={child}
          session={session}
          tz={tz}
          selectedLocalDate={selectedLocalDate}
          requestedEdit={medicationEdit}
        />

        <ThemedText type="subtitle">Schlafen</ThemedText>
        <SleepSection
          child={child}
          session={session}
          tz={tz}
          tickingNow={tickingNow}
          selectedLocalDate={selectedLocalDate}
        />
      </KeyboardSafeScreen>

      <View style={[styles.schnellFooter, { paddingBottom: insets.bottom + BottomTabInset }]}>
        <SchnellLeiste
          child={child}
          session={session}
          tz={tz}
          selectedLocalDate={selectedLocalDate}
          todayLocalDate={todayLocalDate}
          onRequestEdit={(kind, id) => setQuickEdit({ kind, id, token: Date.now() })}
        />
      </View>
    </ThemedView>
  );
}

/**
 * "‹  Heute · Dienstag, 23. September 2026  ›  [Heute]" — day-navigation
 * header (task 2026-09-24). Tapping the label opens the same
 * `@expo/ui` `DateTimePicker` every other date field in this app already
 * uses (features/events/components/event-form.tsx,
 * features/people/components/person-form.tsx), bounded to
 * [earliestLocalDate, todayLocalDate] via `minimumDate`/`maximumDate` — and
 * re-checked with `isSelectableDay` before actually applying the pick, the
 * same belt-and-braces guard `changeDay` above already applies to the
 * arrows, in case a platform's native bounds enforcement ever disagrees.
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
  const canGoBack = isSelectableDay(
    addDaysToLocalDate(selectedLocalDate, -1),
    earliestLocalDate,
    todayLocalDate,
  );
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  // Fuß unter dem scrollenden Bereich, direkt über der Reiterleiste (task
  // 2026-09-23) — `paddingBottom` reserviert Safe-Area + Reiterleiste EINMAL
  // hier, nicht mehr zusätzlich im Scroll-Inhalt (siehe KeyboardSafeScreen
  // oben, jetzt ohne `hasTabBar`).
  schnellFooter: { paddingTop: Spacing.one },
  content: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dayNavArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNavArrowText: { fontSize: 24, fontWeight: '700' },
  dayNavLabel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one },
  dayNavToday: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
});
