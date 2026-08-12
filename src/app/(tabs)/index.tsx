/**
 * Startseite (Reiter 1) — großes Foto, Name und Alter, eine antippbare
 * Geburtsdaten-Karte, ein Streifen der letzten fünf Fotos. Der Reitername
 * selbst zeigt den Kindnamen (siehe components/app-tabs.tsx); Einstellungen
 * sind aus der Reiterleiste geflogen und von hier über das Zahnrad oben
 * rechts erreichbar.
 *
 * Route "index": weiterhin die Startseite der App, jetzt aber das
 * Kinderprofil statt der Füttern/Wickeln/Schlafen-Übersicht — die zog nach
 * `alltag.tsx` um (Reiter 3), funktional unverändert.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { ageInDays, formatDayLabel, formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';
import {
  formatHeadCircumferenceCm,
  formatLengthCm,
  formatWeightKg,
} from '@/features/household/measurements';
import { useActiveChild } from '@/features/household/repository';
import { PersonAvatar } from '@/features/people/components/person-avatar';
import { describeRole } from '@/features/people/logic';
import { usePeopleOfChild } from '@/features/people/repository';
import type { PersonRow } from '@/features/people/types';
import { formatAgeLabel, resolveFullscreenUri } from '@/features/photos/identity';
import { useSignedUrls } from '@/features/photos/hooks';
import { usePhotosOfChild } from '@/features/photos/repository';
import type { PhotoRow } from '@/features/photos/types';

/** How many of the newest photos the strip shows. */
const PHOTO_STRIP_COUNT = 5;

