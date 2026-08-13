import { beforeEach, describe, expect, it } from 'vitest';

import { setLastViewedPhotoId, takeLastViewedPhotoId } from './lastViewed';

describe('lastViewed', () => {
  beforeEach(() => {
    // Module state persists across tests otherwise — reset to the "never
    // viewed anything" starting point every time.
    takeLastViewedPhotoId();
  });

  it('returns null before anything was ever recorded', () => {
    expect(takeLastViewedPhotoId()).toBeNull();
  });

  it('returns what was last set', () => {
    setLastViewedPhotoId('photo-1');
    expect(takeLastViewedPhotoId()).toBe('photo-1');
  });

  it('clears itself once taken, so a second take sees nothing', () => {
    setLastViewedPhotoId('photo-1');
    takeLastViewedPhotoId();
    expect(takeLastViewedPhotoId()).toBeNull();
  });

  it('reflects the most recent set when called multiple times before a take', () => {
    setLastViewedPhotoId('photo-1');
    setLastViewedPhotoId('photo-2');
    expect(takeLastViewedPhotoId()).toBe('photo-2');
  });

  it('can be explicitly reset to null', () => {
    setLastViewedPhotoId('photo-1');
    setLastViewedPhotoId(null);
    expect(takeLastViewedPhotoId()).toBeNull();
  });
});
