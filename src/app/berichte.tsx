/**
 * Berichte — Wochen-/Monatsbericht über alle erfassten Daten, plus
 * CSV-Export. Erreichbar über den Listeneintrag "Berichte & Export" auf der
 * Startseite (app/(tabs)/index.tsx). Die Rechenlogik ist rein und getestet
 * (features/berichte/logic.ts); dieser Bildschirm liest nur die passenden
 * Zeitraum-Daten über Bereichs-Hooks und rendert das Ergebnis.
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useDiapersInRange } from '@/features/diaper/repository';
import { useFeedsInRange } from '@/features/feeding/repository';
import { useGrowthInRange } from '@/features/growth/repository';
import { useActiveChild } from '@/features/household/repository';
import { useGabenInRange } from '@/features/medication/repository';
import { useSleepsInRange } from '@/features/sleep/repository';
import { BerichteExportError, exportBerichte } from '@/features/berichte/export';
import {
  berichtBerechnen,
  canGoToNextPeriod,
  formatBerichtZahl,
  formatMedicationGapLabel,
  formatMissingDaysLabel,
  formatMlProFlasche,
  formatZeitraumLabel,
  verschobenerAnker,
  zeitraumTage,
} from '@/features/berichte/logic';
import type { BerichtZeitraumArt } from '@/features/berichte/logic';
import { Chip, useUiColors } from '@/ui';

export default function BerichteScreen() {
  const db = usePowerSync();
  const { child, isLoading: childLoading } = useActiveChild();
  const { warningBg, warningText, dangerText } = useUiColors();
  const tz = deviceTimeZone();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);

  const [art, setArt] = useState<BerichtZeitraumArt>('woche');
  const [ankerDatum, setAnkerDatum] = useState(() => toLocalDate(nowUtcIso(), tz));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const tage = useMemo(() => zeitraumTage(art, ankerDatum), [art, ankerDatum]);
  const fromLocalDate = tage[0];
  const toDate = tage[tage.length - 1];

  const feeds = useFeedsInRange(child?.childId, fromLocalDate, toDate);
  const diapers = useDiapersInRange(child?.childId, fromLocalDate, toDate);
  const sleeps = useSleepsInRange(child?.childId, fromLocalDate, toDate);
  const medications = useGabenInRange(child?.childId, fromLocalDate, toDate);
  const growthMeasurements = useGrowthInRange(child?.childId, fromLocalDate, toDate);

  const bericht = useMemo(
    () => berichtBerechnen(tage, { feeds, diapers, sleeps, medications, growthMeasurements }, todayLocalDate),
    [tage, feeds, diapers, sleeps, medications, growthMeasurements, todayLocalDate],
  );

  const canGoNext = canGoToNextPeriod(tage, todayLocalDate);
  const zeitraumLabel = formatZeitraumLabel(art, tage);

  const handleExport = async () => {
    if (!child) {
      return;
    }
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      await exportBerichte(db, child.childId, child.birthAtUtcIso, child.birthTz, tz);
      setExportMessage('Export geöffnet.');
    } catch (error) {
      setExportError(
        error instanceof BerichteExportError
          ? error.message
          : 'Export fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setExporting(false);
    }
  };

  if (childLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Berichte</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.artRow}>
            <Chip label="Woche" selected={art === 'woche'} onPress={() => setArt('woche')} />
            <Chip label="Monat" selected={art === 'monat'} onPress={() => setArt('monat')} />
          </View>

          <View style={styles.periodNav}>
            <Pressable
              onPress={() => setAnkerDatum(verschobenerAnker(art, ankerDatum, -1))}
              hitSlop={12}
              style={styles.periodArrow}
              accessibilityLabel="Vorheriger Zeitraum">
              <ThemedText style={styles.periodArrowText}>‹</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" style={styles.periodLabel} numberOfLines={1}>
              {zeitraumLabel}
            </ThemedText>
            <Pressable
              onPress={() => {
                if (canGoNext) {
                  setAnkerDatum(verschobenerAnker(art, ankerDatum, 1));
                }
              }}
              disabled={!canGoNext}
              hitSlop={12}
              style={styles.periodArrow}
              accessibilityLabel="Nächster Zeitraum">
              <ThemedText themeColor={canGoNext ? undefined : 'textSecondary'} style={styles.periodArrowText}>
                ›
              </ThemedText>
            </Pressable>
          </View>

          <Pressable onPress={() => void handleExport()} disabled={exporting || !child}>
            <ThemedView type="backgroundElement" style={styles.exportRow}>
              <ThemedText type="linkPrimary">{exporting ? 'Exportiere …' : 'Exportieren'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Fünf CSV-Dateien seit der Geburt
              </ThemedText>
            </ThemedView>
          </Pressable>
          {exportError ? (
            <ThemedText type="small" style={{ color: dangerText }}>
              {exportError}
            </ThemedText>
          ) : null}
          {exportMessage ? (
            <ThemedText type="small" themeColor="textSecondary">
              {exportMessage}
            </ThemedText>
          ) : null}

          <ReportSection title="Füttern">
            {bericht.feeding.count === 0 ? (
              <EmptyLine />
            ) : (
              <>
                <StatLine label="Mahlzeiten gesamt" value={formatBerichtZahl(bericht.feeding.count)} />
                <StatLine label="Ø Mahlzeiten pro Tag" value={formatBerichtZahl(bericht.feeding.avgPerDay)} />
                <StatLine label="Menge gesamt (ml)" value={formatBerichtZahl(bericht.feeding.totalMl)} />
                <StatLine label="Ø ml pro Tag" value={formatBerichtZahl(bericht.feeding.avgMlPerDay)} />
                <StatLine label="Ø ml je Flasche" value={formatMlProFlasche(bericht.feeding.avgMlPerBottle)} />
                {/* Nur anzeigen, wenn im Zeitraum tatsächlich gestillt wurde
                    (task 2026-09-26: Marina wird ausschließlich mit der
                    Flasche ernährt) — ausgeblendet, nicht herausgerechnet:
                    berichtBerechnen selbst bleibt unverändert, inklusive
                    seiner Stillen-Zählung, für eine mögliche spätere
                    Wiederaufnahme (Geschwisterkind). */}
                {bericht.feeding.totalBreastMinutes > 0 ? (
                  <>
                    <StatLine
                      label="Stilldauer gesamt (min)"
                      value={formatBerichtZahl(bericht.feeding.totalBreastMinutes)}
                    />
                    <StatLine
                      label="Ø Stillminuten pro Tag"
                      value={formatBerichtZahl(bericht.feeding.avgBreastMinutesPerDay)}
                    />
                  </>
                ) : null}
              </>
            )}
          </ReportSection>

          <ReportSection title="Wickeln">
            {bericht.diapers.count === 0 ? (
              <EmptyLine />
            ) : (
              <>
                <StatLine label="Nass gesamt" value={formatBerichtZahl(bericht.diapers.totalWet)} />
                <StatLine label="Ø nass pro Tag" value={formatBerichtZahl(bericht.diapers.avgWetPerDay)} />
                <StatLine label="Stuhl gesamt" value={formatBerichtZahl(bericht.diapers.totalDirty)} />
                <StatLine label="Ø Stuhl pro Tag" value={formatBerichtZahl(bericht.diapers.avgDirtyPerDay)} />
              </>
            )}
          </ReportSection>

          <ReportSection title="Schlaf">
            {bericht.sleep.count === 0 ? (
              <EmptyLine />
            ) : (
              <>
                <StatLine label="Gesamtdauer (min)" value={formatBerichtZahl(bericht.sleep.totalMinutes)} />
                <StatLine label="Ø Minuten pro Tag" value={formatBerichtZahl(bericht.sleep.avgMinutesPerDay)} />
                <StatLine label="Längste Phase (min)" value={formatBerichtZahl(bericht.sleep.longestMinutes)} />
              </>
            )}
          </ReportSection>

          <ReportSection title="Medikamente">
            {bericht.medications.length === 0 ? (
              <EmptyLine />
            ) : (
              bericht.medications.map((entry) => (
                <View key={entry.name} style={styles.medicationBlock}>
                  <View style={styles.statLine}>
                    <ThemedText type="small">{entry.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatBerichtZahl(entry.countInPeriod)}×
                    </ThemedText>
                  </View>
                  {entry.missingDays.length > 0 ? (
                    <ThemedView style={[styles.gapRow, { backgroundColor: warningBg }]}>
                      <ThemedText type="small" style={{ color: warningText }}>
                        {formatMedicationGapLabel(entry.missingDays)}
                      </ThemedText>
                    </ThemedView>
                  ) : null}
                </View>
              ))
            )}
          </ReportSection>

          <ReportSection title="Gewicht">
            {bericht.growth.firstWeightG === null ? (
              <EmptyLine />
            ) : (
              <>
                <StatLine label="Erster Wert (g)" value={formatBerichtZahl(bericht.growth.firstWeightG)} />
                <StatLine label="Letzter Wert (g)" value={formatBerichtZahl(bericht.growth.lastWeightG)} />
                <StatLine label="Differenz (g)" value={formatBerichtZahl(bericht.growth.diffG)} />
              </>
            )}
          </ReportSection>

          <ReportSection title="Erfassung">
            <ThemedText type="small" themeColor="textSecondary">
              {bericht.tageOhneEintrag.length === 0
                ? 'Jeden Tag mindestens ein Eintrag.'
                : formatMissingDaysLabel(bericht.tageOhneEintrag)}
            </ThemedText>
          </ReportSection>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statLine}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

function EmptyLine() {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Keine Einträge in diesem Zeitraum
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerSpacer: { width: 48 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  artRow: { flexDirection: 'row', gap: Spacing.two },
  periodNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  periodArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  periodArrowText: { fontSize: 24, fontWeight: '700' },
  periodLabel: { flex: 1, textAlign: 'center' },
  exportRow: {
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  section: { gap: Spacing.one },
  statLine: { flexDirection: 'row', justifyContent: 'space-between' },
  medicationBlock: { gap: Spacing.half, paddingBottom: Spacing.one },
  gapRow: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
});
