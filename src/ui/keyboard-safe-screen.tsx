/**
 * ui/keyboard-safe-screen — the one approved way to host TextInput/TextField
 * anywhere in this app (see CLAUDE.md, Architekturregel 7).
 *
 * WHY NOT KeyboardAvoidingView
 * -----------------------------
 * Android has drawn edge-to-edge since Expo SDK 54 / Android 15 — the app
 * window is never resized for the keyboard anymore, the app keeps drawing
 * full-screen underneath it. `KeyboardAvoidingView`'s `height`/`padding`
 * behavior assumes the OS still shrinks the window, so on current Android it
 * does nothing useful — the field stays hidden behind the keyboard.
 *
 * This component measures the keyboard itself (Keyboard events) and pads /
 * scrolls around it by hand instead — pure React Native building blocks
 * only (Keyboard, Animated, ScrollView, useSafeAreaInsets), no native
 * module. That matters right now: `runtimeVersion` is pinned to
 * `fingerprint` (CLAUDE.md Fallstrick 5/7), so any new dependency risks
 * making the in-flight EAS Update unable to reach already-installed apps.
 *
 * Deliberately a stopgap for that reason: once the next real EAS build
 * lands, this can be swapped for a proper native keyboard-aware library
 * behind the same props (`hasTabBar`, `header`, `contentContainerStyle`) —
 * screens that use `KeyboardSafeScreen` won't need touching again.
 *
 * BOTTOM SAFE AREA IS OWNED HERE, NOT BY <SafeAreaView>
 * -------------------------------------------------------
 * The inner `SafeAreaView` below deliberately excludes the bottom edge
 * (`edges={['top', 'left', 'right']}`) — the bottom inset has to change
 * smoothly as the keyboard opens/closes and must never stack with the tab
 * bar height, which is exactly what `./keyboard-inset#computeKeyboardInset`
 * computes. Letting `SafeAreaView` ALSO pad the bottom would double it.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  type KeyboardEvent,
  type KeyboardEventName,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';

import { computeFieldScrollTarget, computeKeyboardInset, noopFieldFocusReport } from './keyboard-inset';

/**
 * Lets a field (see ./text-field.tsx) report "I just got focus" to its
 * nearest KeyboardSafeScreen. Only needed for the case the keyboard SHOW
 * event can't cover: the keyboard is already open and focus moves to a
 * DIFFERENT field further down the form (the reported bug — tap the name
 * field, then the note field, with the keyboard never closing in between).
 *
 * Defaults to `noopFieldFocusReport` — a `TextField` rendered outside any
 * `KeyboardSafeScreen` must report into the void, never throw.
 */
const FieldFocusReportContext = createContext<() => void>(noopFieldFocusReport);

/** For src/ui/text-field.tsx — see the context doc comment above. */
export function useReportFieldFocus(): () => void {
  return useContext(FieldFocusReportContext);
}

// iOS fires keyboardWillShow/Hide (ahead of the animation, so padding can
// track it smoothly). Android has NO "will" variant — only
// keyboardDidShow/Hide ever fire there. Using the iOS-only pair app-wide
// would mean Android never gets a callback at all.
const SHOW_EVENT: KeyboardEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT: KeyboardEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

const BASE_PADDING = Spacing.four;
/** Kept clear above the focused field once it's scrolled into view. */
const FOCUS_SCROLL_MARGIN = Spacing.three;
const PADDING_ANIMATION_MS = 220;

