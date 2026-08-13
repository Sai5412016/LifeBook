/**
 * Fotochronik — Vollbildansicht, wischbar wie die Android-Galerie.
 *
 * Blättert horizontal über ALLE Fotos des Kindes, in derselben Reihenfolge
 * wie die Chronik (`occurred_at` absteigend — siehe
 * `repository.ts#usePhotosOfChild`). Kopfzeile, Positionsangabe, Teilen und
 * Löschen beziehen sich immer auf das gerade sichtbare Foto (`currentIndex`),
 * nicht mehr auf die Route selbst — die Route-`id` dient nur noch dazu, beim
 * Öffnen die Startposition in der Liste zu finden.
 *
 * KEIN NEUES NATIVES MODUL: eine horizontale FlatList mit `pagingEnabled` +
 * `getItemLayout` übernimmt das Paging. `react-native-pager-view` wäre ein
 * neues natives Modul und damit ein erzwungener Build (siehe CLAUDE.md,
 * Fallstrick 5) — bewusst nicht verwendet.
 *
 * `getItemLayout` ist außerdem, was `initialScrollIndex` (kein sichtbarer
 * Sprung beim Öffnen) UND das programmatische `scrollToIndex` nach dem
 * Löschen zuverlässig macht: ohne sie müsste die Liste erst rendern und
 * messen, bevor sie irgendwo hin springen kann.
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ageInDays, formatDayLabel, formatTimeLabel } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { formatAgeLabel, isOccurredAtEstimated, resolveFullscreenUri } from '@/features/photos/identity';
import { useSharePhotos, useSignedUrls } from '@/features/photos/hooks';
import { deleteQuietly } from '@/features/photos/media';
import {
  correctPhotoOccurredAt,
  softDeletePhoto,
  usePhotoById,
  usePhotosOfChild,
} from '@/features/photos/repository';
import { formatShareFailureSummary, formatShareProgressLabel } from '@/features/photos/sharing';
import { healMissingMedium, removeStoredObjects } from '@/features/photos/storage';
import type { PhotoRow } from '@/features/photos/types';
import {
  clampIndex,
  formatPositionLabel,
  indexAfterDeletion,
  indexOfPhoto,
  neighborIndices,
  windowIndices,
} from '@/features/photos/viewer';
import { KeyboardSafeScreen, TextField } from '@/ui';

/** Signed URLs are kept warm for the current photo plus this many on each side. */
const SIGNED_URL_WINDOW_RADIUS = 3;
/** Aufgabe 4d: how many neighbors on EACH side get their image bytes prefetched while swiping. */
const PREFETCH_RADIUS = 2;

