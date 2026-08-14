/**
 * shares/components/photo-picker — the photo grid used by both the create
 * form (features/shares, Aufgabe 3) and the detail screen's "Fotoauswahl
 * ändern". A non-virtualized `flexWrap` grid, same pattern as
 * `kind/bearbeiten.tsx`'s avatar picker — a share's photo count is bounded
 * by what a family actually wants to hand a guest, not a full album import.
 *
 * Reuses `toggleSelected`/`formatSelectionCountLabel` from
 * `photos/selection.ts` (the Chronik's own multi-select logic) rather than
 * reimplementing selection toggling — the tile itself is new because this
 * picker needs a state neither existing tile has: "not ready yet".
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
import { useUiColors, withAlpha } from '@/ui';

import { isPhotoReadyForShare } from '../logic';

const TILE_SIZE = 96;

export function SharePhotoPicker({
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
  const notReadyCount = useMemo(() => photos.filter((photo) => !isPhotoReadyForShare(photo)).length, [photos]);

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
      {notReadyCount > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notReadyCount === 1
            ? '1 Foto ist noch nicht bereit zum Teilen'
            : `${notReadyCount} Fotos sind noch nicht bereit zum Teilen`}{' '}
          — dafür in den Einstellungen erst „Alle Fotos vorbereiten" ausführen.
        </ThemedText>
      ) : null}
      <View style={styles.grid}>
        {photos.map((photo) => (
          <SharePhotoTile
            key={photo.id}
            photo={photo}
            signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
            selected={selectedIds.includes(photo.id)}
            onPress={() => onToggle(photo.id)}
          />
        ))}
      </View>
    </View>
  );
}

function SharePhotoTile({
  photo,
  signedUrl,
  selected,
  onPress,
}: {
  photo: PhotoRow;
  signedUrl: string | undefined;
  selected: boolean;
  onPress: () => void;
}) {
  const ready = isPhotoReadyForShare(photo);
  const uri = photo.local_uri ?? signedUrl;
  const { accent } = useUiColors();

  return (
    <Pressable onPress={ready ? onPress : undefined} disabled={!ready}>
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
        {!ready ? (
          <View style={[styles.notReadyOverlay, { backgroundColor: withAlpha('#000000', 0.55) }]}>
            <ThemedText style={styles.notReadyText}>wird vorbereitet</ThemedText>
          </View>
        ) : null}
        {ready && selected ? (
          <View style={[styles.selectionCheck, { backgroundColor: accent, borderColor: accent }]}>
            <ThemedText style={styles.selectionCheckMark}>✓</ThemedText>
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
  notReadyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.one,
  },
  notReadyText: { color: '#ffffff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  selectionCheck: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCheckMark: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
