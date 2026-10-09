/**
 * Medikamentenplan — eigener Bildschirm (task 2026-10-09). Erreichbar aus der
 * Medikamenten-Auswahl der Schnellleiste ("Plan …") und, als Abschnitt, auch
 * unter "Mehr …". Eigener Bildschirm statt nur ein Abschnitt am Ende einer
 * langen Seite, damit der Plan ohne Scrollen auffindbar ist.
 */

import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { MedicationPlanSection } from '@/features/medication-plan/components/medication-plan-section';
import { KeyboardSafeScreen } from '@/ui';

export default function MedikamentenplanScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();
  const tz = deviceTimeZone();

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Medikamentenplan</ThemedText>
        <MedicationPlanSection child={child} session={session} tz={tz} />
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
});
