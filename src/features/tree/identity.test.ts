import { describe, expect, it } from 'vitest';

import { buildRelativePhotoKey } from './identity';

describe('buildRelativePhotoKey', () => {
  it('builds the storage key from household, relative id and upload id', () => {
    expect(buildRelativePhotoKey('hh1', 'rel1', 'up1')).toBe('hh1/relatives/rel1/up1.jpg');
  });

  it('gives two different uploads for the same relative two different keys', () => {
    expect(buildRelativePhotoKey('hh1', 'rel1', 'up1')).not.toBe(buildRelativePhotoKey('hh1', 'rel1', 'up2'));
  });

  it('rejects a household id that would escape its own path segment', () => {
    expect(() => buildRelativePhotoKey('../evil', 'rel1', 'up1')).toThrow();
  });

  it('rejects a relative id that would escape its own path segment', () => {
    expect(() => buildRelativePhotoKey('hh1', '../evil', 'up1')).toThrow();
  });

  it('rejects an upload id that would escape its own path segment', () => {
    expect(() => buildRelativePhotoKey('hh1', 'rel1', '../evil')).toThrow();
  });
});
