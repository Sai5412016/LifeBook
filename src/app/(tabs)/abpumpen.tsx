/**
 * Abpumpen — heutige Menge, ein grosser Knopf, und die letzten 14 Tage.
 *
 * Bewusst KARG. Was dieser Tab absichtlich NICHT zeigt (Produktentscheidung,
 * keine Lücke): keine Zielmenge, keinen Sollwert, keinen Fortschrittsbalken,
 * keinen Prozentwert, keinen Vergleich mit gestern, keine Pfeile, keine
 * Streaks, keine Erfolgsmeldung — und in keiner der beiden Paletten einen
 * Rotton. Wer abpumpt, hat oft ohnehin das Gefühl, zu wenig zu schaffen; die
 * App zeigt die Zahl und bewertet sie nicht. Wer hier später "hilfreich"
 * einen Zielwert ergänzt, macht den Tab kaputt.
 *
 * Zwischen 22:00 und 06:00 schaltet der Tab auf eine eigene dunkle Palette,
 * unabhängig vom App-Theme — siehe features/pumping/night-mode.ts.
 */

import { usePowerSync } from '@powersync/react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { addDaysToLocalDate, formatDayLabel, formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { dailyTotals, dayTotal, rollingAverage } from '@/features/pumping/analytics';
import { PumpingEntrySheet, type PumpingEntryValues } from '@/features/pumping/components/pumping-entry-sheet';
import { usePumpingPalette } from '@/features/pumping/hooks/use-pumping-palette';
import {
  addPumpingSession,
  softDeletePumpingSession,
  usePumpingSessionsSince,
} from '@/features/pumping/repository';
import type { PumpingSessionRow } from '@/features/pumping/types';

/** How many days the list shows. */
const HISTORY_DAYS = 14;
/** Window of the average shown under today's number. */
const AVERAGE_DAYS = 7;
/** Every tap target on this screen (night-mode requirement). */
const TOUCH_TARGET = 48;

const SIDE_LABELS: Record<string, string> = { left: 'links', right: 'rechts', both: 'beide' };

