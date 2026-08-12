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
