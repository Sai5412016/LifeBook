/**
 * Mehr — Füttern, Wickeln und Medikamente & Vitamine, vollständig (task
 * 2026-09-26). Füttern zog HIERHER (war zuvor eine eigene Route,
 * fuettern.tsx, gelöscht): seit "Stillen" aus der Bedienung entfernt ist,
 * hat Füttern keinen Timer mehr (nur noch Fläschchen + Tagesliste +
 * Korrekturen) und gehört damit konzeptionell zu "alle übrigen
 * ausführlichen Formulare ohne eigenen Timer" — die Timer-Zeile im
 * Alltag-Tab zeigt seither nur noch "⏱ Schlaf" und "Mehr …", kein "⏱
 * Stillen" mehr. `editKind`/`editId`/`editToken` kommen optional als
 * Navigationsparameter (vom Tagesverlauf-Tipp auf eine Mahlzeit/Windel/Gabe,
 * oder von der Schnelleingabe-Snackbar's "Ändern").
 */

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { DiaperSection } from '@/features/diaper/components/diaper-section';
import { FeedingSection } from '@/features/feeding/components/feeding-section';
import { useActiveChild } from '@/features/household/repository';
import { MedicationSection } from '@/features/medication/components/medication-section';
import { KeyboardSafeScreen } from '@/ui';

export default function MehrScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();
  const tz = deviceTimeZone();
  // Füttern braucht ein tickendes "jetzt" (ein offener Feed aus dem
  // Sicherheitsnetz, siehe feeding-section.tsx, zeigt seine Tagesliste-Zeile
  // live an) — Wickeln/Medikamente brauchen das nicht, teilen sich den Wert
  // aber unschädlich mit.
  const [tickingNow, setTickingNow] = useState(() => nowUtcIso());
  useEffect(() => {
    const id = setInterval(() => setTickingNow(nowUtcIso()), 1000);
    return () => clearInterval(id);
  }, []);

  const params = useLocalSearchParams<{
    selectedLocalDate?: string;
    editKind?: string;
    editId?: string;
    editToken?: string;
  }>();
  const selectedLocalDate = params.selectedLocalDate ?? toLocalDate(tickingNow, tz);
  const requestedEdit =
    params.editId && params.editToken ? { id: params.editId, token: Number(params.editToken) } : null;
  const feedingEdit = params.editKind === 'feed' ? requestedEdit : null;
  const diaperEdit = params.editKind === 'diaper' ? requestedEdit : null;
  const medicationEdit = params.editKind === 'medication' ? requestedEdit : null;

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
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
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
});
