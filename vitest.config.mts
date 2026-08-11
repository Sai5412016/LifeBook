import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the PURE-logic unit tests (core/units, core/time, and future
 * core/* modules) in plain Node. It deliberately does NOT load React Native /
 * Expo modules — those need a device/emulator and are covered by Maestro E2E
 * and manual testing instead.
 *
 * The `@` alias mirrors tsconfig.json's `@/* -> ./src/*` so pure feature
 * modules (e.g. features/feeding/timer.ts) can import core/* the same way
 * the rest of the app does, instead of needing test-only relative paths.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
