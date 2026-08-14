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
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet } from 'react-native';
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
import { useIsOnWifi } from '@/features/photos/hooks';
import {
  formatMediumBackfillConfirmation,
  formatMediumBackfillLabel,
  formatPhotoBackupConfirmation,
  formatPhotoBackupStatusLabel,
  selectMediumBackfillCandidates,
  selectPhotoBackupCandidates,
  startMediumBackfillRun,
  startPhotoBackupRun,
  type MediumBackfillRunState,
  type PhotoBackupRunState,
} from '@/features/photos/identity';
import {
  useLastPhotoBackupAt,
  useMediumBackfillCandidatePhotos,
  useMediumBackfillProgress,
  usePendingUploadCount,
  usePhotoBackupCandidatePhotos,
} from '@/features/photos/repository';
import {
  cancelMediumBackfillRun,
  cancelPhotoBackupRun,
  runMediumBackfill,
  runPhotoBackup,
} from '@/features/photos/storage';
import { useTrashCleanupDiagnostics } from '@/features/photos/trashDiagnostics';

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

/**
 * The "Alle Fotos vorbereiten" batch run, plus the WLAN gating, confirmation
 * dialog, live progress, cancel button, and end-of-run failure summary
 * around it. The actual queue/step/stop DECISIONS all live in
 * identity.ts's MediumBackfillRunState and storage.ts#runMediumBackfill —
 * this component only wires them to the screen.
 */
