/**
 * Shared add/edit form for a person — used by both src/app/menschen/neu.tsx
 * and src/app/menschen/[id]/bearbeiten.tsx, which differ only in what they do
 * with the result (insert vs. update) and whether a delete action exists.
 *
 * Kein natives Datums-Auswahlfeld, wie schon bei den Geburtsdaten (siehe
 * kind/bearbeiten.tsx) — Text-Eingabe im Format JJJJ-MM-TT, geprüft vor dem
 * Speichern.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSignedUrls } from '@/features/photos/hooks';
import { Chip, KeyboardSafeScreen, TextField, useUiColors } from '@/ui';

import { PersonPhotoPickCancelledError, pickPersonPhotoUri } from '../photo';
import { ROLE_OPTIONS } from '../logic';
import type { PersonRole } from '../types';
import { PersonAvatar } from './person-avatar';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PersonFormSubmitInput = {
  name: string;
  role: PersonRole;
  note: string | null;
  /** "YYYY-MM-DD" or "" for unset — the screen converts this via core/time. */
  metFrom: string;
  metTo: string;
  /** Freshly picked, not-yet-uploaded local file — null = keep the existing/no photo. */
  pickedPhotoUri: string | null;
};

export type PersonFormProps = {
  headerTitle: string;
  submitLabel: string;
  saving: boolean;
  /** Save failure from the screen (e.g. a write error) — shown alongside this form's own validation errors. */
  error: string | null;
  initialName?: string;
  initialRole?: PersonRole;
  initialNote?: string;
  initialMetFrom?: string;
  initialMetTo?: string;
  /** Already-uploaded portrait, for edit mode's preview. */
  existingPhotoKey?: string | null;
  onSubmit: (input: PersonFormSubmitInput) => void;
  /** Present only in edit mode. */
  onDelete?: () => void;
  deleting?: boolean;
};

export function PersonForm({
  headerTitle,
  submitLabel,
  saving,
  error,
  initialName = '',
  initialRole = 'family',
  initialNote = '',
  initialMetFrom = '',
  initialMetTo = '',
  existingPhotoKey = null,
  onSubmit,
  onDelete,
  deleting = false,
}: PersonFormProps) {
  const { dangerText } = useUiColors();

  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<PersonRole>(initialRole);
  const [note, setNote] = useState(initialNote);
  const [metFrom, setMetFrom] = useState(initialMetFrom);
  const [metTo, setMetTo] = useState(initialMetTo);
  const [pickedPhotoUri, setPickedPhotoUri] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const signedUrls = useSignedUrls([existingPhotoKey]);
  const previewUri = pickedPhotoUri ?? (existingPhotoKey ? signedUrls.get(existingPhotoKey) : undefined);
  const busy = saving || deleting;

  const handlePickPhoto = async () => {
    try {
      const uri = await pickPersonPhotoUri();
      setPickedPhotoUri(uri);
    } catch (pickError) {
      if (!(pickError instanceof PersonPhotoPickCancelledError)) {
        console.error('[LifeBook] Foto konnte nicht ausgewählt werden', pickError);
      }
    }
  };

  const handleSubmit = () => {
    setValidationError(null);

    if (name.trim().length === 0) {
      setValidationError('Bitte einen Namen eingeben.');
      return;
    }
    if (metFrom.length > 0 && !DATE_RE.test(metFrom)) {
      setValidationError('„Von" bitte im Format JJJJ-MM-TT eingeben, oder leer lassen.');
      return;
    }
    if (metTo.length > 0 && !DATE_RE.test(metTo)) {
      setValidationError('„Bis" bitte im Format JJJJ-MM-TT eingeben, oder leer lassen.');
      return;
    }

    onSubmit({
      name: name.trim(),
      role,
      note: note.trim().length > 0 ? note.trim() : null,
      metFrom,
      metTo,
      pickedPhotoUri,
    });
  };

  const displayError = validationError ?? error;

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy}>
        <ThemedText type="link" themeColor="textSecondary">
          Abbrechen
        </ThemedText>
      </Pressable>
      <ThemedText type="smallBold">{headerTitle}</ThemedText>
      <Pressable onPress={handleSubmit} hitSlop={12} disabled={busy}>
        <ThemedText type="linkPrimary">{saving ? '…' : submitLabel}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen header={header} contentContainerStyle={styles.content}>
        <View style={styles.photoRow}>
            <PersonAvatar uri={previewUri} name={name} size={96} />
            <Pressable onPress={handlePickPhoto} hitSlop={8} disabled={busy}>
              <ThemedText type="linkPrimary">Foto auswählen</ThemedText>
            </Pressable>
          </View>

          <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />

          <ThemedText type="small" themeColor="textSecondary">
            Rolle
          </ThemedText>
          <View style={styles.chipRow}>
            {ROLE_OPTIONS.slice(0, 3).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={role === option.value}
                onPress={() => setRole(option.value)}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            {ROLE_OPTIONS.slice(3, 6).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={role === option.value}
                onPress={() => setRole(option.value)}
              />
            ))}
          </View>

          <TextField
            label="Notiz"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            style={styles.noteInput}
          />

          <View style={styles.row}>
            <View style={styles.rowField}>
              <TextField
                label="Von (JJJJ-MM-TT)"
                value={metFrom}
                onChangeText={setMetFrom}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.rowField}>
              <TextField
                label="Bis (JJJJ-MM-TT)"
                value={metTo}
                onChangeText={setMetTo}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
            </View>
          </View>

          {displayError ? (
            <ThemedText type="small" themeColor="dangerText">
              {displayError}
            </ThemedText>
          ) : null}

          {onDelete ? (
            <Pressable onPress={onDelete} hitSlop={8} disabled={busy} style={styles.deleteRow}>
              {deleting ? (
                <ActivityIndicator color={dangerText} />
              ) : (
                <ThemedText type="link" style={{ color: dangerText }}>
                  Person löschen
                </ThemedText>
              )}
            </Pressable>
          ) : null}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  photoRow: { alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  noteInput: { height: 84, textAlignVertical: 'top', paddingTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1 },
  deleteRow: { alignItems: 'center', paddingTop: Spacing.three },
});
