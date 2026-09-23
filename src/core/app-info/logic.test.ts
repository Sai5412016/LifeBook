import { describe, expect, it } from 'vitest';

import { formatUpdateStatusLabel } from './logic';

const TZ = 'Europe/Berlin';

describe('formatUpdateStatusLabel', () => {
  it('shows "Entwicklungsversion" regardless of any update fields when it is a dev build', () => {
    expect(
      formatUpdateStatusLabel(
        { version: '1.0.0', updateId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', createdAtUtcIso: '2026-09-23T12:12:00.000Z', isDevelopmentBuild: true },
        TZ,
      ),
    ).toBe('Entwicklungsversion');
  });

  it('shows version, a 7-character update id, and the local date/time', () => {
    expect(
      formatUpdateStatusLabel(
        { version: '1.0.0', updateId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', createdAtUtcIso: '2026-09-23T12:12:00.000Z', isDevelopmentBuild: false },
        TZ,
      ),
    ).toBe('Version 1.0.0 · Update a1b2c3d · 23.09.2026 14:12');
  });

  it('omits the update part entirely when there is no update info (expo-updates disabled)', () => {
    expect(
      formatUpdateStatusLabel({ version: '1.0.0', updateId: null, createdAtUtcIso: null, isDevelopmentBuild: false }, TZ),
    ).toBe('Version 1.0.0');
  });

  it('shows the id even without a createdAt, and vice versa', () => {
    expect(
      formatUpdateStatusLabel(
        { version: '1.0.0', updateId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', createdAtUtcIso: null, isDevelopmentBuild: false },
        TZ,
      ),
    ).toBe('Version 1.0.0 · Update a1b2c3d');

    expect(
      formatUpdateStatusLabel(
        { version: '1.0.0', updateId: null, createdAtUtcIso: '2026-09-23T12:12:00.000Z', isDevelopmentBuild: false },
        TZ,
      ),
    ).toBe('Version 1.0.0 · 23.09.2026 14:12');
  });
});