export type KeyboardSafeScreenProps = {
  children: React.ReactNode;
  /** Rendered above the scrollable area, inside the same top-safe-area padding — a fixed header row untouched by keyboard padding. */
  header?: React.ReactNode;
  /** Set on any screen that sits above the bottom tab bar, so its height isn't double-counted once the keyboard covers it. */
  hasTabBar?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function KeyboardSafeScreen({
  children,
  header,
  hasTabBar = false,
  style,
  contentContainerStyle,
}: KeyboardSafeScreenProps) {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const viewportHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const tabBarHeight = hasTabBar ? BottomTabInset : 0;
  const paddingAnim = useRef(
    new Animated.Value(
      computeKeyboardInset({
        keyboardHeight: 0,
        safeAreaBottom: insets.bottom,
        tabBarHeight,
        basePadding: BASE_PADDING,
      }),
    ),
  ).current;

  useEffect(() => {
    Animated.timing(paddingAnim, {
      toValue: computeKeyboardInset({
        keyboardHeight,
        safeAreaBottom: insets.bottom,
        tabBarHeight,
        basePadding: BASE_PADDING,
      }),
      duration: PADDING_ANIMATION_MS,
      // paddingBottom is a layout property — the native driver cannot
      // animate it, only opacity/transform.
      useNativeDriver: false,
    }).start();
  }, [keyboardHeight, insets.bottom, tabBarHeight, paddingAnim]);

  /**
   * Scrolls the currently-focused field above the keyboard, if it needs it.
   * Built from the ref to the focused field and its position within the
   * ScrollView (`measureLayout` against the ScrollView's inner content
   * node), NOT `scrollResponderScrollNativeHandleToKeyboard` — that
   * all-in-one helper is unreliable under the New Architecture. The actual
   * "does it need it, and where to" decision is the pure
   * `computeFieldScrollTarget` — this is only the device-touching plumbing
   * around it.
   */
  const scrollFocusedInputIntoView = useCallback((currentKeyboardHeight: number) => {
    const scrollView = scrollViewRef.current;
    const focusedInput = TextInput.State.currentlyFocusedInput();
    const innerViewNode = scrollView?.getInnerViewNode();
    if (!scrollView || !focusedInput || innerViewNode == null) {
      return;
    }

    focusedInput.measureLayout(
      innerViewNode,
      (_left: number, top: number, _width: number, height: number) => {
        const target = computeFieldScrollTarget({
          keyboardOpen: currentKeyboardHeight > 0,
          fieldTop: top,
          fieldHeight: height,
          visibleHeight: viewportHeightRef.current - currentKeyboardHeight - FOCUS_SCROLL_MARGIN,
          scrollY: scrollOffsetRef.current,
        });
        if (target !== null) {
          scrollView.scrollTo({ y: target, animated: true });
        }
      },
      () => {
        // Layout not settled yet, or nothing focused anymore — nothing to do.
      },
    );
  }, []);

  useEffect(() => {
    const handleShow = (event: KeyboardEvent) => {
      const height = event.endCoordinates?.height ?? 0;
      keyboardHeightRef.current = height;
      setKeyboardHeight(height);
      // The keyboard's own layout animation hasn't necessarily finished
      // yet — give it a frame before measuring against the new viewport.
      requestAnimationFrame(() => scrollFocusedInputIntoView(height));
    };
    const handleHide = () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
    };

    const showSubscription = Keyboard.addListener(SHOW_EVENT, handleShow);
    const hideSubscription = Keyboard.addListener(HIDE_EVENT, handleHide);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollFocusedInputIntoView]);

  /**
   * The other half of the fix, alongside the keyboard-show handler above:
   * a field reports focus here directly (see `useReportFieldFocus`) so
   * switching to a DIFFERENT field while the keyboard is already open also
   * scrolls — the show event only ever fires once, when the keyboard first
   * opens. Closed keyboard is deliberately ignored here: the show handler
   * is about to fire and do this itself once it opens, so scrolling twice
   * would just make the content jump.
   */
  const handleFieldFocus = useCallback(() => {
    if (keyboardHeightRef.current <= 0) {
      return;
    }
    scrollFocusedInputIntoView(keyboardHeightRef.current);
  }, [scrollFocusedInputIntoView]);

  return (
    <FieldFocusReportContext.Provider value={handleFieldFocus}>
      <SafeAreaView style={[styles.safeArea, style]} edges={['top', 'left', 'right']}>
        {header}
        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          onLayout={(event) => {
            viewportHeightRef.current = event.nativeEvent.layout.height;
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}>
          {children}
          <Animated.View style={{ height: paddingAnim }} />
        </ScrollView>
      </SafeAreaView>
    </FieldFocusReportContext.Provider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
});
