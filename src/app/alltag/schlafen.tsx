/**
 * Schlafen — volles Formular (task 2026-09-26), gleiche Bauform wie
 * fuettern.tsx in diesem Verzeichnis: eine Root-Stack-Route, erreichbar von
 * der Timer-Zeile "⏱ Schlaf" im Alltag-Tab, kein eigener Reiter.
 */

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { SleepSection } from '@/features/sleep/components/sleep-section';
import { KeyboardSafeScreen } from '@/ui';

export default function SchlafenScreen() {
  const { session } = useAuth();
  const { child } = useActiveChild();
  const tz = deviceTimeZone();
  const [tickingNow, setTickingNow] = useState(() => nowUtcIso());
  useEffect(() => {
    const id = setInterval(() => setTickingNow(nowUtcIso()), 1000);
    return () => clearInterval(id);
  }, []);

  const params = useLocalSearchParams<{ selectedLocalDate?: string; editId?: string; editToken?: string }>();
  const selectedLocalDate = params.selectedLocalDate ?? toLocalDate(tickingNow, tz);
  const requestedEdit = params.editId && params.editToken ? { id: params.editId, token: Number(params.editToken) } : null;

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
        <SleepSection
          child={child}
          session={session}
          tz={tz}
          tickingNow={tickingNow}
          selectedLocalDate={selectedLocalDate}
          requestedEdit={requestedEdit}
        />
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.five },
});
