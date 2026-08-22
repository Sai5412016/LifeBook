/**
 * Ereignis-Detailansicht — Titel, Datum, Alter, Text und alle verknüpften
 * Fotos als Raster. Antippen eines Fotos öffnet die vorhandene
 * Vollbildansicht (src/app/foto/[id].tsx) — dieselbe Route, die auch die
 * Chronik verwendet, unverändert. Erreichbar durch Antippen eines
 * Ereignisses im Ereignisse-Reiter; "Bearbeiten" führt zu ./bearbeiten,
 * exakt das Muster von src/app/menschen/[id]/index.tsx.
 */

import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatEventAgeLabel, formatShortGermanDate } from '@/features/events/logic';
import { useEventById, useEventPhotos } from '@/features/events/repository';
import { useActiveChild } from '@/features/household/repository';
import { useSignedUrls } from '@/features/photos/hooks';
import { usePhotosOfChild } from '@/features/photos/repository';

const COLUMNS = 3;

export default function EreignisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useActiveChild();
  const { event, isLoading } = useEventById(id);
  const { photoIds } = useEventPhotos(id);
  // Reactive photo rows, keyed by id — the event only stores photo ids, the
  // actual thumb/local uri comes from the child's own photo list, same
  // source features/events/components/event-photo-picker.tsx reads from.
  const { photos } = usePhotosOfChild(child?.childId);
  const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const orderedPhotos = photoIds.map((photoId) => photosById.get(photoId)).filter((p) => p !== undefined);
  const thumbKeys = orderedPhotos.map((photo) => photo.thumb_key);
  const signedUrls = useSignedUrls(thumbKeys);

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!event) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Ereignis nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }

  const ageLabel = child ? formatEventAgeLabel(event.occurred_at, child.birthAtUtcIso, child.birthTz) : '';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Ereignis</ThemedText>
          <Pressable onPress={() => router.push(`/ereignisse/${event.id}/bearbeiten`)} hitSlop={12}>
            <ThemedText type="linkPrimary">Bearbeiten</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{event.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatShortGermanDate(event.local_date)}
            {ageLabel ? ` · ${ageLabel}` : ''}
          </ThemedText>

          {event.note ? (
            <ThemedText type="default" style={styles.note}>
              {event.note}
            </ThemedText>
          ) : null}

          {orderedPhotos.length > 0 ? (
            <View style={styles.grid}>
              {orderedPhotos.map((photo) => {
                const uri = photo.local_uri ?? (photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined);
                return (
                  <Pressable
                    key={photo.id}
                    style={styles.tile}
                    onPress={() => router.push(`/foto/${photo.id}`)}>
                    <ThemedView type="backgroundElement" style={styles.tileInner}>
                      {uri ? (
                        <Image
                          source={{ uri, cacheKey: photo.thumb_key ?? photo.id }}
                          style={styles.tileImage}
                          contentFit="cover"
                          transition={120}
                        />
                      ) : null}
                    </ThemedView>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  note: { marginTop: Spacing.one },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  tile: {
    width: `${100 / COLUMNS}%`,
    aspectRatio: 1,
    padding: Spacing.half,
  },
  tileInner: { flex: 1, borderRadius: Spacing.two, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
});
