import { describe, expect, it } from 'vitest';

import { isHydrated, shouldHydrate } from './use-hydrate-once';

/**
 * These cover the exact rule behind Architekturregel 9 — the two bugs it
 * exists to prevent are the first and the third block below.
 */
describe('shouldHydrate — späte Ankunft (Fehler vom 16.08.2026)', () => {
  it('does not seed while the record is still missing', () => {
    expect(shouldHydrate(false, undefined, null)).toBe(false);
  });

  it('seeds the moment the record arrives', () => {
    expect(shouldHydrate(true, 'child-1', null)).toBe(true);
  });

  it('does not seed a second time once it has', () => {
    expect(shouldHydrate(true, 'child-1', 'child-1')).toBe(false);
  });

  it('does not seed when a record is present but has no identity yet', () => {
    expect(shouldHydrate(true, null, null)).toBe(false);
  });
});

describe('shouldHydrate — laufende Eingabe schützen', () => {
  it('does NOT re-seed when the same record syncs new contents', () => {
    // Identity unchanged = same record. A background sync must never
    // overwrite what the user is halfway through typing.
    expect(shouldHydrate(true, 'person-7', 'person-7')).toBe(false);
  });
});

describe('shouldHydrate — gewechselter Datensatz (Fehler vom 17.08.2026)', () => {
  it('re-seeds when the panel is pointed at a different row', () => {
    expect(shouldHydrate(true, 'feed-B', 'feed-A')).toBe(true);
  });

  it('settles again after that second seeding', () => {
    expect(shouldHydrate(true, 'feed-B', 'feed-B')).toBe(false);
  });
});

describe('isHydrated — die Speichern-Sperre', () => {
  it('is locked before anything was seeded', () => {
    expect(isHydrated('child-1', null)).toBe(false);
  });

  it('is open once the record on screen is the one that was seeded', () => {
    expect(isHydrated('child-1', 'child-1')).toBe(true);
  });

  it('is locked again in the instant a different record is shown but not yet seeded', () => {
    // The dangerous frame: fields still hold row A while the target is row
    // B. Saving here is exactly the damage the rule forbids.
    expect(isHydrated('feed-B', 'feed-A')).toBe(false);
  });

  it('is locked while the record is absent entirely', () => {
    expect(isHydrated(undefined, null)).toBe(false);
  });
});
