/**
 * core/db — the encrypted, synced PowerSync database instance (Master-Spec §3, §6).
 *
 * openDatabase() builds a SQLCipher-encrypted local SQLite database (key from
 * core/security) with the AppSchema. It works fully offline immediately.
 *
 * connectPowerSync() attaches the SupabaseConnector so local writes upload and
 * remote changes stream down. It only connects when a PowerSync URL is configured
 * — until then the app runs purely local.
 */

import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/react-native';

import { isPowerSyncConfigured } from '../env';
import { getOrCreateDbKey } from '../security';
import { SupabaseConnector } from '../sync/connector';
import { AppSchema } from './schema';

let dbInstance: PowerSyncDatabase | null = null;
let connectInFlight: Promise<boolean> | null = null;

/** Opens (once) the encrypted local database. Safe to call repeatedly. */
export async function openDatabase(): Promise<PowerSyncDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  const encryptionKey = await getOrCreateDbKey();
  dbInstance = new PowerSyncDatabase({
    schema: AppSchema,
    database: {
      dbFilename: 'lifebook.db',
      sqliteOptions: { encryptionKey },
    },
  });
  return dbInstance;
}

/**
 * Connects the database to PowerSync via Supabase. No-op (returns false) when the
 * PowerSync URL isn't configured yet, so the app degrades gracefully to offline.
 *
 * WHY WEB_SOCKET INSTEAD OF THE DEFAULT HTTP STREAM
 * -------------------------------------------------
 * PowerSync's default transport is a streaming HTTP response, which on React
 * Native is served by `expo/fetch`. On Android that stream proved unreliable
 * here: every attempt died with "fetch failed: Fetch request has been canceled"
 * (observed 2026-08-08/09), leaving local writes queued and never uploaded.
 *
 * WEB_SOCKET is the SDK's own documented workaround for exactly this — see the
 * error text in ReactNativeRemote.fetch() and `SyncOptions.connectionMethod`,
 * which notes WEB_SOCKET "is used as a workaround" where streaming HTTP is not
 * dependable. WebSocket support is bundled in @powersync/shared-internals, so
 * this needs no extra dependency and no new native build.
 *
 * Deliberate deviation from the SDK default, documented rather than silent.
 * Revisit if a future expo/fetch release fixes Android streaming.
 *
 * Concurrent calls share one in-flight attempt: the retry loop in the root
 * layout can fire while a previous attempt is still resolving, and starting a
 * second connect() would abort the first (itself a source of "canceled").
 */
export async function connectPowerSync(db: PowerSyncDatabase): Promise<boolean> {
  if (!isPowerSyncConfigured()) {
    return false;
  }
  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = db
    .connect(new SupabaseConnector(), {
      connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET,
    })
    .then(() => true)
    .finally(() => {
      connectInFlight = null;
    });

  return connectInFlight;
}
