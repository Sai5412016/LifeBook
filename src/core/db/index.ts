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

import { PowerSyncDatabase } from '@powersync/react-native';

import { isPowerSyncConfigured } from '../env';
import { getOrCreateDbKey } from '../security';
import { SupabaseConnector } from '../sync/connector';
import { AppSchema } from './schema';

let dbInstance: PowerSyncDatabase | null = null;

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
 */
export async function connectPowerSync(db: PowerSyncDatabase): Promise<boolean> {
  if (!isPowerSyncConfigured()) {
    return false;
  }
  await db.connect(new SupabaseConnector());
  return true;
}