export default function AbpumpenScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const { palette } = usePumpingPalette();
  const tz = deviceTimeZone();

  const today = toLocalDate(nowUtcIso(), tz);
  const firstDay = addDaysToLocalDate(today, -(HISTORY_DAYS - 1));
  const { sessions } = usePumpingSessionsSince(child?.childId, firstDay);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [lastPump, setLastPump] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * Optimistic rows: shown immediately on save, dropped again the moment
   * the same id arrives through the reactive query (or on a failure —
   * that is the rollback). Keeping them SEPARATE from the query result,
   * rather than editing a copy of it, is what makes the rollback a
   * one-line removal instead of a re-derivation.
   */
  const [optimistic, setOptimistic] = useState<PumpingSessionRow[]>([]);

  const merged = useMemo(() => {
    const known = new Set(sessions.map((row) => row.id));
    return [...optimistic.filter((row) => !known.has(row.id)), ...sessions];
  }, [sessions, optimistic]);

  const todayTotal = dayTotal(merged, today);
  const average = Math.round(rollingAverage(merged, today, AVERAGE_DAYS));
  const days = useMemo(
    () => [...dailyTotals(merged, firstDay, today)].reverse(),
    [merged, firstDay, today],
  );

  const lastUsedPump = lastPump ?? merged.find((row) => row.pump)?.pump ?? null;

  const handleSave = async (values: PumpingEntryValues) => {
    if (!child || !session) {
      return;
    }
    setSheetOpen(false);
    setSaveError(null);
    setLastPump(values.pump);

    const now = nowUtcIso();
    // Der optimistische Eintrag trägt dieselbe Tagesberechnung wie das
    // Repository, damit die Tagessumme sofort stimmt und nicht springt,
    // sobald die echte Zeile nachrückt.
    const optimisticRow: PumpingSessionRow = {
      id: `optimistic-${now}`,
      household_id: child.householdId,
      child_id: child.childId,
      occurred_at: now,
      tz,
      local_date: toLocalDate(now, tz),
      created_by: session.user.id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      source_device_id: null,
      note: values.note ?? null,
      side: values.side,
      amount_ml: values.amountMl,
      duration_s: values.durationS ?? null,
      is_running: 0,
      needs_review: 0,
      pump: values.pump,
    };
    setOptimistic((current) => [optimisticRow, ...current]);

    try {
      await addPumpingSession(db, {
        householdId: child.householdId,
        childId: child.childId,
        userId: session.user.id,
        tz,
        amountMl: values.amountMl,
        side: values.side,
        pump: values.pump,
        time: values.time,
        durationS: values.durationS,
        note: values.note,
      });
      // Die reaktive Abfrage liefert die echte Zeile; der Platzhalter kann weg.
      setOptimistic((current) => current.filter((row) => row.id !== optimisticRow.id));
    } catch (error) {
      console.error('[LifeBook] Abpump-Sitzung konnte nicht gespeichert werden', error);
      setOptimistic((current) => current.filter((row) => row.id !== optimisticRow.id));
      setSaveError('Nicht gespeichert. Bitte noch einmal versuchen.');
    }
  };

  const handleDelete = async (row: PumpingSessionRow) => {
    try {
      await softDeletePumpingSession(db, row.id);
    } catch (error) {
      console.error('[LifeBook] Abpump-Sitzung konnte nicht gelöscht werden', error);
      setSaveError('Nicht gelöscht. Bitte noch einmal versuchen.');
    }
  };

  if (childLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Oben: die eine Zahl, die zählt. */}
        <View style={styles.header}>
          <View style={styles.totalRow}>
            <ThemedText style={[styles.total, { color: palette.text }]}>{todayTotal}</ThemedText>
            <ThemedText style={[styles.totalUnit, { color: palette.textSecondary }]}>ml</ThemedText>
          </View>
          <ThemedText style={[styles.average, { color: palette.textSecondary }]}>
            {`Ø ${AVERAGE_DAYS} Tage: ${average} ml`}
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sitzung eintragen"
          disabled={!child || !session}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: pressed ? palette.surfacePressed : palette.accent,
              opacity: child && session ? 1 : 0.4,
            },
          ]}>
          <ThemedText style={[styles.primaryLabel, { color: palette.accentText }]}>
            Sitzung eintragen
          </ThemedText>
        </Pressable>

        {saveError ? (
          <ThemedText style={{ color: palette.textSecondary }}>{saveError}</ThemedText>
        ) : null}

        {/* Unten: 14 Tage, neuester zuerst. Einzelsitzungen erst nach Antippen. */}
        <View style={styles.list}>
          {days.map((day) => {
            const expanded = expandedDay === day.localDate;
            const daySessions = merged
              .filter((row) => row.local_date === day.localDate)
              .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

            return (
              <View key={day.localDate}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${formatDayLabel(day.localDate)}, ${day.totalMl} Milliliter`}
                  onPress={() => setExpandedDay(expanded ? null : day.localDate)}
                  style={({ pressed }) => [
                    styles.dayRow,
                    {
                      backgroundColor: pressed ? palette.surfacePressed : palette.surface,
                      borderColor: palette.border,
                    },
                  ]}>
                  <ThemedText style={{ color: palette.text }}>
                    {formatDayLabel(day.localDate)}
                  </ThemedText>
                  <ThemedText style={{ color: palette.text }}>{day.totalMl} ml</ThemedText>
                </Pressable>

                {expanded ? (
                  <View style={styles.sessionList}>
                    {daySessions.length === 0 ? (
                      <ThemedText style={[styles.sessionEmpty, { color: palette.textSecondary }]}>
                        Keine Sitzung an diesem Tag.
                      </ThemedText>
                    ) : (
                      daySessions.map((row) => (
                        <Pressable
                          key={row.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Sitzung ${formatTimeLabel(row.occurred_at, row.tz)}, ${row.amount_ml ?? 0} Milliliter. Lange drücken zum Löschen.`}
                          onLongPress={() => void handleDelete(row)}
                          style={({ pressed }) => [
                            styles.sessionRow,
                            {
                              backgroundColor: pressed ? palette.surfacePressed : 'transparent',
                              borderColor: palette.border,
                            },
                          ]}>
                          <ThemedText style={{ color: palette.textSecondary }}>
                            {formatTimeLabel(row.occurred_at, row.tz)}
                            {row.side ? ` · ${SIDE_LABELS[row.side] ?? row.side}` : ''}
                            {row.pump ? ` · ${row.pump}` : ''}
                          </ThemedText>
                          <ThemedText style={{ color: palette.text }}>{row.amount_ml ?? 0} ml</ThemedText>
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <PumpingEntrySheet
        visible={sheetOpen}
        palette={palette}
        initialPump={lastUsedPump}
        nowHhMm={formatTimeLabel(nowUtcIso(), tz)}
        onCancel={() => setSheetOpen(false)}
        onSave={(values) => void handleSave(values)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.three,
  },
  header: { alignItems: 'center', gap: Spacing.one },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  total: { fontSize: 72, lineHeight: 80, fontWeight: '700' },
  totalUnit: { fontSize: 24 },
  average: { fontSize: 14 },
  primaryButton: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
  },
  primaryLabel: { fontSize: 20, fontWeight: '700' },
  list: { gap: Spacing.one },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  sessionList: { paddingLeft: Spacing.three, paddingTop: Spacing.one, gap: Spacing.one },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  sessionEmpty: { minHeight: TOUCH_TARGET, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
});
