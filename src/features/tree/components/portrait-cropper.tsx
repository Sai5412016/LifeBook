/**
 * tree/components/portrait-cropper — the pan/zoom crop step between
 * picking a portrait from the gallery and uploading it. Without this step
 * the picked photo went straight to the bucket unchanged and then got
 * squeezed into a circle on screen — a portrait or a photo taken at an
 * angle regularly put the face outside that circle. Shared by BOTH the
 * Stammbaum (features/tree/components/relative-form.tsx) and Menschen
 * (features/people/components/person-form.tsx) portrait pickers — same
 * problem, one fix, not duplicated per feature.
 *
 * Deliberately NOT `ImagePicker.launchImageLibraryAsync({ allowsEditing:
 * true })` — the OS's built-in editor looks different per manufacturer,
 * cannot be shaped to a circle, and does not reliably return a square
 * (task's own explicit instruction).
 *
 * All geometry — how far a pan/zoom may go without empty borders, and
 * which rectangle of the ORIGINAL image the frame currently shows — is
 * pure and tested in ./portrait-crop-math.ts.
 *
 * FEHLER 2026-08-24: FROR BEIM SCHIEBEN/ZOOMEN EIN — ZWEI URSACHEN
 * -----------------------------------------------------------------
 * 1. `clampPortraitTransform`/`clampZoom` were called from the pan/pinch
 *    gestures' `.onUpdate()` — Reanimated UI-thread worklets — without
 *    being worklets themselves. Every call was an unintended UI→JS thread
 *    round trip, on every touch-move frame. Fixed in portrait-crop-math.ts
 *    (`'worklet'` directive); nothing here changed to fix this half.
 * 2. The gesture panned/zoomed the picked photo at FULL resolution (a
 *    modern phone photo is several thousand pixels per side) — this file
 *    now builds a downscaled preview once, on open (`buildPortraitPreview`,
 *    longest edge ~1200px), and the gesture only ever touches that. The
 *    final crop still reads the ORIGINAL file — see `handleConfirm` and
 *    portrait-crop-math.ts#portraitCropRect's own doc comment.
 */

import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useUiColors, withAlpha } from '@/ui';

import { clampPortraitTransform, clampZoom, portraitCropRect, MIN_ZOOM } from './portrait-crop-math';

/** Output size, task requirement: 800×800, matching every other portrait in the app. */
const OUTPUT_SIZE = 800;
const OUTPUT_QUALITY = 0.85;
/** Longest edge of the on-screen preview the gesture actually transforms — small enough to pan/zoom every frame without stalling, large enough to still look sharp on any phone screen. */
const PREVIEW_MAX_EDGE = 1200;
const PREVIEW_QUALITY = 0.9;
/** Margin around the square crop frame, leaving room for the title and buttons above/below on a small phone screen. */
const FRAME_MARGIN = 64;

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; uri: string; width: number; height: number }
  | { status: 'error' };

/**
 * Builds the downscaled preview the gesture pans/zooms — a real resize
 * call only when the picked photo is actually bigger than
 * `PREVIEW_MAX_EDGE`; an already-small image (e.g. a screenshot) is used
 * as-is rather than re-encoded for no reason.
 */
async function buildPortraitPreview(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ uri: string; width: number; height: number }> {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  if (longestEdge <= PREVIEW_MAX_EDGE) {
    return { uri: sourceUri, width: sourceWidth, height: sourceHeight };
  }
  const resize = sourceWidth >= sourceHeight ? { width: PREVIEW_MAX_EDGE } : { height: PREVIEW_MAX_EDGE };
  const rendered = await ImageManipulator.manipulate(sourceUri).resize(resize).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PREVIEW_QUALITY });
  return { uri: saved.uri, width: rendered.width, height: rendered.height };
}

export type PortraitCropperProps = {
  /** Local file URI of the JUST-PICKED, not-yet-uploaded ORIGINAL image — never displayed directly, only cropped from at the very end. */
  imageUri: string;
  /** Natural pixel dimensions of that original — the picker already knows these, no extra probe needed. */
  imageWidth: number;
  imageHeight: number;
  /** Bisheriges Portrait bleibt unverändert (task requirement). */
  onCancel: () => void;
  /** Called with the LOCAL URI of the already-cropped-and-resized 800×800 JPEG, once expo-image-manipulator has finished. */
  onConfirm: (croppedUri: string) => void;
};

