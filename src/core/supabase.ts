/**
 * core/supabase — the Supabase client (Auth + Postgres writes).
 *
 * Auth session is persisted in AsyncStorage so the user stays signed in across
 * app restarts. The URL polyfill is required for supabase-js to parse URLs on
 * React Native.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { ENV } from './env';

export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native (no browser redirect).
    detectSessionInUrl: false,
  },
});
