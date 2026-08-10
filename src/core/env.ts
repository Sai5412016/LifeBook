/**
 * core/env — typed access to EXPO_PUBLIC_* environment variables.
 * Expo inlines these at build time; process.env.EXPO_PUBLIC_X becomes a literal.
 */

export const ENV = {
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  POWERSYNC_URL: process.env.EXPO_PUBLIC_POWERSYNC_URL ?? '',
} as const;

/** True once the PowerSync instance URL has been configured. */
export const isPowerSyncConfigured = (): boolean => ENV.POWERSYNC_URL.length > 0;

export type EnvCheckResult = {
  ok: boolean;
  /** Names of required EXPO_PUBLIC_ variables that are missing or obviously broken. */
  missing: string[];
};

/**
 * Crude "is this even a URL" check — not full validation, just enough to catch
 * a build with the variable unset (empty string) or set to garbage. Anything
 * that passes this still goes through the real network layer for the actual
 * check; this only exists to fail loudly instead of letting `createClient()`
 * throw at import time (see ./supabase.ts).
 */
const looksLikeUrl = (value: string): boolean => /^https?:\/\/.+/.test(value);

/**
 * Validates the environment WITHOUT throwing, so a misconfigured build can
 * show a readable German screen instead of crashing before React even starts.
 *
 * `POWERSYNC_URL` is deliberately NOT checked here: the app already degrades
 * to offline-only when it is unset (see `isPowerSyncConfigured`), so an absent
 * value is a supported state, not a startup failure.
 *
 * Takes the values to check as a parameter (defaulting to the real `ENV`) so
 * tests can exercise missing/invalid combinations without having to fake
 * `process.env` around module import time.
 */
export function checkEnv(
  env: Pick<typeof ENV, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'> = ENV,
): EnvCheckResult {
  const missing: string[] = [];

  if (!looksLikeUrl(env.SUPABASE_URL)) {
    missing.push('EXPO_PUBLIC_SUPABASE_URL');
  }
  if (env.SUPABASE_ANON_KEY.length === 0) {
    missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  return { ok: missing.length === 0, missing };
}
