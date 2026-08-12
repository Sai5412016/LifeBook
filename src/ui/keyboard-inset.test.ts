import { describe, expect, it } from 'vitest';

import { computeKeyboardInset } from './keyboard-inset';

describe('computeKeyboardInset', () => {
  it('closed keyboard: base padding plus safe area', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: 0, safeAreaBottom: 34, tabBarHeight: 0, basePadding: 24 }),
    ).toBe(58);
  });

  it('closed keyboard on a tab-bar screen: tab bar also stacks (nothing covers it)', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: 0, safeAreaBottom: 34, tabBarHeight: 80, basePadding: 24 }),
    ).toBe(138);
  });

  it('open keyboard: safe area is NOT added again — the keyboard already covers it', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: 300, safeAreaBottom: 34, tabBarHeight: 0, basePadding: 24 }),
    ).toBe(324);
  });

  it('open keyboard on a tab-bar screen: neither safe area nor tab bar are added — both are covered', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: 300, safeAreaBottom: 34, tabBarHeight: 80, basePadding: 24 }),
    ).toBe(324);
  });

  it('never returns a value under 0 for negative inputs', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: -50, safeAreaBottom: -10, tabBarHeight: -5, basePadding: -1 }),
    ).toBe(0);
  });

  it('treats NaN/Infinity as "nothing" rather than propagating garbage', () => {
    expect(
      computeKeyboardInset({
        keyboardHeight: Number.NaN,
        safeAreaBottom: Number.POSITIVE_INFINITY,
        tabBarHeight: Number.NaN,
        basePadding: 24,
      }),
    ).toBe(24);
  });

  it('a negative keyboard height is treated as closed', () => {
    expect(
      computeKeyboardInset({ keyboardHeight: -1, safeAreaBottom: 34, tabBarHeight: 0, basePadding: 24 }),
    ).toBe(58);
  });
});
