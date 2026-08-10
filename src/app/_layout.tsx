import { PowerSyncContext, useStatus } from '@powersync/react-native';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { CrashScreen } from '@/components/diagnostics/crash-screen';
import { EnvErrorScreen } from '@/components/diagnostics/env-error-screen';
import { ThemedView } from '@/components/themed-view';
import { startAuthListener, useAuth } from '@/core/auth/session-store';
import { connectPowerSync, openDatabase } from '@/core/db';
import { GlobalErrorBoundary } from '@/core/diagnostics/error-boundary';
import { installGlobalErrorHandler, useGlobalCrash } from '@/core/diagnostics/crash-reporter';
import { checkEnv } from '@/core/env';
import { useHasHousehold } from '@/features/household/repository';

// As early as this module can manage it — before anything else in the app
// runs — so an unhandled JS error anywhere shows CrashScreen instead of
// silently killing the app (see core/diagnostics/crash-reporter.ts).
installGlobalErrorHandler();

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const crash = useGlobalCrash();

  // Checked on every render, not just once: cheap, pure, and a misconfigured
  // build should never get further than this even after a Fast Refresh.
  const envCheck = crash ? null : checkEnv();

  if (crash) {
    return <CrashScreen message={crash.message} stack={crash.stack} />;
  }

  if (envCheck && !envCheck.ok) {
    return <EnvErrorScreen missing={envCheck.missing} />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <GlobalErrorBoundary>
        <DbAndAuthGate>
          <NavigationGate />
        </DbAndAuthGate>
      </GlobalErrorBoundary>
    </ThemeProvider>
  );
}

/**
 * Opens the encrypted local database once and provides it via PowerSyncContext
 * (so `usePowerSync()` / `useQuery()` from @powersync/react-native work anywhere
 * below). Also starts the Supabase auth listener. Children render only once the
 * database has finished opening — everything below can assume it exists.
 */
function DbAndAuthGate({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<PowerSyncDatabase | null>(null);

  useEffect(() => {
    startAuthListener();
    let cancelled = false;
    openDatabase().then((instance) => {
      if (!cancelled) {
        setDb(instance);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!db) {
    return <FullScreenSpinner />;
  }

  return (
    <PowerSyncContext.Provider value={db}>
      <PowerSyncConnector db={db} />
      {children}
    </PowerSyncContext.Provider>
  );
}

/**
 * Connects PowerSync to Supabase once a session exists — and KEEPS RETRYING if
 * the connection attempt fails or drops, instead of giving up after one try
 * (bug found 2026-08-08: a single failed handshake left the app permanently
 * offline until app restart, even though local writes kept succeeding).
 *
 * `useStatus()` reflects PowerSync's real connection state, so this effect
 * re-runs automatically whenever the connection settles into "neither
 * connected nor connecting" while signed in — i.e. after any failure. The
 * first attempt fires immediately; later retries wait 3s to avoid hammering
 * the endpoint in a tight loop if it fails synchronously.
 *
 * Explicit disconnect on sign-out is handled at the sign-out call site (see
 * (tabs)/index.tsx AccountRow), not here — documented, not silently skipped.
 */
function PowerSyncConnector({ db }: { db: PowerSyncDatabase }) {
  const { status } = useAuth();
  const syncStatus = useStatus();
  const hasAttempted = useRef(false);

  useEffect(() => {
    if (status !== 'signedIn' || syncStatus.connected || syncStatus.connecting) {
      return;
    }

    const delay = hasAttempted.current ? 3000 : 0;
    const timer = setTimeout(() => {
      hasAttempted.current = true;
      connectPowerSync(db).catch((error) => {
        console.error('[LifeBook] PowerSync connect failed — will retry in 3s', error);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [status, db, syncStatus.connected, syncStatus.connecting]);

  return null;
}

/**
 * Redirect gate (Master-Spec: auth-gated onboarding).
 *   loading                    → spinner
 *   signedOut                  → (auth) group
 *   signedIn, no household yet → (onboarding) group
 *   signedIn, has a household  → (tabs) group
 * Re-evaluated on every navigation via useSegments(); returns <Redirect> instead
 * of <Slot> whenever the current route group doesn't match the required one.
 */
function NavigationGate() {
  const { status, session } = useAuth();
  const segments = useSegments();
  const group = segments[0];

  // Hooks must run unconditionally on every render, so this is called before
  // any early return below — even while status is still 'loading'.
  const { data: memberships, isLoading: householdLoading } = useHasHousehold(session?.user.id);

  if (status === 'loading') {
    return <FullScreenSpinner />;
  }

  if (status === 'signedOut') {
    if (group !== '(auth)') {
      return <Redirect href="/sign-in" />;
    }
    return <Slot />;
  }

  // status === 'signedIn' from here on.
  if (householdLoading) {
    return <FullScreenSpinner />;
  }

  const hasHousehold = memberships.length > 0;

  if (!hasHousehold) {
    if (group !== '(onboarding)') {
      return <Redirect href="/household" />;
    }
    return <Slot />;
  }

  if (group === '(auth)' || group === '(onboarding)') {
    return <Redirect href="/" />;
  }

  return <Slot />;
}

function FullScreenSpinner() {
  return (
    <ThemedView style={styles.spinnerContainer}>
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  spinnerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
