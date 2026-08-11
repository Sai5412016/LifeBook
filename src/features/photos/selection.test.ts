import { describe, expect, it } from 'vitest';

import { formatDeleteConfirmationMessage, formatSelectionCountLabel, toggleSelected } from './selection';

describe('toggleSelected', () => {
  it('adds an id not yet selected, at the end', () => {
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an id already selected', () => {
    expect(toggleSelected(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('starts a selection from empty', () => {
    expect(toggleSelected([], 'a')).toEqual(['a']);
  });

  it('empties a selection down to zero without erroring', () => {
    expect(toggleSelected(['a'], 'a')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const original = ['a', 'b'];
    toggleSelected(original, 'a');
    toggleSelected(original, 'c');
    expect(original).toEqual(['a', 'b']);
  });
});

describe('formatSelectionCountLabel', () => {
  it('formats zero, one and many the same shape', () => {
    expect(formatSelectionCountLabel(0)).toBe('0 ausgewählt');
    expect(formatSelectionCountLabel(1)).toBe('1 ausgewählt');
    expect(formatSelectionCountLabel(12)).toBe('12 ausgewählt');
  });
});

describe('formatDeleteConfirmationMessage', () => {
  it('names a single photo in the singular', () => {
    expect(formatDeleteConfirmationMessage(1)).toBe(
      'Das ausgewählte Foto wird unwiderruflich gelöscht — auch vom Handy des anderen Elternteils. Es gibt keine Möglichkeit, es wiederherzustellen.',
    );
  });

  it('names the exact count in the plural', () => {
    expect(formatDeleteConfirmationMessage(5)).toBe(
      '5 ausgewählte Fotos werden unwiderruflich gelöscht — auch vom Handy des anderen Elternteils. Es gibt keine Möglichkeit, sie wiederherzustellen.',
    );
  });
});
