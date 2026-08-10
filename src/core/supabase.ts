/**
 * core/supabase — the Supabase client (Auth + Postgres writes).
 *
 * Auth session is persisted in AsyncStorage so the user stays signed in across
 * app restarts. The URL polyfill is required for supabase-js to parse URLs on
 * React Native.
 *
 * WHY THIS MODULE MUST NEVER THROW AT IMPORT
 * -------------------------------------------
 * `createClient()` runs at MODULE scope, which means it runs the moment
 * anything imports this file — before React, before the root layout, before
 * any screen exists to report an error. supabase-js throws synchronously if
 * the URL or key is empty or not parseable as a URL. On a release build that
 * throw has no red screen and no log to check: the app just never starts (the
 * crash this module exists to prevent). So when `checkEnv()` finds the
 * configuration broken, a harmless placeholder URL/key is used instead — just
 * valid enough for `createClient()` to succeed. The real problem is then
 * caught by `checkEnv()` in the root layout, which shows the user a readable
 * screen with the missing variable names and renders nothing that would
 * actually use this client.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { checkEnv, ENV } from './env';

const envCheck = checkEnv();

const supabaseUrl = envCheck.ok ? ENV.SUPABASE_URL : 'https://misconfigured.invalid';
const supabaseAnonKey = envCheck.ok ? ENV.SUPABASE_ANON_KEY : 'misconfigured';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native (no browser redirect).
    detectSessionInUrl: false,
  },
});
