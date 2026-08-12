/**
 * Chronik — the photo timeline. Second tab: Füttern (the true start screen,
 * used many times a day) took the first slot and the "index" route name that
 * comes with it — see components/app-tabs.tsx.
 *
 * Photos are grouped by the day they were TAKEN (not imported) and labelled
 * with the child's age, which is the whole point: "Tag 4" means more to a
 * parent than a date does.
 *
 * Tiles prefer the local staged file while it is still on the device and fall
 * back to the signed preview URL afterwards, so a freshly imported photo appears
 * instantly instead of waiting for a round trip.
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { ageInDays, formatDayLabel, nowUtcIso } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import { formatAgeLabel } from '@/features/photos/identity';
import { PickCancelledError, describeImport, importPhotos } from '@/features/photos/import';
import { useSharePhotos, useSignedUrls } from '@/features/photos/hooks';
import { deleteQuietly } from '@/features/photos/media';
import { softDeletePhoto, usePendingUploadCount, usePhotoSections } from '@/features/photos/repository';
import {
  formatDeleteConfirmationMessage,
  formatSelectionCountLabel,
  toggleSelected,
} from '@/features/photos/selection';
import { formatShareFailureSummary, formatShareProgressLabel } from '@/features/photos/sharing';
import { removeStoredObjects, runUploadQueue } from '@/features/photos/storage';
import type { PhotoRow } from '@/features/photos/types';
import { BigButton, Button, useUiColors, withAlpha } from '@/ui';

const COLUMNS = 3;
const GRID_GAP = Spacing.half;

export default function ChronikScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const { sections, isLoading: photosLoading } = usePhotoSections(child?.childId);
  const pendingCount = usePendingUploadCount();
  const { width } = useWindowDimensions();
  const { progress: shareProgress, share, cancel: cancelShare } = useSharePhotos();
  const { accent, dangerText } = useUiColors();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const tileSize = Math.floor(
    (width - Spacing.three * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
  );

  const thumbKeys = useMemo(
    () => sections.flatMap((section) => section.photos.map((photo) => photo.thumb_key)),
    [sections],
  );
  const signedUrls = useSignedUrls(thumbKeys);

  const allPhotos = useMemo(() => sections.flatMap((section) => section.photos), [sections]);
  const selectedPhotos = useMemo(
    () => allPhotos.filter((photo) => selectedIds.includes(photo.id)),
    [allPhotos, selectedIds],
  );

  const handleExitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const handleLongPressTile = useCallback((photoId: string) => {
    setSelectionMode(true);
    setSelectedIds((current) => toggleSelected(current, photoId));
  }, []);

  const handleTapTile = useCallback(
    (photo: PhotoRow) => {
      if (selectionMode) {
        setSelectedIds((current) => toggleSelected(current, photo.id));
        return;
      }
      router.push(`/foto/${photo.id}`);
    },
    [selectionMode],
  );

  const handleShareSelected = useCallback(async () => {
    if (selectedPhotos.length === 0) {
      return;
    }
    setMessage(null);

    const outcome = await share(selectedPhotos);
    switch (outcome.status) {
      case 'rejected':
        setMessage(outcome.message);
        break;
      case 'cancelled':
        break;
      case 'error':
        setMessage('Teilen fehlgeschlagen. Details stehen im Protokoll.');
        break;
      case 'done': {
        const failureNote = formatShareFailureSummary(outcome.failedCount, selectedPhotos.length);
        const parts = [outcome.wifiWarning, failureNote].filter((part): part is string => Boolean(part));
        setMessage(parts.length > 0 ? parts.join(' ') : null);
        handleExitSelection();
        break;
      }
    }
  }, [selectedPhotos, share, handleExitSelection]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedPhotos.length === 0) {
      return;
    }
    const count = selectedPhotos.length;

    Alert.alert(count === 1 ? 'Foto löschen?' : 'Fotos löschen?', formatDeleteConfirmationMessage(count), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Endgültig löschen',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          let failed = 0;

          for (const photo of selectedPhotos) {
            try {
              await softDeletePhoto(db, photo.id);

              // Hartes Löschen der Dateien ist Best-Effort, wie in der
              // Vollbildansicht: schlägt es fehl, ist das weiche Löschen in
              // der Datenbank trotzdem gültig — protokollieren und
              // weitermachen statt abzubrechen.
              try {
                await removeStoredObjects(photo.thumb_key, photo.original_key);
              } catch (error) {
                console.error('[LifeBook] Speicherobjekte konnten nicht entfernt werden', error);
              }
              if (photo.local_uri) {
                deleteQuietly(photo.local_uri);
              }
            } catch (error) {
              failed += 1;
              console.error('[LifeBook] Foto konnte nicht gelöscht werden', error);
            }
          }

          setBusy(false);
          setMessage(
            failed === 0
              ? null
              : failed === 1
                ? '1 Foto konnte nicht gelöscht werden.'
                : `${failed} Fotos konnten nicht gelöscht werden.`,
          );
          handleExitSelection();
        },
      },
    ]);
  }, [selectedPhotos, db, handleExitSelection]);

  const handleImport = useCallback(async () => {
    if (!child || !session?.user.id) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const summary = await importPhotos(db, {
        householdId: child.householdId,
        childId: child.childId,
        userId: session.user.id,
        tz: deviceTimeZone(),
        birthAtUtcIso: child.birthAtUtcIso,
      });
      setMessage(describeImport(summary));
    } catch (error) {
      if (error instanceof PickCancelledError) {
        return;
      }
      console.error('[LifeBook] Foto-Import fehlgeschlagen', error);
      setMessage('Import fehlgeschlagen. Details stehen im Protokoll.');
    } finally {
      setBusy(false);
    }
  }, [child, db, session?.user.id]);

  const handleForceUpload = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runUploadQueue(db, { wifiOnly: false });
      setMessage(
        result.originals > 0
          ? `${result.originals} Foto${result.originals === 1 ? '' : 's'} hochgeladen.`
          : 'Nichts zu übertragen.',
      );
    } finally {
      setBusy(false);
    }
  }, [db]);

  if (childLoading || photosLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const todayAge = child
    ? formatAgeLabel(ageInDays(nowUtcIso(), child.birthAtUtcIso, child.birthTz))
    : '';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          {selectionMode ? (
            <ThemedView style={styles.selectionHeader}>
              <ThemedText type="title">{formatSelectionCountLabel(selectedPhotos.length)}</ThemedText>
              <Pressable onPress={handleExitSelection} hitSlop={8}>
                <ThemedText type="linkPrimary">Abbrechen</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <ThemedText type="title">{child ? child.firstName : 'Chronik'}</ThemedText>
              {todayAge ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Heute · {todayAge}
                </ThemedText>
              ) : null}
            </>
          )}
        </ThemedView>

        {!selectionMode ? (
          <ThemedView style={styles.actions}>
            <Button
              label="Fotos hinzufügen"
              onPress={handleImport}
              loading={busy}
              disabled={!child}
            />
            {pendingCount > 0 ? (
              <ThemedView type="backgroundElement" style={styles.pendingRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {pendingCount === 1
                    ? '1 Foto wartet auf WLAN'
                    : `${pendingCount} Fotos warten auf WLAN`}
                </ThemedText>
                <Pressable onPress={handleForceUpload} disabled={busy} hitSlop={8}>
                  <ThemedText type="linkPrimary">Jetzt übertragen</ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}
          </ThemedView>
        ) : null}

        {message ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {message}
          </ThemedText>
        ) : null}

        {shareProgress ? (
          <ThemedView type="backgroundElement" style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText type="small" style={styles.progressText}>
              {formatShareProgressLabel(shareProgress.current, shareProgress.total)}
            </ThemedText>
            <Pressable onPress={cancelShare} hitSlop={8}>
              <ThemedText type="linkPrimary">Abbrechen</ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}

        <SectionList
          sections={sections.map((section) => ({
            title: section.localDate,
            ageDays: section.ageDays,
            data: chunk(section.photos, COLUMNS),
          }))}
          keyExtractor={(row, index) => row[0]?.id ?? String(index)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedView style={styles.empty}>
              <ThemedText type="subtitle">Noch keine Fotos</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Füge die ersten Bilder hinzu. Sie werden nach Aufnahmedatum sortiert
                und mit dem Alter beschriftet — doppelte Bilder erkennt LifeBook
                automatisch.
              </ThemedText>
            </ThemedView>
          }
          renderSectionHeader={({ section }) => (
            <ThemedView style={styles.sectionHeader}>
              <ThemedText type="smallBold">{formatDayLabel(section.title)}</ThemedText>
              {section.ageDays !== null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatAgeLabel(section.ageDays)}
                </ThemedText>
              ) : null}
            </ThemedView>
          )}
          renderItem={({ item: row }) => (
            <ThemedView style={styles.gridRow}>
              {row.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  size={tileSize}
                  signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(photo.id)}
                  onPress={() => handleTapTile(photo)}
                  onLongPress={() => handleLongPressTile(photo.id)}
                />
              ))}
            </ThemedView>
          )}
        />

        {selectionMode ? (
          <ThemedView style={styles.selectionBar}>
            <BigButton
              label="Teilen"
              color={accent}
              variant="secondary"
              onPress={handleShareSelected}
              disabled={selectedPhotos.length === 0 || busy || shareProgress !== null}
            />
            <BigButton
              label="Löschen"
              color={dangerText}
              variant="secondary"
              onPress={handleDeleteSelected}
              disabled={selectedPhotos.length === 0 || busy}
            />
          </ThemedView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function PhotoTile({
  photo,
  size,
  signedUrl,
  selectionMode,
  selected,
  onPress,
  onLongPress,
}: {
  photo: PhotoRow;
  size: number;
  signedUrl: string | undefined;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // Local file first: it exists until the original is safely uploaded, and it
  // needs neither network nor a signed URL.
  const uri = photo.local_uri ?? signedUrl;
  const { accent } = useUiColors();

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress}>
      <ThemedView type="backgroundElement" style={[styles.tile, { width: size, height: size }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.tileImage}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        {selectionMode ? (
          <View style={[styles.selectionOverlay, selected && { backgroundColor: withAlpha(accent, 0.35) }]}>
            <View style={[styles.selectionCheck, selected && { backgroundColor: accent, borderColor: accent }]}>
              {selected ? <ThemedText style={styles.selectionCheckMark}>✓</ThemedText> : null}
            </View>
          </View>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

/** Split a day's photos into fixed-width rows for the grid. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  header: { gap: Spacing.one, paddingTop: Spacing.three },
  selectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { gap: Spacing.two, paddingVertical: Spacing.three },
  message: { paddingHorizontal: Spacing.one, paddingTop: Spacing.two },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  progressText: { flex: 1 },
  listContent: { paddingBottom: BottomTabInset + Spacing.four },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  gridRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  tile: { borderRadius: Spacing.two, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  selectionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: Spacing.one,
  },
  selectionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  selectionCheckMark: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  selectionBar: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  empty: { paddingTop: Spacing.five, gap: Spacing.two, alignItems: 'center' },
  emptyHint: { textAlign: 'center' },
});