export function PortraitCropper({ imageUri, imageWidth, imageHeight, onCancel, onConfirm }: PortraitCropperProps) {
  const { width, height } = useWindowDimensions();
  const { accent } = useUiColors();
  const frameSize = Math.max(Math.min(width, height) - FRAME_MARGIN * 2, 120);

  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [processing, setProcessing] = useState(false);

  const zoom = useSharedValue(MIN_ZOOM);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startZoom = useSharedValue(MIN_ZOOM);
  const startOffsetX = useSharedValue(0);
  const startOffsetY = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    setPreview({ status: 'loading' });
    zoom.value = MIN_ZOOM;
    offsetX.value = 0;
    offsetY.value = 0;

    buildPortraitPreview(imageUri, imageWidth, imageHeight)
      .then((result) => {
        if (!cancelled) {
          setPreview({ status: 'ready', ...result });
        }
      })
      .catch((previewError) => {
        console.error('[LifeBook] Vorschau für den Zuschnitt fehlgeschlagen', previewError);
        if (!cancelled) {
          setPreview({ status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUri]);

  const ready = preview.status === 'ready';
  const busy = preview.status === 'loading' || processing;
  const previewWidth = ready ? preview.width : imageWidth;
  const previewHeight = ready ? preview.height : imageHeight;
  const baseScale = frameSize / Math.min(previewWidth, previewHeight);

  // `previewWidth`/`previewHeight`/`frameSize` are plain values from THIS
  // render, closed over by the gesture callbacks below — same reasoning as
  // tree-view.tsx's own pan/pinch gestures: these objects are re-created
  // every render (not memoized), so each render's worklets see the current
  // values. `clampPortraitTransform`/`clampZoom` are worklets themselves
  // (portrait-crop-math.ts) — required, not optional, see this file's own
  // header on Fehler 1.
  const pan = Gesture.Pan()
    .onStart(() => {
      startOffsetX.value = offsetX.value;
      startOffsetY.value = offsetY.value;
    })
    .onUpdate((event) => {
      const clamped = clampPortraitTransform(
        previewWidth,
        previewHeight,
        frameSize,
        zoom.value,
        startOffsetX.value + event.translationX,
        startOffsetY.value + event.translationY,
      );
      offsetX.value = clamped.offsetX;
      offsetY.value = clamped.offsetY;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      const nextZoom = clampZoom(startZoom.value * event.scale);
      zoom.value = nextZoom;
      const clamped = clampPortraitTransform(previewWidth, previewHeight, frameSize, nextZoom, offsetX.value, offsetY.value);
      offsetX.value = clamped.offsetX;
      offsetY.value = clamped.offsetY;
    });

  const composedGesture = Gesture.Simultaneous(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    width: previewWidth * baseScale,
    height: previewHeight * baseScale,
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: zoom.value }],
  }));

  const handleConfirm = async () => {
    if (preview.status !== 'ready' || busy) {
      return;
    }
    setProcessing(true);
    try {
      const rect = portraitCropRect(
        preview.width,
        preview.height,
        imageWidth,
        imageHeight,
        frameSize,
        zoom.value,
        offsetX.value,
        offsetY.value,
      );
      const cropped = await ImageManipulator.manipulate(imageUri)
        .crop({
          originX: Math.round(rect.x),
          originY: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE })
        .renderAsync();
      const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: OUTPUT_QUALITY });
      onConfirm(saved.uri);
    } catch (cropError) {
      console.error('[LifeBook] Zuschnitt fehlgeschlagen', cropError);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      {/* RN's Modal opens its own native window, separate from the app
          root's GestureHandlerRootView (src/app/_layout.tsx) — without a
          SECOND one here, gestures inside a Modal are unreliable on
          Android (documented react-native-gesture-handler limitation). */}
      <GestureHandlerRootView style={styles.root}>
        <ThemedView style={styles.content}>
          <ThemedText type="smallBold">Portrait zuschneiden</ThemedText>

          <View style={[styles.frameWrapper, { width: frameSize, height: frameSize }]}>
            {ready ? (
              <>
                <GestureDetector gesture={composedGesture}>
                  <View style={styles.viewport}>
                    <Animated.View style={animatedStyle}>
                      <Image source={{ uri: preview.uri }} style={styles.image} contentFit="cover" />
                    </Animated.View>
                  </View>
                </GestureDetector>
                <View pointerEvents="none" style={[styles.circleOverlay, { borderColor: accent }]} />
              </>
            ) : (
              <View style={styles.viewport}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.previewErrorText}>
                  {preview.status === 'error' ? 'Vorschau fehlgeschlagen.' : ''}
                </ThemedText>
              </View>
            )}
            {busy ? (
              <View pointerEvents="none" style={[styles.busyOverlay, { backgroundColor: withAlpha('#000000', 0.35) }]}>
                <ActivityIndicator color="#ffffff" />
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={12} disabled={busy}>
              <ThemedText type="link" themeColor="textSecondary">
                Abbrechen
              </ThemedText>
            </Pressable>
            <Pressable onPress={handleConfirm} hitSlop={12} disabled={busy || preview.status !== 'ready'}>
              <ThemedText type="linkPrimary">{processing ? '…' : 'Übernehmen'}</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  frameWrapper: { borderRadius: Spacing.two, overflow: 'hidden' },
  viewport: { width: '100%', height: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  previewErrorText: { textAlign: 'center', paddingHorizontal: Spacing.three },
  circleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    borderWidth: 2,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.six,
    alignItems: 'center',
  },
});
