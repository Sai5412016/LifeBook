/**
 * Einstellungen — account and sync status.
 *
 * These two rows previously sat at the bottom of the home screen because sync
 * problems had to be visible during bring-up (bug found 2026-08-08). Now that
 * the home screen is the photo chronology, they live here instead: still one tap
 * away, no longer in the way.
 *
 * ROUTE MOVED HERE 2026-08-13 (was src/app/(tabs)/explore.tsx)
 * ---------------------------------------------------------------
 * The gear icon on the home screen (and now Chronik too) navigated to
 * `/explore`, and nothing happened — no crash, no navigation, no error.
 * Root cause, traced in the installed `expo-router` package itself
 * (build/layouts/withLayoutContext.js#useSortedScreens): `NativeTabs` is
 * built with `useOnlyUserDefinedScreens = true`, which means ANY route file
 * inside a `NativeTabs` layout directory that has no corresponding
 * `<NativeTabs.Trigger>` is filtered out of that navigator's screens
 * entirely — not just hidden from the tab bar, genuinely unreachable via
 * `router.push`, silently. This was true even for a Trigger with an
 * explicit `hidden` prop (it still lands in `protectedScreens`, which this
 * code path never re-includes). `explore.tsx` lost its Trigger when
 * settings left the tab bar (commit 02f8717) and became exactly that: a
 * file that exists but the tab navigator has never heard of.
 *
 * Fix: this screen now lives OUTSIDE the `(tabs)` group, as a plain
 * root-level stack route — the same pattern `kind/bearbeiten.tsx` and
 * `menschen/*` already use successfully. A stack screen has no such
 * Trigger requirement.
 */

import { usePowerSync, useStatus } from '@powersync/react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { connectPowerSync } from '@/core/db';
import {
  describeExecutionEnvironment,
  describeProjectIdSource,
  describePushPermissionStatus,
  describeRegistrationRunStatus,
  describeTokenPresence,
  getPushPermissionStatus,
  hasPushTokenRegistered,
  registerForPushNotifications,
  unregisterPushToken,
  usePushDiagnostics,
  type PushPermissionStatus,
} from '@/core/notifications';
import { supabase } from '@/core/supabase';
import { formatTimeLabel } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { formatMediumBackfillLabel } from '@/features/photos/identity';
import { useMediumBackfillProgress, usePendingUploadCount } from '@/features/photos/repository';

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
        <ThemedText type="small" themeColor="dangerText">
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
  const backfillLabel = formatMediumBackfillLabel(useMediumBackfillProgress());

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
      {backfillLabel ? (
        <ThemedText type="small" themeColor="textSecondary">
          {backfillLabel}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

/**
 * Shows the FULL push-registration diagnosis, not just "Fehlt" — that one
 * word used to collapse "never attempted" and "attempted and failed" into
 * the same reading, and gave no way to get a fresh error without
 * restarting the app (registration only otherwise runs once, right after
 * sign-in). See core/notifications/diagnostics.ts for what each field means.
 *
 * Reads the OS permission directly rather than any stored app state, so it
 * always reflects reality even if the parent changed it in the system
 * settings since the app last asked.
 *
 * "Schlüssel gespeichert" starts from a live database read (a token from an
 * earlier app session is still real even if nothing ran this session), then
 * switches to whatever this session's own attempt just found — the more
 * current of the two.
 */
function NotificationStatusRow() {
  const { session } = useAuth();
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [dbTokenPresent, setDbTokenPresent] = useState<boolean | null>(null);
  const diagnostics = usePushDiagnostics();

  const refreshStatus = useCallback(() => {
    getPushPermissionStatus().then(setStatus);
  }, []);

  const refreshDbTokenPresent = useCallback(() => {
    if (!session) {
      return;
    }
    hasPushTokenRegistered(session.user.id).then(({ present, error }) => {
      setDbTokenPresent(present);
      if (error) {
        // hasPushTokenRegistered returns its error rather than throwing, and
        // this screen is its only caller — logged the same way SyncStatusRow
        // above logs its own retry failures.
        console.error('[LifeBook] Push-Token-Prüfung fehlgeschlagen', error);
      }
    });
  }, [session]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    refreshDbTokenPresent();
  }, [refreshDbTokenPresent]);

  if (!session) {
    return null;
  }

  const handleRetryRegistration = async () => {
    setRequesting(true);
    try {
      await registerForPushNotifications(session.user.id);
    } finally {
      setRequesting(false);
      refreshStatus();
      refreshDbTokenPresent();
    }
  };

  const tokenPresent = diagnostics.tokenPresent ?? dbTokenPresent;
  const lastCheckedLabel = diagnostics.lastCheckedAt
    ? formatTimeLabel(diagnostics.lastCheckedAt, deviceTimeZone())
    : 'noch nie';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Benachrichtigungen</ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        Registrierung: {describeRegistrationRunStatus(diagnostics.runStatus)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Berechtigung: {status ? describePushPermissionStatus(status) : 'Wird geprüft …'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Build-Typ: {describeExecutionEnvironment(diagnostics.executionEnvironment)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Projekt-ID: {diagnostics.projectId ?? 'leer'}
        {diagnostics.projectId && diagnostics.projectIdSource
          ? ` (${describeProjectIdSource(diagnostics.projectIdSource)})`
          : ''}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Schlüssel von Expo: {describeTokenPresence(diagnostics.tokenFetched)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Schlüssel in der Datenbank: {describeTokenPresence(tokenPresent)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Zuletzt geprüft: {lastCheckedLabel}
      </ThemedText>

      {diagnostics.lastError ? (
        <ThemedText type="small" themeColor="dangerText" style={styles.errorText}>
          Letzter Fehler: {diagnostics.lastError}
        </ThemedText>
      ) : null}
      {diagnostics.tokenWriteError ? (
        <ThemedText type="small" themeColor="dangerText" style={styles.errorText}>
          Schlüssel kam an, Speichern in der Datenbank scheiterte: {diagnostics.tokenWriteError}
        </ThemedText>
      ) : null}

      <Pressable onPress={handleRetryRegistration} disabled={requesting} hitSlop={8}>
        {requesting ? (
          <ActivityIndicator />
        ) : (
          <ThemedText type="linkPrimary">Registrierung erneut versuchen</ThemedText>
        )}
      </Pressable>
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
    // Must run BEFORE signOut(): removing this device's push token needs the
    // still-valid session (push_tokens' access rule is "only your own rows").
    await unregisterPushToken(session.user.id);
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
          <NotificationStatusRow />
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
    // No BottomTabInset here anymore: as a root-level stack screen (see the
    // module doc comment) this covers the tab bar entirely when pushed,
    // exactly like kind/bearbeiten.tsx and menschen/* already do.
    paddingBottom: Spacing.five,
  },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  // No numberOfLines / ellipsizeMode anywhere here on purpose — this is the
  // full, unabridged error text, not a preview of it.
  errorText: { marginTop: Spacing.one },
});
