/**
 * core/auth/session-store — Supabase auth session as reactive global state.
 *
 * startAuthListener() must be called exactly once (from the root layout, see
 * src/app/_layout.tsx) before any UI reads useAuth(). It is idempotent — safe
 * to call again on re-render / Fast Refresh without creating duplicate
 * subscriptions.
 *
 * 'loading' is the state between app start and the first resolved answer from
 * Supabase (either a restored session from AsyncStorage, or none). The root
 * layout shows a spinner during 'loading' so no screen ever has to guess.
 */

import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '../supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthState = {
  session: Session | null;
  status: AuthStatus;
};

const useAuthState = create<AuthState>(() => ({
  session: null,
  status: 'loading',
}));

let started = false;

/** Starts the Supabase auth listener. Call once from the root layout. */
export function startAuthListener(): void {
  if (started) {
    return;
  }
  started = true;

  supabase.auth.getSession().then(({ data: { session } }) => {
    useAuthState.setState({ session, status: session ? 'signedIn' : 'signedOut' });
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthState.setState({ session, status: session ? 'signedIn' : 'signedOut' });
  });
}

/** Reactive hook: current Supabase auth session + resolved status. */
export const useAuth = (): AuthState => useAuthState();
