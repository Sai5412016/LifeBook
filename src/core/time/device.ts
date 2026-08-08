/**
 * core/time/device.ts — device timezone access (Master-Spec §7).
 *
 * Kept separate from ./index.ts so the pure time helpers stay testable in Node
 * without pulling in the Expo runtime. Feature code that needs the current device
 * timezone imports it from here.
 */

import * as Localization from 'expo-localization';

/**
 * Current device IANA timezone (e.g. "Europe/Berlin"). Falls back to UTC if the
 * platform does not report one.
 */
export const deviceTimeZone = (): string =>
  Localization.getCalendars()[0]?.timeZone ?? 'UTC';
