/**
 * Einstellungen — account and sync status.
 *
 * These two rows previously sat at the bottom of the home screen because sync
 * problems had to be visible during bring-up (bug found 2026-08-08). Now that
 * the home screen is the photo chronology, they live here instead: still one tap
 * away, no longer in the way.
 */

import { usePowerSync, useStatus } from '@powersync/react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { connectPowerSync } from '@/core/db';
import { supabase } from '@/core/supabase';
import { useActiveChild } from '@/features/household/repository';
import { usePendingUploadCount } from '@/features/photos/repository';

function SyncStatusRow() {
  const status = useStatus();
  const db = usePowerSync();
  const [retrying, setRetrying] = useState(false);

  const connectionLabel = status.connected
    ? 'verbunden ✅'
    : status.connecting
      ? 'verbindet …'
      : 'getrennt ⚠️';
  const lastSynced = status.lastSyncedAt
    ? status.lastSyncedAt.toLocaleTimeString('de-DE')
    : 'noch nie';
  const errorMessage = status.uploadError?.message ?? status.downloadError?.message ?? null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await connectPowerSync(db);
    } catch (error) {
      console.error('[LifeBook] Manual PowerSync retry failed', error);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Synchronisierung</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {connectionLabel} · zuletzt: {lastSynced}
      </ThemedText>
      {errorMessage ? (
        <ThemedText type="small" style={styles.error}>
          {errorMessage}
        </ThemedText>
      ) : null}
      {!status.connected ? (
        <Pressable onPress={handleRetry} disabled={retrying} hitSlop={8}>
          <ThemedText type="linkPrimary">{retrying ? '…' : 'Jetzt erneut versuchen'}</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

function PhotoStatusRow() {
  const pending = usePendingUploadCount();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Fotos</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pending === 0
          ? 'Alle Fotos sind gesichert.'
          : pending === 1
            ? '1 Foto wartet noch auf die Übertragung.'
            : `${pending} Fotos warten noch auf die Übertragung.`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Originale werden standardmäßig nur im WLAN übertragen.
      </ThemedText>
    </ThemedView>
  );
}

function AccountRow() {
  const { session } = useAuth();
  const db = usePowerSync();
  const [signingOut, setSigningOut] = useState(false);

  if (!session) {
    return null;
  }

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await db.disconnect();
    } catch {
      // Best-effort: PowerSync may never have connected (e.g. offline) — sign-out
      // must proceed either way.
    }
    await supabase.auth.signOut();
    // No manual navigation: the root layout's redirect gate reacts to the
    // cleared session and switches back to (auth) automatically.
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Konto</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {session.user.email}
      </ThemedText>
      <Pressable onPress={handleSignOut} disabled={signingOut} hitSlop={8}>
        <ThemedText type="linkPrimary">{signingOut ? '…' : 'Abmelden'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

export default function EinstellungenScreen() {
  const { child } = useActiveChild();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">Einstellungen</ThemedText>

          {child ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Kind</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {child.firstName} · Zeitzone {child.birthTz}
              </ThemedText>
            </ThemedView>
          ) : null}

          <PhotoStatusRow />
          <SyncStatusRow />
          <AccountRow />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  content: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  error: { color: '#e0524c' },
});
