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
  Pressable,
  SectionList,
  StyleSheet,
  useWindowDimensions,
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
import { useSignedUrls } from '@/features/photos/hooks';
import { usePendingUploadCount, usePhotoSections } from '@/features/photos/repository';
import { runUploadQueue } from '@/features/photos/storage';
import type { PhotoRow } from '@/features/photos/types';
import { Button } from '@/ui';

const COLUMNS = 3;
const GRID_GAP = Spacing.half;

export default function ChronikScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const { sections, isLoading: photosLoading } = usePhotoSections(child?.childId);
  const pendingCount = usePendingUploadCount();
  const { width } = useWindowDimensions();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const tileSize = Math.floor(
    (width - Spacing.three * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
  );

  const thumbKeys = useMemo(
    () => sections.flatMap((section) => section.photos.map((photo) => photo.thumb_key)),
    [sections],
  );
  const signedUrls = useSignedUrls(thumbKeys);

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
          <ThemedText type="title">{child ? child.firstName : 'Chronik'}</ThemedText>
          {todayAge ? (
            <ThemedText type="small" themeColor="textSecondary">
              Heute · {todayAge}
            </ThemedText>
          ) : null}
        </ThemedView>

        <ThemedView style={styles.actions}>
          <Button
            label="Fotos hinzufügen"
            onPress={handleImport}
            loading={busy}
            disabled={!child}
          />
          {message ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              {message}
            </ThemedText>
          ) : null}
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
                />
              ))}
            </ThemedView>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function PhotoTile({
  photo,
  size,
  signedUrl,
}: {
  photo: PhotoRow;
  size: number;
  signedUrl: string | undefined;
}) {
  // Local file first: it exists until the original is safely uploaded, and it
  // needs neither network nor a signed URL.
  const uri = photo.local_uri ?? signedUrl;

  return (
    <Pressable onPress={() => router.push(`/foto/${photo.id}`)}>
      <ThemedView type="backgroundElement" style={[styles.tile, { width: size, height: size }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.tileImage}
            contentFit="cover"
            transition={120}
          />
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
  actions: { gap: Spacing.two, paddingVertical: Spacing.three },
  message: { paddingHorizontal: Spacing.one },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
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
  empty: { paddingTop: Spacing.five, gap: Spacing.two, alignItems: 'center' },
  emptyHint: { textAlign: 'center' },
});
