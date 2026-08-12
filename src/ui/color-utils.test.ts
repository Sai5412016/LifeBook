import { describe, expect, it } from 'vitest';

import { withAlpha } from './color-utils';

describe('withAlpha', () => {
  it('converts a 6-digit hex color to rgba', () => {
    expect(withAlpha('#E9613A', 0.35)).toBe('rgba(233, 97, 58, 0.35)');
  });

  it('converts a 3-digit hex color to rgba', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('handles black and full opacity', () => {
    expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });
});
