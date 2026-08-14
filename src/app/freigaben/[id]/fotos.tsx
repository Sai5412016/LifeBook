/**
 * Freigabe — Fotoauswahl ändern. Erreichbar über "Ändern" im
 * Freigabe-Detailbildschirm (../[id].tsx).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useActiveChild } from '@/features/household/repository';
import { toggleSelected } from '@/features/photos/selection';
import { SharePhotoPicker } from '@/features/shares/components/photo-picker';
import { listSharePhotoIds, updateSharePhotoSelection } from '@/features/shares/repository';

export default function FreigabeFotosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useActiveChild();

  const [initialIds, setInitialIds] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    listSharePhotoIds(id)
      .then((ids) => {
        setInitialIds(ids);
        setSelectedIds(ids);
      })
      .catch((loadError: unknown) => {
        console.error('[LifeBook] Fotoauswahl konnte nicht geladen werden', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
      });
  }, [id]);

  const handleSave = async () => {
    if (!id || !initialIds) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateSharePhotoSelection(id, initialIds, selectedIds);
      router.back();
    } catch (saveError) {
      console.error('[LifeBook] Fotoauswahl konnte nicht gespeichert werden', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} disabled={saving}>
            <ThemedText type="link" themeColor="textSecondary">
              Abbrechen
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Fotoauswahl</ThemedText>
          <Pressable onPress={handleSave} hitSlop={12} disabled={saving || !initialIds}>
            <ThemedText type="linkPrimary">{saving ? '…' : 'Speichern'}</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}
          {initialIds === null ? (
            <ActivityIndicator />
          ) : (
            <SharePhotoPicker
              childId={child?.childId}
              selectedIds={selectedIds}
              onToggle={(photoId) => setSelectedIds((current) => toggleSelected(current, photoId))}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

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
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
});
