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

/**
 * A function, not a module-level `const`: `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 * reads a constant off the native SecureStore module, and any native access at
 * module scope runs the instant something imports this file — before the root
 * layout's crash handler exists to catch it. Deferred to first call instead,
 * which happens well after app start, inside `getOrCreateDbKey`.
 */
function getSecureStoreOptions(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Returns the SQLCipher key for this device, creating and persisting it on first
 * call. Never returns null — throws if secure storage is unavailable.
 */
export async function getOrCreateDbKey(): Promise<string> {
  const options = getSecureStoreOptions();
  const existing = await SecureStore.getItemAsync(KEY_NAME, options);
  if (existing) {
    return existing;
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = bytesToHex(bytes);
  await SecureStore.setItemAsync(KEY_NAME, key, options);
  return key;
}
