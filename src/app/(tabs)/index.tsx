/**
 * Heute — the start screen (Stufe 4). One screen, one section per tracking
 * feature — Füttern first (needed ten times a day), Wickeln next. Each
 * section owns its own data and state; this file only supplies the shared
 * shell (child, session, device timezone, the live clock) and lays the
 * sections out one after another.
 *
 * Route "index": this is the app's launch screen — see components/app-tabs.tsx.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { nowUtcIso } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { DiaperSection } from '@/features/diaper/components/diaper-section';
import { FeedingSection } from '@/features/feeding/components/feeding-section';
import { useActiveChild } from '@/features/household/repository';
import { SleepSection } from '@/features/sleep/components/sleep-section';

/** Ticks every second so Füttern's running timer and "vor …" labels stay live. */
function useTickingNow(): string {
  const [now, setNow] = useState(() => nowUtcIso());

  useEffect(() => {
    const id = setInterval(() => setNow(nowUtcIso()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export default function HeuteScreen() {
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const tz = deviceTimeZone();
  const tickingNow = useTickingNow();

  if (childLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            {child ? child.firstName : 'Heute'}
          </ThemedText>

          <ThemedText type="subtitle">Füttern</ThemedText>
          <FeedingSection child={child} session={session} tz={tz} tickingNow={tickingNow} />

          <ThemedText type="subtitle">Wickeln</ThemedText>
          <DiaperSection child={child} session={session} tz={tz} />

          <ThemedText type="subtitle">Schlafen</ThemedText>
          <SleepSection child={child} session={session} tz={tz} tickingNow={tickingNow} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  content: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
});
