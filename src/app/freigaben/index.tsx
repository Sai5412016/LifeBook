/**
 * Freigaben — overview of every guest-access share of this household.
 * Entry point: the "Freigaben" row in Einstellungen. Stufe 1 of guest
 * access (create/manage shares); the viewing page a link leads to is
 * Stufe 2, not built yet.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useActiveChild } from '@/features/household/repository';
import { describeShareState, formatDeviceCountLabel, formatPhotoCountLabel } from '@/features/shares/logic';
import { listShareSummaries } from '@/features/shares/repository';
import type { ShareSummary } from '@/features/shares/types';
import { Button, useUiColors } from '@/ui';

export default function FreigabenScreen() {
  const { child } = useActiveChild();
  const { accent } = useUiColors();

  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!child) {
      return;
    }
    setLoading(true);
    setError(null);
    listShareSummaries(child.householdId)
      .then(setShares)
      .catch((loadError: unknown) => {
        console.error('[LifeBook] Freigaben konnten nicht geladen werden', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
      })
      .finally(() => setLoading(false));
  }, [child]);

  // Neu laden bei jedem Aufruf dieses Bildschirms — z. B. nach dem Anlegen
  // oder Löschen einer Freigabe auf einem darüberliegenden Bildschirm.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Freigaben</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            Freigaben teilen ausgewählte Fotos über einen Link und einen Zugangscode — ohne dass die
            Empfänger die App installieren müssen.
          </ThemedText>

          <Button label="Freigabe anlegen" onPress={() => router.push('/freigaben/neu')} disabled={!child} />

          {loading ? <ActivityIndicator style={styles.spinner} /> : null}

          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          {!loading && shares && shares.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Freigaben angelegt.
            </ThemedText>
          ) : null}

          {(shares ?? []).map((share) => (
            <Pressable key={share.id} onPress={() => router.push(`/freigaben/${share.id}`)}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">{share.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatPhotoCountLabel(share.photoCount)} · {formatDeviceCountLabel(share.deviceCount, share.device_limit)}
                </ThemedText>
                <ThemedText
                  type="small"
                  themeColor={share.revoked_at ? 'dangerText' : undefined}
                  style={!share.revoked_at ? { color: accent } : undefined}>
                  {describeShareState(share.revoked_at)}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  spinner: { marginTop: Spacing.two },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
