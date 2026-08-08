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
