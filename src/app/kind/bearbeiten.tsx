/**
 * Kind bearbeiten — Name, Geburtsdatum/-zeit, Geburtsmaße, Geburtsort und
 * Titelbild. Erreichbar über die Geburtsdaten-Karte auf der Startseite
 * (Reiter 1, src/app/(tabs)/index.tsx).
 *
 * Kein natives Datums-Auswahlfeld (wie schon beim Anlegen des Haushalts,
 * siehe (onboarding)/household.tsx) — Text-Eingabe im Format JJJJ-MM-TT /
 * HH:MM, geprüft vor dem Speichern.
 *
 * 2026-08-17: gefunden — dieser Bildschirm öffnete sich mit leeren
 * Feldern, obwohl die Datenbank vollständige Werte hatte. Ursache: die
 * `useState`-Aufrufe unten lasen `child` als Startwert, aber
 * `useActiveChild()` liefert `child` erst NACH einem ersten Render mit
 * `null` (die reaktive Abfrage ist noch nicht fertig) — React führt einen
 * `useState`-Initialwert aber nur EIN EINZIGES Mal aus, beim allerersten
 * Aufbau. Das Feld blieb deshalb für immer leer, obwohl `child` kurz
 * danach ankam — und "Speichern" hätte genau diese Leere über die
 * echten Werte geschrieben, da der Name-Pflichtcheck der einzige Schutz
 * war. Behoben mit `useHydrateOnce` (siehe @/ui): die Felder werden erst
 * befüllt, sobald `child` TATSÄCHLICH da ist, dafür aber garantiert genau
 * einmal — und bis dahin ist "Speichern" gesperrt, das Formular zeigt
 * einen Ladezustand statt editierbarer, aber falscher Leerfelder.
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

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
import { updateChild, useActiveChild, type ActiveChild } from '@/features/household/repository';
import { usePhotosOfChild } from '@/features/photos/repository';
import type { PhotoRow } from '@/features/photos/types';
import { useSignedUrls } from '@/features/photos/hooks';
import { KeyboardSafeScreen, useHydrateOnce, useUiColors, TextField } from '@/ui';

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

  const [firstName, setFirstName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [headCircumference, setHeadCircumference] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [avatarPhotoId, setAvatarPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Befüllt die Felder GENAU EINMAL, sobald `child` tatsächlich da ist —
  // siehe den Dateikopf-Kommentar für den Fehler, den das behebt.
  const hydrate = useCallback((loaded: ActiveChild) => {
    setFirstName(loaded.firstName);
    setBirthDate(toLocalDate(loaded.birthAtUtcIso, loaded.birthTz));
    setBirthTime(formatTimeLabel(loaded.birthAtUtcIso, loaded.birthTz));
    setWeight(loaded.birthWeightG != null ? gramsToKgInput(loaded.birthWeightG) : '');
    setLength(loaded.birthLengthMm != null ? mmToCmInput(loaded.birthLengthMm) : '');
    setHeadCircumference(loaded.birthHeadMm != null ? mmToCmInput(loaded.birthHeadMm) : '');
    setBirthPlace(loaded.birthPlace ?? '');
    setAvatarPhotoId(loaded.avatarPhotoId ?? null);
  }, []);
  const ready = useHydrateOnce(child, child?.childId, hydrate);

  const avatarChoices = photos.slice(0, AVATAR_PICKER_LIMIT);
  const signedUrls = useSignedUrls(avatarChoices.map((photo) => photo.thumb_key));

  const handleSave = async () => {
    if (!child || !ready) {
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
      <Pressable onPress={handleSave} hitSlop={12} disabled={saving || !child || !ready}>
        <ThemedText type="linkPrimary">{saving ? '…' : 'Speichern'}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen header={header} contentContainerStyle={styles.content}>
        {!ready ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">
              Daten werden geladen …
            </ThemedText>
          </View>
        ) : null}

        <TextField
          label="Name"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          editable={ready}
          placeholder={ready ? undefined : 'Lädt …'}
        />

          <View style={styles.row}>
            <View style={styles.rowField}>
              <TextField
                label="Geburtsdatum (JJJJ-MM-TT)"
                value={birthDate}
                onChangeText={setBirthDate}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                editable={ready}
                placeholder={ready ? undefined : 'Lädt …'}
              />
            </View>
            <View style={styles.rowField}>
              <TextField
                label="Uhrzeit (HH:MM)"
                value={birthTime}
                onChangeText={setBirthTime}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                editable={ready}
                placeholder={ready ? undefined : 'Lädt …'}
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
                placeholder={ready ? '3,4' : 'Lädt …'}
                editable={ready}
              />
            </View>
            <View style={styles.rowField}>
              <TextField
                label="Länge (cm)"
                value={length}
                onChangeText={setLength}
                keyboardType="decimal-pad"
                placeholder={ready ? '51,0' : 'Lädt …'}
                editable={ready}
              />
            </View>
          </View>

          <TextField
            label="Kopfumfang (cm)"
            value={headCircumference}
            onChangeText={setHeadCircumference}
            keyboardType="decimal-pad"
            placeholder={ready ? '34,5' : 'Lädt …'}
            editable={ready}
          />

          <TextField
            label="Geburtsort"
            value={birthPlace}
            onChangeText={setBirthPlace}
            autoCapitalize="words"
            placeholder={ready ? 'z. B. Berlin' : 'Lädt …'}
            editable={ready}
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
                  onPress={() => ready && setAvatarPhotoId(photo.id === avatarPhotoId ? null : photo.id)}
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
