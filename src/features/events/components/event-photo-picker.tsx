/**
 * events/components/event-photo-picker — the photo grid for the event
 * form's "Fotos" section (task: reuse the Chronik's existing multi-select —
 * `toggleSelected` from photos/selection.ts, applied here exactly like
 * features/shares/components/photo-picker.tsx already does for shares).
 *
 * Order matters here in a way it doesn't for a share: the FIRST selected
 * photo becomes the event's title image (features/events/logic.ts#planEventPhotoOrder),
 * so every selected tile shows its position instead of a plain checkmark —
 * a star on the title image, a number on the rest.
 */

import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSignedUrls } from '@/features/photos/hooks';
import { usePhotosOfChild } from '@/features/photos/repository';
import type { PhotoRow } from '@/features/photos/types';
import { useUiColors } from '@/ui';

const TILE_SIZE = 96;

export function EventPhotoPicker({
  childId,
  selectedIds,
  onToggle,
}: {
  childId: string | undefined;
  selectedIds: readonly string[];
  onToggle: (photoId: string) => void;
}) {
  const { photos, isLoading } = usePhotosOfChild(childId);
  const thumbKeys = useMemo(() => photos.map((photo) => photo.thumb_key), [photos]);
  const signedUrls = useSignedUrls(thumbKeys);

  if (isLoading) {
    return null;
  }

  if (photos.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Noch keine Fotos vorhanden.
      </ThemedText>
    );
  }

  return (
    <View style={styles.wrapper}>
      {selectedIds.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Das zuerst ausgewählte Foto (★) wird das Titelbild.
        </ThemedText>
      ) : null}
      <View style={styles.grid}>
        {photos.map((photo) => (
          <EventPhotoTile
            key={photo.id}
            photo={photo}
            signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
            order={selectedIds.indexOf(photo.id)}
            onPress={() => onToggle(photo.id)}
          />
        ))}
      </View>
    </View>
  );
}

function EventPhotoTile({
  photo,
  signedUrl,
  order,
  onPress,
}: {
  photo: PhotoRow;
  signedUrl: string | undefined;
  /** Index within the current selection, or -1 if not selected. */
  order: number;
  onPress: () => void;
}) {
  const selected = order !== -1;
  const uri = photo.local_uri ?? signedUrl;
  const { accent } = useUiColors();

  return (
    <Pressable onPress={onPress}>
      <ThemedView
        type="backgroundElement"
        style={[styles.tile, selected && { borderColor: accent, borderWidth: 3 }]}>
        {uri ? (
          <Image
            source={{ uri, cacheKey: photo.thumb_key ?? photo.id }}
            style={styles.tileImage}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        {selected ? (
          <View style={[styles.badge, { backgroundColor: accent, borderColor: accent }]}>
            <ThemedText style={styles.badgeText}>{order === 0 ? '★' : String(order + 1)}</ThemedText>
          </View>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  tileImage: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
