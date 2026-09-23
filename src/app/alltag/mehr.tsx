/**
 * Mehr — Wickeln und Medikamente & Vitamine, vollständig (task 2026-09-26).
 * Der neue Alltag-Tab zeigt für diese beiden keinen eigenen Bereich mehr
 * (Windeln haben keinen Timer, gehören also nicht in die Timer-Zeile;
 * Medikamente ebenso) — "Mehr …" in der Timer-Zeile öffnet sie hier,
 * vollständig erhalten, eine Root-Stack-Route wie fuettern.tsx/schlafen.tsx
 * daneben. `editKind`/`editId`/`editToken` kommen optional als
 * Navigationsparameter (vom Tagesverlauf-Tipp auf eine Windel/Gabe).
 */

import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { DiaperSection } from '@/features/diaper/components/diaper-section';
import { useActiveChild } from '@/features/household/repository';
import { MedicationSection } from '@/features/medication/components/medication-section';
import { KeyboardSafeScreen } from '@/ui';

export default function MehrScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();
  const tz = deviceTimeZone();

  const params = useLocalSearchParams<{
    selectedLocalDate?: string;
    editKind?: string;
    editId?: string;
    editToken?: string;
  }>();
  // Kein tickendes "jetzt" nötig: weder Wickeln noch Medikamente zeigen
  // hier eine laufende Uhr — nur der Fallback-Tag, falls kein
  // selectedLocalDate-Parameter mitkam.
  const selectedLocalDate = params.selectedLocalDate ?? toLocalDate(nowUtcIso(), tz);
  const requestedEdit =
    params.editId && params.editToken ? { id: params.editId, token: Number(params.editToken) } : null;
  const diaperEdit = params.editKind === 'diaper' ? requestedEdit : null;
  const medicationEdit = params.editKind === 'medication' ? requestedEdit : null;

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
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
