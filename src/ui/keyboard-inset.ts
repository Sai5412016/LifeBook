/**
 * ui/keyboard-inset — pure math for the bottom padding a keyboard-aware
 * screen needs. No Expo / React Native import, so this runs in plain Node
 * under Vitest; the device-touching side (Keyboard events, safe area,
 * Animated) lives in ./keyboard-safe-screen.
 *
 * WHY THIS EXISTS
 * ----------------
 * Android has drawn edge-to-edge since Expo SDK 54 / Android 15 — the app
 * window is never resized for the keyboard, so `KeyboardAvoidingView`'s
 * height/padding behavior (which assumes the OS still shrinks the window)
 * does nothing useful there. The bottom inset has to be computed and applied
 * by hand instead — this is that computation, kept pure so the composition
 * rules below are covered by tests rather than only ever seen on a device.
 */

export type KeyboardInsetInput = {
  /** Keyboard height in pixels, 0 when closed. */
  keyboardHeight: number;
  /** Device's bottom safe area inset (gesture bar / home indicator). */
  safeAreaBottom: number;
  /** Bottom tab bar height, or 0 on a screen without one. */
  tabBarHeight: number;
  /** Fixed breathing room under the last field, always included. */
  basePadding: number;
};

/** Never negative, never NaN/Infinity — a bad measurement becomes "nothing", not garbage padding. */
const sanitize = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * The bottom inset a keyboard-aware ScrollView should pad its content by.
 *
 * - Keyboard closed: base + safe area + tab bar (if any) — nothing is
 *   covering them, so all three stack. This is exactly how every existing
 *   tab screen in this app already computes its bottom padding (SafeAreaView
 *   for the safe area, `BottomTabInset` added by hand for the tab bar) — see
 *   src/app/(tabs)/chronik.tsx and alltag.tsx.
 * - Keyboard open: base + keyboard height only. The keyboard already covers
 *   both the safe area AND the tab bar (if any) — adding either on top would
 *   recreate the exact gap between keyboard and content this component
 *   exists to close.
 */
export function computeKeyboardInset(input: KeyboardInsetInput): number {
  const keyboardHeight = sanitize(input.keyboardHeight);
  const basePadding = sanitize(input.basePadding);

  if (keyboardHeight > 0) {
    return basePadding + keyboardHeight;
  }

  const safeAreaBottom = sanitize(input.safeAreaBottom);
  const tabBarHeight = sanitize(input.tabBarHeight);
  return basePadding + safeAreaBottom + tabBarHeight;
}

export type FieldScrollInput = {
  /** Whether the keyboard is currently open. Closed => never scroll here; the keyboard-show handler owns that transition (see ./keyboard-safe-screen). */
  keyboardOpen: boolean;
  /** The focused field's top edge, in ScrollView content coordinates (e.g. from `measureLayout` against the content view). */
  fieldTop: number;
  /** The focused field's height. */
  fieldHeight: number;
  /** How much vertical space is free above the keyboard — already net of any breathing-room margin the caller wants. */
  visibleHeight: number;
  /** The ScrollView's current content offset. */
  scrollY: number;
};

/**
 * Whether a keyboard-aware ScrollView should scroll to reveal the focused
 * field, and if so, to which content offset. Returns null for "don't move
 * anything" — either the keyboard is closed, or the field is already fully
 * inside the visible window `[scrollY, scrollY + visibleHeight]`.
 *
 * Three cases when it isn't already visible:
 * - Above the visible window (user scrolled past it) → bring its TOP down
 *   to the top of the window.
 * - Taller than the whole visible window → align its TOP, not its bottom.
 *   Bottom-aligning a field taller than the available space would push the
 *   very first line the user is looking at up off-screen — showing the top
 *   is what a note field's writer actually needs to see.
 * - Otherwise below the visible window (the reported bug: a field further
 *   down the form gets focus while the keyboard is already open) → bring
 *   its BOTTOM up to the bottom of the window, revealing the whole field.
 */
export function computeFieldScrollTarget(input: FieldScrollInput): number | null {
  if (!input.keyboardOpen) {
    return null;
  }

  const fieldTop = sanitize(input.fieldTop);
  const fieldHeight = sanitize(input.fieldHeight);
  const visibleHeight = sanitize(input.visibleHeight);
  const scrollY = sanitize(input.scrollY);

  const fieldBottom = fieldTop + fieldHeight;
  const visibleTop = scrollY;
  const visibleBottom = scrollY + visibleHeight;

  if (fieldTop >= visibleTop && fieldBottom <= visibleBottom) {
    return null;
  }

  if (fieldTop < visibleTop) {
    return fieldTop;
  }

  if (fieldHeight > visibleHeight) {
    return fieldTop;
  }

  return Math.max(0, fieldBottom - visibleHeight);
}

/**
 * The optional keyboard-safe-screen focus-report context (see
 * ./keyboard-safe-screen#useReportFieldFocus) defaults to this outside any
 * provider — a `TextField` must never crash just because it happens to be
 * rendered somewhere that isn't wrapped in `KeyboardSafeScreen`. Kept here,
 * not inline in the context's default value, so that guarantee is covered
 * by a test rather than only ever exercised on a device.
 */
export const noopFieldFocusReport = (): void => {};
