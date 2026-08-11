import { describe, expect, it } from 'vitest';

import {
  buildNotifyHouseholdRequest,
  canRequestPushPermission,
  describePushPermissionStatus,
  shouldNotifyAfterImport,
} from './logic';

describe('describePushPermissionStatus', () => {
  it.each([
    ['granted', 'Aktiv'],
    ['undetermined', 'Nicht aktiviert'],
    [
      'denied',
      'Abgelehnt — kann in den Systemeinstellungen des Geräts wieder erlaubt werden',
    ],
  ] as const)('describes %s', (status, expected) => {
    expect(describePushPermissionStatus(status)).toBe(expected);
  });
});

describe('canRequestPushPermission', () => {
  it('is false once granted — nothing left to ask for', () => {
    expect(canRequestPushPermission('granted')).toBe(false);
  });

  it('is true when undetermined', () => {
    expect(canRequestPushPermission('undetermined')).toBe(true);
  });

  it('is true when denied — the settings screen still offers to try again', () => {
    expect(canRequestPushPermission('denied')).toBe(true);
  });
});

describe('shouldNotifyAfterImport', () => {
  it('is false for zero newly imported photos', () => {
    expect(shouldNotifyAfterImport(0)).toBe(false);
  });

  it('is true for one or more', () => {
    expect(shouldNotifyAfterImport(1)).toBe(true);
    expect(shouldNotifyAfterImport(12)).toBe(true);
  });
});

describe('buildNotifyHouseholdRequest', () => {
  it('builds the exact body the server function expects', () => {
    expect(buildNotifyHouseholdRequest('household-1', 'photos', 3)).toEqual({
      householdId: 'household-1',
      kind: 'photos',
      count: 3,
    });
  });
});
