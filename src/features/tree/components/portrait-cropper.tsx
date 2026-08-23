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
 * which rectangle of the SOURCE image is currently framed — is pure and
 * tested in ./portrait-crop-math.ts. This file only wires
 * react-native-gesture-handler/reanimated (both already installed — no new
 * dependency, no new build, CLAUDE.md Fallstrick 5) to those shared
 * values, and calls expo-image-manipulator exactly once, on "Übernehmen".
 */

import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useUiColors } from '@/ui';

import { clampPortraitTransform, clampZoom, portraitCropRect, MIN_ZOOM } from './portrait-crop-math';

/** Output size, task requirement: 800×800, matching every other portrait in the app. */
const OUTPUT_SIZE = 800;
const OUTPUT_QUALITY = 0.85;
/** Margin around the square crop frame, leaving room for the title and buttons above/below on a small phone screen. */
const FRAME_MARGIN = 64;

export type PortraitCropperProps = {
  /** Local file URI of the JUST-PICKED, not-yet-uploaded image. */
  imageUri: string;
  /** Natural pixel dimensions of that image — the picker already knows these, no extra probe needed. */
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
  const baseScale = frameSize / Math.min(imageWidth, imageHeight);

  const zoom = useSharedValue(MIN_ZOOM);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startZoom = useSharedValue(MIN_ZOOM);
  const startOffsetX = useSharedValue(0);
  const startOffsetY = useSharedValue(0);

  const [processing, setProcessing] = useState(false);

  // `imageWidth`/`imageHeight`/`frameSize` are plain values from THIS
  // render, closed over by the gesture callbacks below — same reasoning as
  // tree-view.tsx's own pan/pinch gestures: these objects are re-created
  // every render (not memoized), so each render's worklets see the current
  // props, no `runOnJS` needed for plain shared-value writes.
  const pan = Gesture.Pan()
    .onStart(() => {
      startOffsetX.value = offsetX.value;
      startOffsetY.value = offsetY.value;
    })
    .onUpdate((event) => {
      const clamped = clampPortraitTransform(
        imageWidth,
        imageHeight,
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
      const clamped = clampPortraitTransform(imageWidth, imageHeight, frameSize, nextZoom, offsetX.value, offsetY.value);
      offsetX.value = clamped.offsetX;
      offsetY.value = clamped.offsetY;
    });

  const composedGesture = Gesture.Simultaneous(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    width: imageWidth * baseScale,
    height: imageHeight * baseScale,
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: zoom.value }],
  }));

  const handleConfirm = async () => {
    setProcessing(true);
    try {
      const rect = portraitCropRect(imageWidth, imageHeight, frameSize, zoom.value, offsetX.value, offsetY.value);
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
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      {/* RN's Modal opens its own native window, separate from the app
          root's GestureHandlerRootView (src/app/_layout.tsx) — without a
          SECOND one here, gestures inside a Modal are unreliable on
          Android (documented react-native-gesture-handler limitation). */}
      <GestureHandlerRootView style={styles.root}>
        <ThemedView style={styles.content}>
          <ThemedText type="smallBold">Portrait zuschneiden</ThemedText>

          <View style={[styles.frameWrapper, { width: frameSize, height: frameSize }]}>
            <GestureDetector gesture={composedGesture}>
              <View style={styles.viewport}>
                <Animated.View style={animatedStyle}>
                  <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
                </Animated.View>
              </View>
            </GestureDetector>
            <View pointerEvents="none" style={[styles.circleOverlay, { borderColor: accent }]} />
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onCancel} hitSlop={12} disabled={processing}>
              <ThemedText type="link" themeColor="textSecondary">
                Abbrechen
              </ThemedText>
            </Pressable>
            <Pressable onPress={handleConfirm} hitSlop={12} disabled={processing}>
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
  circleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    borderWidth: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.six,
    alignItems: 'center',
  },
});
