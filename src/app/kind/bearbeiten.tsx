/**
 * Kind bearbeiten — Name, Geburtsdatum/-zeit, Geburtsmaße, Geburtsort und
 * Titelbild. Erreichbar über die Geburtsdaten-Karte auf der Startseite
 * (Reiter 1, src/app/(tabs)/index.tsx).
 *
 * Kein natives Datums-Auswahlfeld (wie schon beim Anlegen des Haushalts,
 * siehe (onboarding)/household.tsx) — Text-Eingabe im Format JJJJ-MM-TT /
 * HH:MM, geprüft vor dem Speichern.
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatTimeLabel, toLocalDate } from '@/core/time';
import {
  cmToMm,
  gramsToKgInput,
  kgToGrams,
  mmToCmInput,
  parseDecimalInput,
} from '@/features/household/measurements';
import { updateChild, useActiveChild } from '@/features/household/repository';
import { usePhotosOfChild } from '@/features/photos/repository';
import type { PhotoRow } from '@/features/photos/types';
import { useSignedUrls } from '@/features/photos/hooks';
import { KeyboardSafeScreen, useUiColors, TextField } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Practical cap on how many photos the avatar picker offers — an unbounded
 * grid over a large album would mean an unbounded signed-URL fetch too. The
 * newest photos (the ones most likely to be picked as a current title
 * image) come first, so this rarely matters in practice.
 */
const AVATAR_PICKER_LIMIT = 60;

export default function ChildEditScreen() {
  const db = usePowerSync();
  const { child } = useActiveChild();
  const { photos } = usePhotosOfChild(child?.childId);
  const { accent } = useUiColors();

  const [firstName, setFirstName] = useState(child?.firstName ?? '');
  const [birthDate, setBirthDate] = useState(
    child ? toLocalDate(child.birthAtUtcIso, child.birthTz) : '',
  );
  const [birthTime, setBirthTime] = useState(
    child ? formatTimeLabel(child.birthAtUtcIso, child.birthTz) : '',
  );
  const [weight, setWeight] = useState(
    child?.birthWeightG != null ? gramsToKgInput(child.birthWeightG) : '',
  );
  const [length, setLength] = useState(
    child?.birthLengthMm != null ? mmToCmInput(child.birthLengthMm) : '',
  );
  const [headCircumference, setHeadCircumference] = useState(
    child?.birthHeadMm != null ? mmToCmInput(child.birthHeadMm) : '',
  );
  const [birthPlace, setBirthPlace] = useState(child?.birthPlace ?? '');
  const [avatarPhotoId, setAvatarPhotoId] = useState<string | null>(child?.avatarPhotoId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const avatarChoices = photos.slice(0, AVATAR_PICKER_LIMIT);
  const signedUrls = useSignedUrls(avatarChoices.map((photo) => photo.thumb_key));

  const handleSave = async () => {
    if (!child) {
      return;
    }
    setError(null);

    if (firstName.trim().length === 0) {
      setError('Bitte einen Namen eingeben.');
      return;
    }
    if (!DATE_RE.test(birthDate)) {
      setError('Geburtsdatum bitte im Format JJJJ-MM-TT eingeben.');
      return;
    }
    if (!TIME_RE.test(birthTime)) {
      setError('Geburtszeit bitte im Format HH:MM eingeben.');
      return;
    }

    const weightKg = parseDecimalInput(weight);
    const lengthCm = parseDecimalInput(length);
    const headCm = parseDecimalInput(headCircumference);

    setSaving(true);
    try {
      await updateChild(db, child.childId, {
        firstName: firstName.trim(),
        birthDate,
        birthTime,
        birthWeightG: weightKg !== null ? kgToGrams(weightKg) : null,
        birthLengthMm: lengthCm !== null ? cmToMm(lengthCm) : null,
        birthHeadMm: headCm !== null ? cmToMm(headCm) : null,
        birthPlace: birthPlace.trim() || null,
        avatarPhotoId,
      });
      router.back();
    } catch {
      setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} disabled={saving}>
        <ThemedText type="link" themeColor="textSecondary">
          Abbrechen
        </ThemedText>
      </Pressable>
      <ThemedText type="smallBold">Kind bearbeiten</ThemedText>
      <Pressable onPress={handleSave} hitSlop={12} disabled={saving || !child}>
        <ThemedText type="linkPrimary">{saving ? '…' : 'Speichern'}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen header={header} contentContainerStyle={styles.content}>
        <TextField label="Name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />

          <View style={styles.row}>
            <View style={styles.rowField}>
              <TextField
                label="Geburtsdatum (JJJJ-MM-TT)"
                value={birthDate}
                onChangeText={setBirthDate}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.rowField}>
              <TextField
                label="Uhrzeit (HH:MM)"
                value={birthTime}
                onChangeText={setBirthTime}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.rowField}>
              <TextField
                label="Gewicht (kg)"
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                placeholder="3,4"
              />
            </View>
            <View style={styles.rowField}>
              <TextField
                label="Länge (cm)"
                value={length}
                onChangeText={setLength}
                keyboardType="decimal-pad"
                placeholder="51,0"
              />
            </View>
          </View>

          <TextField
            label="Kopfumfang (cm)"
            value={headCircumference}
            onChangeText={setHeadCircumference}
            keyboardType="decimal-pad"
            placeholder="34,5"
          />

          <TextField
            label="Geburtsort"
            value={birthPlace}
            onChangeText={setBirthPlace}
            autoCapitalize="words"
            placeholder="z. B. Berlin"
          />

          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}

          <ThemedText type="smallBold" style={styles.avatarTitle}>
            Titelbild
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Antippen zum Auswählen, erneut antippen um zurückzusetzen — ohne Auswahl wird das
            neueste Foto verwendet.
          </ThemedText>
          {avatarChoices.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Fotos vorhanden.
            </ThemedText>
          ) : (
            <View style={styles.avatarGrid}>
              {avatarChoices.map((photo) => (
                <AvatarChoiceTile
                  key={photo.id}
                  photo={photo}
                  signedUrl={photo.thumb_key ? signedUrls.get(photo.thumb_key) : undefined}
                  selected={photo.id === avatarPhotoId}
                  accent={accent}
                  onPress={() => setAvatarPhotoId(photo.id === avatarPhotoId ? null : photo.id)}
                />
              ))}
            </View>
          )}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

function AvatarChoiceTile({
  photo,
  signedUrl,
  selected,
  accent,
  onPress,
}: {
  photo: PhotoRow;
  signedUrl: string | undefined;
  selected: boolean;
  accent: string;
  onPress: () => void;
}) {
  const uri = photo.local_uri ?? signedUrl;

  return (
    <Pressable onPress={onPress}>
      <ThemedView
        type="backgroundElement"
        style={[styles.avatarTile, selected && { borderColor: accent, borderWidth: 3 }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.avatarTileImage} contentFit="cover" transition={120} />
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const AVATAR_TILE_SIZE = 88;

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  row: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1 },
  avatarTitle: { marginTop: Spacing.two },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  avatarTile: {
    width: AVATAR_TILE_SIZE,
    height: AVATAR_TILE_SIZE,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  avatarTileImage: { width: '100%', height: '100%' },
});
