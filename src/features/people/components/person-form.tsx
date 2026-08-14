/**
 * Shared add/edit form for a person — used by both src/app/menschen/neu.tsx
 * and src/app/menschen/[id]/bearbeiten.tsx, which differ only in what they do
 * with the result (insert vs. update) and whether a delete action exists.
 *
 * 2026-08-15: "Von"/"Bis" now use `@expo/ui`'s community `DateTimePicker`
 * (already a dependency — see its own doc comment on `DateChoiceField`
 * below) instead of hand-typed JJJJ-MM-TT text, unlike the birth date/time
 * fields in kind/bearbeiten.tsx, which stay text entry (a picker chooses a
 * DAY; birth also needs an exact time of day, which this component doesn't
 * carry — out of scope for this change).
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { localDateToPickerDate, nowUtcIso, pickerDateToLocalDate, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useSignedUrls } from '@/features/photos/hooks';
import { Chip, KeyboardSafeScreen, TextField, useUiColors } from '@/ui';

import { PersonPhotoPickCancelledError, pickPersonPhotoUri } from '../photo';
import { ROLE_OPTIONS, isMetToValid, toGermanDate } from '../logic';
import type { PersonRole } from '../types';
import { PersonAvatar } from './person-avatar';

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
    if (!isMetToValid(metFrom || null, metTo || null)) {
      setValidationError('„Bis" darf nicht vor „Von" liegen.');
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
              <DateChoiceField label="Von" value={metFrom} onChange={setMetFrom} />
            </View>
            <View style={styles.rowField}>
              <DateChoiceField label="Bis" value={metTo} onChange={setMetTo} />
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

/**
 * One "Von"/"Bis" field: a row showing the chosen date (or a placeholder),
 * a "Löschen" link when a date is set (both fields stay optional and
 * independently clearable — task requirement), and the native picker
 * dialog itself, mounted only while open.
 *
 * `@expo/ui`'s community `DateTimePicker` is a drop-in, cross-platform
 * wrapper around the platform's own date picker (Material 3 dialog on
 * Android, the native wheel/calendar on iOS) — checked before building
 * anything custom, per the task's explicit instruction, and found
 * suitable: it already ships `mode="date"` plus a `presentation="dialog"`
 * mode that opens on mount and reports back through `onValueChange`/
 * `onDismiss`, exactly the "day/month/year, no free typing" interaction
 * this field needs. `@expo/ui` is already a dependency (used nowhere else
 * yet) — its native module is therefore already linked into any build,
 * so using it here adds no new dependency and cannot change the
 * fingerprint.
 */
function DateChoiceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (localDate: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { dangerText } = useUiColors();

  return (
    <View style={styles.dateField}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable onPress={() => setPickerOpen(true)}>
        <ThemedView type="backgroundElement" style={styles.dateValueButton}>
          <ThemedText>{value ? toGermanDate(value) : 'Datum wählen'}</ThemedText>
        </ThemedView>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <ThemedText type="small" style={{ color: dangerText }}>
            Löschen
          </ThemedText>
        </Pressable>
      ) : null}
      {pickerOpen ? (
        <DateTimePicker
          mode="date"
          presentation="dialog"
          // Startet auf dem bereits gewählten Tag, sonst auf "heute" — reine
          // UI-Vorbelegung für den Dialog, keine gespeicherte Bedeutung
          // (siehe core/time#localDateToPickerDate's Dokumentation dazu).
          value={localDateToPickerDate(value || toLocalDate(nowUtcIso(), deviceTimeZone()))}
          onValueChange={(_event, date) => {
            setPickerOpen(false);
            onChange(pickerDateToLocalDate(date));
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
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
  dateField: { gap: Spacing.one },
  dateValueButton: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  deleteRow: { alignItems: 'center', paddingTop: Spacing.three },
});
