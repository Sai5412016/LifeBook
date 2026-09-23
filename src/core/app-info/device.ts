/**
 * core/app-info/device — reads the currently loaded build/update identity.
 * `expo-updates`' fields are static per launch (set once at process start,
 * no reactivity needed) — kept separate from ./logic.ts only so that pure
 * module stays importable under Vitest without pulling in Expo native
 * modules (Architekturregel 3), same convention as core/time/device.ts.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import type { UpdateStatusInfo } from './logic';

/**
 * `Updates.isEmbeddedLaunch` is DELIBERATELY not used to decide
 * "Entwicklungsversion" (task 2026-09-24 asked for `isEmbeddedLaunch` OR
 * `__DEV__`) — `isEmbeddedLaunch` is `true` for a perfectly normal,
 * freshly-installed PRODUCTION build that simply hasn't fetched a
 * Funkupdate yet, not only in development. Using it here would label
 * exactly that everyday state "Entwicklungsversion", defeating the whole
 * point of this line: seeing whether a Funkupdate arrived. `__DEV__`
 * (true only under Metro/a dev client) is the correct, narrower signal.
 */
export function readUpdateStatusInfo(): UpdateStatusInfo {
  return {
    version: Constants.expoConfig?.version ?? '?',
    updateId: Updates.updateId,
    createdAtUtcIso: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    isDevelopmentBuild: __DEV__,
  };
}