function PhotoStatusRow() {
  const db = usePowerSync();
  const pending = usePendingUploadCount();
  const backfillLabel = formatMediumBackfillLabel(useMediumBackfillProgress());
  const candidates = useMediumBackfillCandidatePhotos();
  const onWifi = useIsOnWifi();
  const trashDiagnostics = useTrashCleanupDiagnostics();
  const backupCandidates = usePhotoBackupCandidatePhotos();
  const lastBackupAtUtcIso = useLastPhotoBackupAt();

  const [runState, setRunState] = useState<MediumBackfillRunState | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  // Synchronous guard against a double-start in the gap between the button
  // press and `runState` actually committing — belt-and-braces alongside
  // storage.ts's own module-level lock and the button simply not being
  // rendered anywhere `runState` is already set.
  const runningRef = useRef(false);

  const [backupRunState, setBackupRunState] = useState<PhotoBackupRunState | null>(null);
  const [backupResultMessage, setBackupResultMessage] = useState<string | null>(null);
  const backupRunningRef = useRef(false);

  // Verlässt man Einstellungen …
  useFocusEffect(
    useCallback(() => {
      return () => {
        cancelMediumBackfillRun();
        cancelPhotoBackupRun();
      };
    }, []),
  );

  // … oder geht die App in den Hintergrund: beides beendet den Lauf sauber,
  // statt zu versuchen, Hintergrundarbeit zu erzwingen, die Android ohnehin
  // stoppt.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        cancelMediumBackfillRun();
        cancelPhotoBackupRun();
      }
    });
    return () => subscription.remove();
  }, []);

  const handleStartAll = useCallback(async () => {
    if (runningRef.current || candidates.length === 0) {
      return;
    }
    runningRef.current = true;
    setResultMessage(null);
    setRunState(startMediumBackfillRun(candidates.map((photo) => photo.id)));
    try {
      const result = await runMediumBackfill(db, candidates, setRunState);
      if (result.failed > 0) {
        setResultMessage(
          result.failed === 1
            ? '1 Foto konnte nicht vorbereitet werden.'
            : `${result.failed} Fotos konnten nicht vorbereitet werden.`,
        );
      }
    } catch (error) {
      console.error('[LifeBook] Sammellauf zum Vorbereiten fehlgeschlagen', error);
    } finally {
      runningRef.current = false;
      setRunState(null);
    }
  }, [db, candidates]);

  const handleConfirmStartAll = useCallback(() => {
    if (runningRef.current || candidates.length === 0) {
      return;
    }
    // Der Schätzwert kommt aus der tatsächlichen Durchschnittsgröße der
    // offenen Fotos, nicht aus einer Annahme — siehe
    // identity.ts#selectMediumBackfillCandidates.
    const { averageOriginalBytes } = selectMediumBackfillCandidates(candidates);
    Alert.alert(
      'Alle Fotos vorbereiten?',
      formatMediumBackfillConfirmation(candidates.length, averageOriginalBytes),
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Vorbereiten', onPress: () => void handleStartAll() },
      ],
    );
  }, [candidates, handleStartAll]);

  const handleStartBackup = useCallback(async () => {
    if (backupRunningRef.current || backupCandidates.length === 0) {
      return;
    }
    backupRunningRef.current = true;
    setBackupResultMessage(null);
    setBackupRunState(startPhotoBackupRun(backupCandidates.map((photo) => photo.id)));
    try {
      const result = await runPhotoBackup(db, backupCandidates, setBackupRunState);
      if (result.failed > 0) {
        setBackupResultMessage(
          result.failed === 1
            ? '1 Foto konnte nicht gesichert werden.'
            : `${result.failed} Fotos konnten nicht gesichert werden.`,
        );
      }
    } catch (error) {
      // Deckt auch eine abgelehnte Galerie-Berechtigung ab
      // (storage.ts#runPhotoBackup wirft dafür einen eigenen Fehler) — sonst
      // bliebe der Knopf ohne jede Rückmeldung stumm.
      console.error('[LifeBook] Sammellauf zum Sichern fehlgeschlagen', error);
      setBackupResultMessage(
        error instanceof Error ? error.message : 'Sichern fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      backupRunningRef.current = false;
      setBackupRunState(null);
    }
  }, [db, backupCandidates]);

  const handleConfirmStartBackup = useCallback(() => {
    if (backupRunningRef.current || backupCandidates.length === 0) {
      return;
    }
    // Derselbe Schätzwert-Ansatz wie beim Vorbereiten — aus der
    // tatsächlichen Durchschnittsgröße der offenen Fotos, nicht geraten.
    const { averageOriginalBytes } = selectPhotoBackupCandidates(backupCandidates);
    Alert.alert(
      'Alle Fotos sichern?',
      formatPhotoBackupConfirmation(backupCandidates.length, averageOriginalBytes),
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Sichern', onPress: () => void handleStartBackup() },
      ],
    );
  }, [backupCandidates, handleStartBackup]);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Fotos</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pending === 0
          ? 'Alle Fotos sind hochgeladen.'
          : pending === 1
            ? '1 Foto wartet noch auf die Übertragung.'
            : `${pending} Fotos warten noch auf die Übertragung.`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Originale werden standardmäßig nur im WLAN übertragen.
      </ThemedText>
      {backfillLabel ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {runState ? `Vorbereitet: ${runState.succeeded + runState.failed} von ${runState.total}` : backfillLabel}
          </ThemedText>
          {runState ? (
            <Pressable onPress={cancelMediumBackfillRun} hitSlop={8}>
              <ThemedText type="linkPrimary">Abbrechen</ThemedText>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={handleConfirmStartAll} disabled={!onWifi} hitSlop={8}>
                <ThemedText type="linkPrimary" themeColor={onWifi ? undefined : 'textSecondary'}>
                  Alle Fotos vorbereiten
                </ThemedText>
              </Pressable>
              {!onWifi ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Kein WLAN aktiv — dafür bitte verbinden.
                </ThemedText>
              ) : null}
            </>
          )}
          {resultMessage ? (
            <ThemedText type="small" themeColor="dangerText">
              {resultMessage}
            </ThemedText>
          ) : null}
        </>
      ) : null}

      {/*
        AUSGANGSLAGE: Originale liegen ausschließlich im Supabase-Speicher —
        Datenbanksicherungen dort enthalten Speicherobjekte ausdrücklich
        NICHT. "Alle Fotos sichern" ist deshalb die einzige zweite Kopie, die
        es je gibt; ohne die Statuszeile unten wüsste niemand, ob sie aktuell
        ist.
      */}
      <ThemedText type="small" themeColor="textSecondary">
        {formatPhotoBackupStatusLabel(lastBackupAtUtcIso, backupCandidates.length, deviceTimeZone())}
      </ThemedText>
      {backupRunState ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Gesichert: {backupRunState.succeeded + backupRunState.failed} von {backupRunState.total}
          </ThemedText>
          <Pressable onPress={cancelPhotoBackupRun} hitSlop={8}>
            <ThemedText type="linkPrimary">Abbrechen</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable onPress={handleConfirmStartBackup} disabled={!onWifi || backupCandidates.length === 0} hitSlop={8}>
            <ThemedText
              type="linkPrimary"
              themeColor={onWifi && backupCandidates.length > 0 ? undefined : 'textSecondary'}>
              Alle Fotos sichern
            </ThemedText>
          </Pressable>
          {!onWifi ? (
            <ThemedText type="small" themeColor="textSecondary">
              Kein WLAN aktiv — dafür bitte verbinden.
            </ThemedText>
          ) : null}
        </>
      )}
      {backupResultMessage ? (
        <ThemedText type="small" themeColor="dangerText">
          {backupResultMessage}
        </ThemedText>
      ) : null}

      <Pressable onPress={() => router.push('/papierkorb')} hitSlop={8}>
        <ThemedText type="linkPrimary">Papierkorb öffnen</ThemedText>
      </Pressable>
      {trashDiagnostics.lastRunAtUtcIso ? (
        <ThemedText type="small" themeColor="textSecondary">
          Automatisches Aufräumen zuletzt: {formatTimeLabel(trashDiagnostics.lastRunAtUtcIso, deviceTimeZone())}
          {trashDiagnostics.runStatus === 'done'
            ? ` · ${trashDiagnostics.removed} entfernt${trashDiagnostics.failed > 0 ? `, ${trashDiagnostics.failed} fehlgeschlagen` : ''}`
            : ''}
        </ThemedText>
      ) : null}
      {trashDiagnostics.lastError ? (
        <ThemedText type="small" themeColor="dangerText">
          {trashDiagnostics.lastError}
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

          <Pressable onPress={() => router.push('/freigaben')} hitSlop={8}>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Freigaben</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Fotos per Link und Zugangscode teilen, ohne dass die Empfänger die App brauchen.
              </ThemedText>
            </ThemedView>
          </Pressable>

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
