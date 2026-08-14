/**
 * Papierkorb — gelöschte Fotos, 30 Tage lang wiederherstellbar
 * (features/photos/identity.ts#TRASH_RETENTION_DAYS). Erreichbar aus
 * Einstellungen, Abschnitt Fotos.
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { nowUtcIso } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { useSignedUrls } from '@/features/photos/hooks';
import {
  formatEmptyTrashConfirmation,
  formatPermanentDeleteConfirmation,
  formatPhotoRestoreConfirmation,
  formatTrashRemainingLabel,
} from '@/features/photos/identity';
import { restorePhoto, useDeletedPhotosOfChild } from '@/features/photos/repository';
import { emptyTrash, permanentlyDeletePhoto } from '@/features/photos/storage';
import type { PhotoRow } from '@/features/photos/types';

export default function PapierkorbScreen() {
  const db = usePowerSync();
  const { child } = useActiveChild();
  const { photos, isLoading } = useDeletedPhotosOfChild(child?.childId);
  const signedUrls = useSignedUrls(photos.map((photo) => photo.thumb_key));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = (photo: PhotoRow) => {
    Alert.alert('Foto wiederherstellen?', formatPhotoRestoreConfirmation(), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Wiederherstellen',
        onPress: async () => {
          setError(null);
          setBusyId(photo.id);
          try {
            await restorePhoto(db, photo.id);
          } catch (restoreError) {
            console.error('[LifeBook] Foto konnte nicht wiederhergestellt werden', restoreError);
            setError('Wiederherstellen fehlgeschlagen. Bitte erneut versuchen.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handlePermanentDelete = (photo: PhotoRow) => {
    Alert.alert('Foto endgültig löschen?', formatPermanentDeleteConfirmation(), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Endgültig löschen',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          setBusyId(photo.id);
          try {
            await permanentlyDeletePhoto(db, photo);
          } catch (deleteError) {
            console.error('[LifeBook] Foto konnte nicht endgültig gelöscht werden', deleteError);
            setError('Endgültiges Löschen fehlgeschlagen. Bitte erneut versuchen.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handleEmptyTrash = () => {
    if (photos.length === 0) {
      return;
    }
    Alert.alert('Papierkorb leeren?', formatEmptyTrashConfirmation(photos.length), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Papierkorb leeren',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          setBusyAll(true);
          try {
            const result = await emptyTrash(db, photos);
            if (result.failed > 0) {
              setError(
                result.failed === 1
                  ? '1 Foto konnte nicht gelöscht werden.'
                  : `${result.failed} Fotos konnten nicht gelöscht werden.`,
              );
            }
          } finally {
            setBusyAll(false);
          }
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Papierkorb</ThemedText>
          <Pressable onPress={handleEmptyTrash} hitSlop={12} disabled={photos.length === 0 || busyAll}>
            <ThemedText type="linkPrimary" themeColor={photos.length === 0 ? 'textSecondary' : 'dangerText'}>
              {busyAll ? '…' : 'Leeren'}
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          {isLoading ? (
            <ActivityIndicator />
          ) : photos.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Der Papierkorb ist leer.
            </ThemedText>
          ) : (
            photos.map((photo) => (
              <TrashRow
                key={photo.id}
                photo={photo}
                signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
                busy={busyId === photo.id}
                onRestore={() => handleRestore(photo)}
                onDelete={() => handlePermanentDelete(photo)}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function TrashRow({
  photo,
  signedUrl,
  busy,
  onRestore,
  onDelete,
}: {
  photo: PhotoRow;
  signedUrl: string | undefined;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const uri = photo.local_uri ?? signedUrl;
  const remainingLabel = photo.deleted_at ? formatTrashRemainingLabel(photo.deleted_at, nowUtcIso()) : '';

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <View style={styles.thumbWrap}>
        {uri ? (
          <Image
            source={{ uri, cacheKey: photo.thumb_key ?? photo.id }}
            style={styles.thumb}
            contentFit="cover"
          />
        ) : null}
      </View>
      <View style={styles.rowInfo}>
        <ThemedText type="small" themeColor="textSecondary">
          {remainingLabel}
        </ThemedText>
        <View style={styles.rowActions}>
          <Pressable onPress={onRestore} disabled={busy} hitSlop={8}>
            <ThemedText type="linkPrimary">Wiederherstellen</ThemedText>
          </Pressable>
          <Pressable onPress={onDelete} disabled={busy} hitSlop={8}>
            <ThemedText type="linkPrimary" themeColor="dangerText">
              Endgültig löschen
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const TILE_SIZE = 64;

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  thumbWrap: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  rowInfo: { flex: 1, gap: Spacing.one },
  rowActions: { flexDirection: 'row', gap: Spacing.three },
});
