/**
 * Fotochronik Stufe 2 — Vollbildansicht eines einzelnen Fotos, mit Löschen.
 *
 * Bild bevorzugt die lokal zwischengelagerte Datei (`local_uri`), solange sie
 * noch existiert, und fällt sonst auf eine signierte URL des Originals
 * zurück — dieselbe Präferenz, die die Kacheln in der Chronik für ihr
 * Vorschaubild nutzen (siehe `resolveFullscreenUri`).
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatDayLabel } from '@/core/time';
import { formatAgeLabel, resolveFullscreenUri } from '@/features/photos/identity';
import { useSignedUrls } from '@/features/photos/hooks';
import { deleteQuietly } from '@/features/photos/media';
import { softDeletePhoto, usePhotoById } from '@/features/photos/repository';
import { removeStoredObjects } from '@/features/photos/storage';

export default function FotoVollbildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const { photo, isLoading } = usePhotoById(id);
  const [deleting, setDeleting] = useState(false);

  const signedUrls = useSignedUrls([photo?.original_key]);
  const uri = photo ? resolveFullscreenUri(photo, signedUrls) : undefined;

  const handleDelete = useCallback(async () => {
    if (!photo) {
      return;
    }

    setDeleting(true);
    try {
      await softDeletePhoto(db, photo.id);

      // Hartes Löschen der Dateien ist Best-Effort: schlägt es fehl, ist das
      // weiche Löschen in der Datenbank trotzdem gültig — protokollieren und
      // weitermachen statt abzubrechen.
      try {
        await removeStoredObjects(photo.thumb_key, photo.original_key);
      } catch (error) {
        console.error('[LifeBook] Speicherobjekte konnten nicht entfernt werden', error);
      }

      if (photo.local_uri) {
        deleteQuietly(photo.local_uri);
      }

      router.back();
    } catch (error) {
      console.error('[LifeBook] Foto konnte nicht gelöscht werden', error);
      setDeleting(false);
    }
  }, [db, photo]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Foto löschen?',
      'Das Foto wird aus der Chronik entfernt. Das kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Löschen', style: 'destructive', onPress: handleDelete },
      ],
    );
  }, [handleDelete]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} disabled={deleting}>
            <ThemedText style={styles.headerAction}>Zurück</ThemedText>
          </Pressable>

          {photo ? (
            <View style={styles.headerInfo}>
              <ThemedText style={styles.headerTitle} numberOfLines={1}>
                {formatDayLabel(photo.local_date)}
              </ThemedText>
              {photo.age_days !== null ? (
                <ThemedText style={styles.headerSubtitle}>
                  {formatAgeLabel(photo.age_days)}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <View style={styles.headerInfo} />
          )}

          <Pressable onPress={confirmDelete} hitSlop={12} disabled={!photo || deleting}>
            {deleting ? (
              <ActivityIndicator color="#ff453a" />
            ) : (
              <ThemedText style={[styles.headerAction, styles.deleteAction]}>Löschen</ThemedText>
            )}
          </Pressable>
        </View>

        <View style={styles.imageArea}>
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : uri ? (
            <Image source={{ uri }} style={styles.image} contentFit="contain" transition={120} />
          ) : (
            <ThemedText style={styles.placeholderText}>Foto nicht verfügbar</ThemedText>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  headerAction: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  deleteAction: { color: '#ff453a' },
  headerInfo: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  headerSubtitle: { color: '#B0B4BA', fontSize: 12 },
  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  placeholderText: { color: '#B0B4BA' },
});
