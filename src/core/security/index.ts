/**
 * core/security — SQLCipher database key handling (Master-Spec §3.2, §10).
 *
 * On first launch we generate 32 random bytes, store them in the Android Keystore
 * (via expo-secure-store), and thereafter only read them back. This key encrypts
 * the local SQLite database through SQLCipher.
 *
 * HARD RULES (Spec §10):
 * - The key is NEVER synced, logged, or exported.
 * - It is device-only (WHEN_UNLOCKED_THIS_DEVICE_ONLY): not included in cloud
 *   backups and not transferable to another device.
 *
 * Note: the spec mentions base64 encoding; we use hex. Functionally identical —
 * SQLCipher takes the value as a passphrase string either way.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY_NAME = 'lifebook_db_key_v1';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Returns the SQLCipher key for this device, creating and persisting it on first
 * call. Never returns null — throws if secure storage is unavailable.
 */
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, SECURE_STORE_OPTIONS);
  if (existing) {
    return existing;
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = bytesToHex(bytes);
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_STORE_OPTIONS);
  return key;
}
