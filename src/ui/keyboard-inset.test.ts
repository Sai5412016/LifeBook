import { describe, expect, it } from 'vitest';

import { computeFieldScrollTarget, computeKeyboardInset, noopFieldFocusReport } from './keyboard-inset';

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

describe('computeFieldScrollTarget', () => {
  it('closed keyboard: never scrolls, no matter where the field is', () => {
    expect(
      computeFieldScrollTarget({ keyboardOpen: false, fieldTop: 900, fieldHeight: 52, visibleHeight: 300, scrollY: 0 }),
    ).toBeNull();
  });

  it('field already fully visible: no scroll', () => {
    expect(
      computeFieldScrollTarget({ keyboardOpen: true, fieldTop: 100, fieldHeight: 52, visibleHeight: 300, scrollY: 0 }),
    ).toBeNull();
  });

  it('field below the keyboard: scrolls so its bottom clears the visible area', () => {
    // Field spans 400..452, visible window is 0..300 — bottom (452) is 152px past the window.
    expect(
      computeFieldScrollTarget({ keyboardOpen: true, fieldTop: 400, fieldHeight: 52, visibleHeight: 300, scrollY: 0 }),
    ).toBe(152); // fieldBottom(452) - visibleHeight(300)
  });

  it('field taller than the visible area: aligns its top, not its bottom', () => {
    // A 500px-tall note field cannot fit in a 300px visible window at all.
    expect(
      computeFieldScrollTarget({ keyboardOpen: true, fieldTop: 400, fieldHeight: 500, visibleHeight: 300, scrollY: 0 }),
    ).toBe(400); // fieldTop, not fieldBottom - visibleHeight (which would hide the first line)
  });

  it('field scrolled above the visible window: brings its top back down into view', () => {
    expect(
      computeFieldScrollTarget({ keyboardOpen: true, fieldTop: 50, fieldHeight: 52, visibleHeight: 300, scrollY: 400 }),
    ).toBe(50);
  });

  it('accounts for a non-zero current scroll position', () => {
    // Visible window is 200..500; field at 550..602 is still below it.
    expect(
      computeFieldScrollTarget({ keyboardOpen: true, fieldTop: 550, fieldHeight: 52, visibleHeight: 300, scrollY: 200 }),
    ).toBe(302); // fieldBottom(602) - visibleHeight(300)
  });

  it('never returns a negative target for garbage input', () => {
    expect(
      computeFieldScrollTarget({
        keyboardOpen: true,
        fieldTop: Number.NaN,
        fieldHeight: -50,
        visibleHeight: Number.POSITIVE_INFINITY,
        scrollY: -10,
      }),
    ).toBeNull(); // treated as a 0-height field at the top, inside a huge (sanitized-to-0) window — already "visible"
  });
});

describe('noopFieldFocusReport', () => {
  it('never throws — the safe default for a TextField outside any KeyboardSafeScreen', () => {
    expect(() => noopFieldFocusReport()).not.toThrow();
  });

  it('returns undefined and takes no arguments that could be misused', () => {
    expect(noopFieldFocusReport()).toBeUndefined();
  });
});
