import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the PURE-logic unit tests (core/units, core/time, and future
 * core/* modules) in plain Node. It deliberately does NOT load React Native /
 * Expo modules — those need a device/emulator and are covered by Maestro E2E
 * and manual testing instead.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