// Same format/validation as kind/bearbeiten.tsx's birth date/time fields —
// no native date picker (a new native module, see CLAUDE.md Fallstrick 5).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function FotoVollbildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList<PhotoRow>>(null);
  const pendingIndexRef = useRef<number | null>(null);

  // Only used to resolve which child this photo belongs to, so the full
  // ordered list below can be loaded. Once that list is ready, the actual
  // state of truth for everything on screen is `photos[currentIndex]`, not
  // this single-row query.
  const { photo: initialPhoto, isLoading: initialPhotoLoading } = usePhotoById(id);
  const { photos, isLoading: photosLoading } = usePhotosOfChild(initialPhoto?.child_id);
  const { child } = useActiveChild();

  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { progress: shareProgress, share, cancel: cancelShare } = useSharePhotos();

  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState(false);

  const resolvedInitialIndex = indexOfPhoto(photos, id);

  // Bootstraps the starting position exactly once, the moment the ordered
  // list first contains the tapped photo. Never runs again afterwards — from
  // here on `currentIndex` is driven by swipes (handleMomentumScrollEnd) and
  // by handleDelete.
  useEffect(() => {
    if (currentIndex === null && resolvedInitialIndex >= 0) {
      setCurrentIndex(resolvedInitialIndex);
    }
  }, [currentIndex, resolvedInitialIndex]);

  // Applies a scroll queued by handleDelete once the list has actually
  // shrunk — calling scrollToIndex before that would target a row that
  // doesn't exist yet in the FlatList's current `data`.
  useEffect(() => {
    if (pendingIndexRef.current === null) {
      return;
    }
    const target = clampIndex(pendingIndexRef.current, photos.length - 1);
    pendingIndexRef.current = null;
    setCurrentIndex(target);
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToIndex({ index: target, animated: false });
    });
  }, [photos]);

  // "Foto nicht verfügbar" only once we can be SURE, not just because a
  // query hasn't settled yet: either the tapped id never resolved to a row
  // at all, or the full list settled without that id in it.
  const notFound =
    (!initialPhotoLoading && !initialPhoto) ||
    (!!initialPhoto && !photosLoading && currentIndex === null && resolvedInitialIndex === -1);
  const loading = !notFound && currentIndex === null;

  const currentPhoto = currentIndex !== null ? photos[currentIndex] : undefined;

  const windowKeys = useMemo(() => {
    if (currentIndex === null) {
      return [];
    }
    return windowIndices(currentIndex, photos.length, SIGNED_URL_WINDOW_RADIUS)
      .map((index) => photos[index])
      .filter((entry): entry is PhotoRow => !!entry && !entry.local_uri)
      // Both keys, not just original: resolveFullscreenUri prefers medium
      // once it has a signed URL for it, so that has to be in the batch too.
      .flatMap((entry) => [entry.medium_key, entry.original_key])
      .filter((key): key is string => Boolean(key));
  }, [currentIndex, photos]);
  const signedUrls = useSignedUrls(windowKeys);

  // Aufgabe 3, 2026-08-13: the moment a photo without a medium rendition is
  // shown, heal it in the background — see storage.ts#healMissingMedium for
  // the WLAN-only / one-at-a-time / never-throws contract. Fires again every
  // time this SAME photo is reopened until it succeeds, so a photo skipped
  // because another heal was already running gets picked up eventually.
  useEffect(() => {
    if (!currentPhoto || currentPhoto.medium_key) {
      return;
    }
    void healMissingMedium(db, currentPhoto);
  }, [db, currentPhoto]);

  // Aufgabe 4d: prefetch the two neighbors on EACH side of whatever is
  // currently shown, so swiping either direction shows the next photo
  // instantly instead of waiting on its signed URL + download. Runs off
  // `signedUrls` too since a neighbor's medium/original URL may only just
  // have resolved.
  useEffect(() => {
    if (currentIndex === null) {
      return;
    }
    for (const index of neighborIndices(currentIndex, photos.length, PREFETCH_RADIUS)) {
      const display = resolveFullscreenUri(photos[index], signedUrls);
      if (!display) {
        continue;
      }
      Image.loadAsync({ uri: display.uri, cacheKey: display.cacheKey }).catch((error) => {
        console.error('[LifeBook] Vorabladen eines Nachbarfotos fehlgeschlagen', error);
      });
    }
  }, [currentIndex, photos, signedUrls]);

  const handleShare = useCallback(async () => {
    if (!currentPhoto) {
      return;
    }
    const outcome = await share([currentPhoto]);
    if (outcome.status === 'error') {
      Alert.alert('Teilen fehlgeschlagen', 'Bitte später erneut versuchen.');
      return;
    }
    if (outcome.status === 'done' && outcome.failedCount > 0) {
      Alert.alert(
        'Teilen nicht möglich',
        formatShareFailureSummary(outcome.failedCount, 1) ?? 'Das Foto konnte nicht geladen werden.',
      );
    }
  }, [currentPhoto, share]);

  const handleDelete = useCallback(async () => {
    if (!currentPhoto || currentIndex === null) {
      return;
    }

    setDeleting(true);
    try {
      await softDeletePhoto(db, currentPhoto.id);

      // Hartes Löschen der Dateien ist Best-Effort: schlägt es fehl, ist das
      // weiche Löschen in der Datenbank trotzdem gültig — protokollieren und
      // weitermachen statt abzubrechen.
      try {
        await removeStoredObjects(currentPhoto.thumb_key, currentPhoto.medium_key, currentPhoto.original_key);
      } catch (error) {
        console.error('[LifeBook] Speicherobjekte konnten nicht entfernt werden', error);
      }
      if (currentPhoto.local_uri) {
        deleteQuietly(currentPhoto.local_uri);
      }

      const nextIndex = indexAfterDeletion(currentIndex, photos.length);
      if (nextIndex === -1) {
        router.back();
        return;
      }
      // `photos` hasn't shrunk yet at this point (the reactive query re-runs
      // asynchronously) — queue the target and let the effect above apply it
      // once it has, so scrollToIndex never targets a row that isn't there yet.
      pendingIndexRef.current = nextIndex;
    } catch (error) {
      console.error('[LifeBook] Foto konnte nicht gelöscht werden', error);
    } finally {
      setDeleting(false);
    }
  }, [db, currentPhoto, currentIndex, photos.length]);

  // Prefilled from the CURRENT photo's own local_date/tz — the same values
  // it is actually filed under, not a recomputation from anything else.
  const handleOpenDateEditor = useCallback(() => {
    if (!currentPhoto) {
      return;
    }
    setDateInput(currentPhoto.local_date);
    setTimeInput(formatTimeLabel(currentPhoto.occurred_at, currentPhoto.tz));
    setDateError(null);
    setEditingDate(true);
  }, [currentPhoto]);

  const handleSaveDate = useCallback(async () => {
    if (!currentPhoto) {
      return;
    }
    setDateError(null);

    if (!DATE_RE.test(dateInput)) {
      setDateError('Datum bitte im Format JJJJ-MM-TT eingeben.');
      return;
    }
    if (!TIME_RE.test(timeInput)) {
      setDateError('Uhrzeit bitte im Format HH:MM eingeben.');
      return;
    }

    setSavingDate(true);
    try {
      const applied = await correctPhotoOccurredAt(db, currentPhoto, {
        localDate: dateInput,
        time: timeInput,
      });
      if (!applied) {
        setDateError('Datum/Uhrzeit konnten nicht verarbeitet werden.');
        return;
      }
      setEditingDate(false);
    } catch (error) {
      console.error('[LifeBook] Aufnahmedatum konnte nicht korrigiert werden', error);
      setDateError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSavingDate(false);
    }
  }, [db, currentPhoto, dateInput, timeInput]);

  // Der Text ist bewusst deutlich: "weiches Löschen" trifft nur die
  // Datenbankzeile, die Dateien im Speicher werden hart entfernt (siehe
  // handleDelete) — ohne Datei ist die Zeile für die Familie wertlos, das
  // Foto ist tatsächlich weg, auf beiden Handys. Solange es keinen echten
  // Papierkorb mit Wiederherstellung gibt, darf die Oberfläche keine
  // Rückholbarkeit suggerieren, die es nicht gibt.
  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Foto endgültig löschen?',
      'Das Foto wird unwiderruflich gelöscht — auch vom Handy des anderen Elternteils. Es gibt keine Möglichkeit, es wiederherzustellen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Endgültig löschen', style: 'destructive', onPress: handleDelete },
      ],
    );
  }, [handleDelete]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0 || photos.length === 0) {
        return;
      }
      const index = clampIndex(Math.round(event.nativeEvent.contentOffset.x / width), photos.length - 1);
      setCurrentIndex(index);
    },
    [width, photos.length],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<PhotoRow> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const renderItem = useCallback(
    ({ item }: { item: PhotoRow }) => {
      const display = resolveFullscreenUri(item, signedUrls);
      return (
        <View style={{ width, height: '100%' }}>
          {/* Kein Spinner hier: ein noch ungeladenes Bild soll ruhig
              erscheinen, nicht wackeln, während schnell durchgeblättert wird. */}
          {display ? (
            <Image
              source={{ uri: display.uri, cacheKey: display.cacheKey }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={120}
            />
          ) : (
            <View style={styles.image} />
          )}
        </View>
      );
    },
    [width, signedUrls],
  );

  // Computed live from the child's current birth_at/birth_tz, not trusted
  // from the photo's stored age_days — see
  // features/photos/identity.ts#groupPhotosByDay's doc comment.
  const currentPhotoAgeDays = currentPhoto && child ? ageInDays(currentPhoto.occurred_at, child.birthAtUtcIso, child.birthTz) : null;

  const headerSubtitle = currentPhoto
    ? [
        currentPhotoAgeDays !== null ? formatAgeLabel(currentPhotoAgeDays) : null,
        formatPositionLabel(currentIndex ?? 0, photos.length),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  // Nur in der Vollbildansicht, nie in der Kachelansicht — dort würde es
  // nur stören (siehe Aufgabenstellung). "Dezent": kleine, gedämpfte
  // Schrift, keine Warnfarbe — ein geschätztes Datum ist kein Fehler.
  const dateIsEstimated = currentPhoto ? isOccurredAtEstimated(currentPhoto.occurred_at_source) : false;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} disabled={deleting}>
            <ThemedText style={styles.headerAction}>Zurück</ThemedText>
          </Pressable>

          {currentPhoto ? (
            <Pressable style={styles.headerInfo} onPress={handleOpenDateEditor} hitSlop={8}>
              <ThemedText style={styles.headerTitle} numberOfLines={1}>
                {formatDayLabel(currentPhoto.local_date)} ✎
              </ThemedText>
              <ThemedText style={styles.headerSubtitle}>{headerSubtitle}</ThemedText>
              {dateIsEstimated ? (
                <ThemedText style={styles.estimatedBadge}>Datum geschätzt</ThemedText>
              ) : null}
            </Pressable>
          ) : (
            <View style={styles.headerInfo} />
          )}

          <View style={styles.headerActionsRight}>
            <Pressable
              onPress={handleShare}
              hitSlop={12}
              disabled={!currentPhoto || deleting || shareProgress !== null}>
              <ThemedText style={styles.headerAction}>Teilen</ThemedText>
            </Pressable>
            <Pressable onPress={confirmDelete} hitSlop={12} disabled={!currentPhoto || deleting}>
              {deleting ? (
                <ActivityIndicator color="#ff453a" />
              ) : (
                <ThemedText style={[styles.headerAction, styles.deleteAction]}>Löschen</ThemedText>
              )}
            </Pressable>
          </View>
        </View>

        {shareProgress ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color="#ffffff" />
            <ThemedText style={styles.progressText}>
              {formatShareProgressLabel(shareProgress.current, shareProgress.total)}
            </ThemedText>
            <Pressable onPress={cancelShare} hitSlop={12}>
              <ThemedText style={styles.headerAction}>Abbrechen</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.imageArea}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : notFound ? (
            <ThemedText style={styles.placeholderText}>Foto nicht verfügbar</ThemedText>
          ) : (
            <FlatList
              ref={flatListRef}
              data={photos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              initialScrollIndex={currentIndex ?? 0}
              getItemLayout={getItemLayout}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              renderItem={renderItem}
              onScrollToIndexFailed={(info) => {
                requestAnimationFrame(() => {
                  flatListRef.current?.scrollToOffset({
                    offset: info.averageItemLength * info.index,
                    animated: false,
                  });
                });
              }}
            />
          )}
        </View>
      </SafeAreaView>

      <Modal
        visible={editingDate}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingDate(false)}>
        <ThemedView style={styles.editRoot}>
          <KeyboardSafeScreen
            header={
              <View style={styles.editHeader}>
                <Pressable onPress={() => setEditingDate(false)} hitSlop={12} disabled={savingDate}>
                  <ThemedText type="link" themeColor="textSecondary">
                    Abbrechen
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold">Aufnahmedatum</ThemedText>
                <Pressable onPress={handleSaveDate} hitSlop={12} disabled={savingDate}>
                  <ThemedText type="linkPrimary">{savingDate ? '…' : 'Speichern'}</ThemedText>
                </Pressable>
              </View>
            }
            contentContainerStyle={styles.editContent}>
            <View style={styles.editRow}>
              <View style={styles.editField}>
                <TextField
                  label="Datum (JJJJ-MM-TT)"
                  value={dateInput}
                  onChangeText={setDateInput}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.editField}>
                <TextField
                  label="Uhrzeit (HH:MM)"
                  value={timeInput}
                  onChangeText={setTimeInput}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                />
              </View>
            </View>
            {dateError ? (
              <ThemedText type="small" themeColor="dangerText">
                {dateError}
              </ThemedText>
            ) : null}
          </KeyboardSafeScreen>
        </ThemedView>
      </Modal>
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
  headerActionsRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  deleteAction: { color: '#ff453a' },
  headerInfo: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  headerSubtitle: { color: '#B0B4BA', fontSize: 12 },
  estimatedBadge: { color: '#B0B4BA', fontSize: 11, fontStyle: 'italic', marginTop: 2 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  progressText: { flex: 1, color: '#ffffff', fontSize: 14 },
  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  placeholderText: { color: '#B0B4BA' },
  editRoot: { flex: 1 },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  editContent: { gap: Spacing.three, paddingHorizontal: Spacing.three, paddingBottom: Spacing.five },
  editRow: { flexDirection: 'row', gap: Spacing.two },
  editField: { flex: 1 },
});