export default function StartScreen() {
  const { child, isLoading: childLoading } = useActiveChild();
  const { photos } = usePhotosOfChild(child?.childId);
  const { people } = usePeopleOfChild(child?.childId);

  // avatar_photo_id if set, otherwise the newest photo (`photos` is already
  // occurred_at DESC — see repository.ts#usePhotosOfChild).
  const avatarPhoto: PhotoRow | undefined = child?.avatarPhotoId
    ? (photos.find((photo) => photo.id === child.avatarPhotoId) ?? photos[0])
    : photos[0];
  const stripPhotos = photos.slice(0, PHOTO_STRIP_COUNT);

  const signedUrls = useSignedUrls([
    avatarPhoto?.original_key,
    ...stripPhotos.map((photo) => photo.thumb_key),
    ...people.map((person) => person.photo_key),
  ]);
  const avatarUri = avatarPhoto ? resolveFullscreenUri(avatarPhoto, signedUrls) : undefined;

  if (childLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const todayAgeDays = child ? ageInDays(nowUtcIso(), child.birthAtUtcIso, child.birthTz) : null;

  // Every line is optional except the date/time — empty fields are omitted
  // entirely, never shown as a dash (per the task spec).
  const birthDataLines: string[] = child
    ? [
        `${formatDayLabel(toLocalDate(child.birthAtUtcIso, child.birthTz))} · ${formatTimeLabel(child.birthAtUtcIso, child.birthTz)}`,
        formatWeightKg(child.birthWeightG),
        formatLengthCm(child.birthLengthMm),
        formatHeadCircumferenceCm(child.birthHeadMm),
        child.birthPlace,
      ].filter((line): line is string => Boolean(line))
    : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Pressable
              onPress={() => router.push('/einstellungen')}
              style={styles.settingsButton}
              hitSlop={12}
              accessibilityLabel="Einstellungen">
              <ThemedText style={styles.gearIcon}>⚙</ThemedText>
            </Pressable>
          </View>

          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" transition={120} />
          ) : (
            <ThemedView type="backgroundElement" style={styles.avatar} />
          )}

          <ThemedText type="subtitle" style={styles.name}>
            {child?.firstName ?? ''}
          </ThemedText>
          {todayAgeDays !== null ? (
            <ThemedText type="title" themeColor="accent" style={styles.age}>
              {formatAgeLabel(todayAgeDays)}
            </ThemedText>
          ) : null}

          {child ? (
            <Pressable onPress={() => router.push('/kind/bearbeiten')}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">Geburtsdaten</ThemedText>
                {birthDataLines.map((line) => (
                  <ThemedText key={line} type="small" themeColor="textSecondary">
                    {line}
                  </ThemedText>
                ))}
                <ThemedText type="linkPrimary" style={styles.editLink}>
                  Bearbeiten
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : null}

          <ThemedText type="smallBold" style={styles.stripTitle}>
            Neueste Fotos
          </ThemedText>
          {stripPhotos.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Fotos.
            </ThemedText>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.strip}>
                {stripPhotos.map((photo) => (
                  <PhotoStripTile
                    key={photo.id}
                    photo={photo}
                    signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
                  />
                ))}
              </View>
            </ScrollView>
          )}

          <ThemedText type="smallBold" style={styles.stripTitle}>
            Menschen
          </ThemedText>
          {people.length === 0 ? (
            <Pressable onPress={() => router.push('/menschen/neu')}>
              <ThemedView type="backgroundElement" style={styles.peopleEmpty}>
                <ThemedText type="small" themeColor="textSecondary">
                  Noch niemand eingetragen. Hebamme, Ärztin oder Familie — wer{' '}
                  {child?.firstName ?? 'das Kind'} begleitet, kann hier festgehalten werden.
                </ThemedText>
                <ThemedText type="linkPrimary" style={styles.editLink}>
                  Person hinzufügen
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.strip}>
                {people.map((person) => (
                  <PersonStripTile
                    key={person.id}
                    person={person}
                    signedUrl={person.photo_key ? signedUrls.get(person.photo_key) : undefined}
                  />
                ))}
                <Pressable onPress={() => router.push('/menschen/neu')} style={styles.addPersonTile}>
                  <ThemedView type="backgroundElement" style={styles.addPersonCircle}>
                    <ThemedText type="title" themeColor="accent" style={styles.addPersonPlus}>
                      +
                    </ThemedText>
                  </ThemedView>
                  <ThemedText type="small" themeColor="textSecondary">
                    Hinzufügen
                  </ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PersonStripTile({ person, signedUrl }: { person: PersonRow; signedUrl: string | undefined }) {
  return (
    <Pressable onPress={() => router.push(`/menschen/${person.id}`)} style={styles.personTile}>
      <PersonAvatar uri={signedUrl} name={person.name} size={STRIP_TILE_SIZE} />
      <ThemedText type="small" numberOfLines={1} style={styles.personName}>
        {person.name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {describeRole(person.role)}
      </ThemedText>
    </Pressable>
  );
}

function PhotoStripTile({ photo, signedUrl }: { photo: PhotoRow; signedUrl: string | undefined }) {
  const uri = photo.local_uri ?? signedUrl;

  return (
    <Pressable onPress={() => router.push(`/foto/${photo.id}`)}>
      <ThemedView type="backgroundElement" style={styles.stripTile}>
        {uri ? (
          <Image source={{ uri }} style={styles.stripTileImage} contentFit="cover" transition={120} />
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const STRIP_TILE_SIZE = 96;

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  content: {
    gap: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.one,
  },
  headerSpacer: { width: 24 },
  // Guarantees a >=44x44pt touch target regardless of the glyph's own
  // rendered box — hitSlop alone would extend touch beyond the view's
  // layout bounds, but this makes the guarantee explicit either way.
  settingsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  gearIcon: { fontSize: 24 },
  avatar: {
    width: '100%',
    height: 280,
    borderRadius: Spacing.four,
    marginTop: Spacing.one,
  },
  name: { textAlign: 'center', marginTop: Spacing.three },
  age: { textAlign: 'center' },
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  editLink: { paddingTop: Spacing.one },
  stripTitle: { marginTop: Spacing.three },
  strip: { flexDirection: 'row', gap: Spacing.two },
  stripTile: {
    width: STRIP_TILE_SIZE,
    height: STRIP_TILE_SIZE,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  stripTileImage: { width: '100%', height: '100%' },
  peopleEmpty: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  personTile: { width: STRIP_TILE_SIZE, alignItems: 'center', gap: Spacing.half },
  personName: { textAlign: 'center' },
  addPersonTile: { width: STRIP_TILE_SIZE, alignItems: 'center', gap: Spacing.half },
  addPersonCircle: {
    width: STRIP_TILE_SIZE,
    height: STRIP_TILE_SIZE,
    borderRadius: STRIP_TILE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPersonPlus: { fontSize: 32, lineHeight: 34 },
});
