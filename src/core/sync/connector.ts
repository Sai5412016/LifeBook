/**
 * core/sync/connector — SupabaseConnector (Master-Spec §6).
 *
 * Bridges PowerSync <-> Supabase:
 * - fetchCredentials: hands PowerSync the current Supabase JWT + the PowerSync
 *   endpoint. Returns null when the user is not signed in (PowerSync stays
 *   disconnected; the app still works fully offline on the local encrypted DB).
 * - uploadData: replays the local write queue (CRUD) to Supabase. Because row ids
 *   are client-generated (UUIDv7), PUT is an idempotent upsert — safe to retry.
 *
 * Any thrown error makes PowerSync retry the whole transaction after its wait
 * period, so we throw on the first failing operation and DON'T call tx.complete().
 */

import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';

import { ENV } from '../env';
import { supabase } from '../supabase';

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }
    if (!session) {
      return null; // not signed in → do not connect
    }

    return {
      endpoint: ENV.POWERSYNC_URL,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    for (const op of transaction.crud) {
      const table = supabase.from(op.table);
      let result;

      switch (op.op) {
        case UpdateType.PUT:
          result = await table.upsert({ id: op.id, ...op.opData });
          break;
        case UpdateType.PATCH:
          result = await table.update(op.opData ?? {}).eq('id', op.id);
          break;
        case UpdateType.DELETE:
          result = await table.delete().eq('id', op.id);
          break;
      }

      if (result?.error) {
        // Throw → PowerSync retries this transaction later. tx stays uncompleted.
        throw new Error(
          `Upload failed (${op.op} on ${op.table} #${op.id}): ${result.error.message}`,
        );
      }
    }

    await transaction.complete();
  }
}
