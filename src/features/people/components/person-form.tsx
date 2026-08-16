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
 *
 * 2026-08-17 — WARUM `mode` UND NICHT MEHR `initialXyz`-EINZELWERTE:
 * Der alte Vertrag waren flache Eigenschaften mit Standardwerten
 * (`initialName = ''` …). Damit war "wird gerade noch geladen" von "legt
 * gerade frisch an" NICHT unterscheidbar — beide sahen für dieses
 * Formular identisch aus, nämlich als leere Zeichenketten. Genau diese
 * fehlende Unterscheidung ist der Grund, warum hier ursprünglich eine
 * Warteschranke im aufrufenden Bildschirm nötig war statt des
 * projektweiten `useHydrateOnce` (Architekturregel 9). `mode` macht den
 * Unterschied jetzt ausdrücklich und im Typsystem unumgehbar: „anlegen"
 * hat gar kein Feld für einen Datensatz, „bearbeiten" hat eines, das
 * `null` sein DARF, solange geladen wird — und in genau diesem Zustand
 * bleibt „Speichern" gesperrt. Ein Aufrufer kann nicht mehr versehentlich
 * so tun, als wäre nichts zu laden.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { localDateToPickerDate, nowUtcIso, pickerDateToLocalDate, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useSignedUrls } from '@/features/photos/hooks';
import { Chip, KeyboardSafeScreen, TextField, useHydrateOnce, useUiColors } from '@/ui';

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

/** The already-localised values of an existing person, as this form shows them. */
export type PersonFormValues = {
  name: string;
  role: PersonRole;
  note: string;
  /** "YYYY-MM-DD" or "" — the caller converts from the stored instant via core/time. */
  metFrom: string;
  metTo: string;
  /** Already-uploaded portrait, for the preview. */
  photoKey: string | null;
};

/** The record being edited, once it has actually loaded. */
export type PersonFormRecord = {
  /** Identity for `useHydrateOnce` — seeding re-runs if this ever points at a different person. */
  id: string;
  values: PersonFormValues;
};

/**
 * Which of the two jobs this form is doing — see the file header for why
 * this is an explicit union instead of optional initial values.
 */
export type PersonFormMode =
  /** Nothing to load; the form starts empty and is immediately usable. */
  | { kind: 'create' }
  /** `record: null` means "still loading" — the form locks itself until it arrives. */
  | { kind: 'edit'; record: PersonFormRecord | null };

export type PersonFormProps = {
  mode: PersonFormMode;
  headerTitle: string;
  submitLabel: string;
  saving: boolean;
  /** Save failure from the screen (e.g. a write error) — shown alongside this form's own validation errors. */
  error: string | null;
  onSubmit: (input: PersonFormSubmitInput) => void;
  /** Present only in edit mode. */
  onDelete?: () => void;
  deleting?: boolean;
};

export function PersonForm({
  mode,
  headerTitle,
  submitLabel,
  saving,
  error,
  onSubmit,
  onDelete,
  deleting = false,
}: PersonFormProps) {
  const { dangerText } = useUiColors();

  const [name, setName] = useState('');
  const [role, setRole] = useState<PersonRole>('family');
  const [note, setNote] = useState('');
  const [metFrom, setMetFrom] = useState('');
  const [metTo, setMetTo] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [pickedPhotoUri, setPickedPhotoUri] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const hydrate = useCallback((loaded: PersonFormRecord) => {
    setName(loaded.values.name);
    setRole(loaded.values.role);
    setNote(loaded.values.note);
    setMetFrom(loaded.values.metFrom);
    setMetTo(loaded.values.metTo);
    setPhotoKey(loaded.values.photoKey);
  }, []);

  const editRecord = mode.kind === 'edit' ? mode.record : null;
  const hydrated = useHydrateOnce(editRecord, editRecord?.id, hydrate);
  // Anlegen hat nichts zu laden und ist deshalb sofort benutzbar; beim
  // Bearbeiten erst, wenn der Datensatz wirklich da ist (Architekturregel 9).
  const ready = mode.kind === 'create' || hydrated;

  const signedUrls = useSignedUrls([photoKey]);
  const previewUri = pickedPhotoUri ?? (photoKey ? signedUrls.get(photoKey) : undefined);
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
    // Architekturregel 9: niemals speichern, bevor die Daten da sind —
    // sonst schreibt das Formular seine eigene Leere über den Datensatz.
    if (!ready) {
      return;
    }
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
      <Pressable onPress={handleSubmit} hitSlop={12} disabled={busy || !ready}>
        <ThemedText type="linkPrimary">{saving ? '…' : submitLabel}</ThemedText>
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

        <View style={styles.photoRow}>
            <PersonAvatar uri={previewUri} name={name} size={96} />
            <Pressable onPress={handlePickPhoto} hitSlop={8} disabled={busy || !ready}>
              <ThemedText type="linkPrimary" themeColor={ready ? undefined : 'textSecondary'}>
                Foto auswählen
              </ThemedText>
            </Pressable>
          </View>

          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            editable={ready}
            placeholder={ready ? undefined : 'Lädt …'}
          />

          <ThemedText type="small" themeColor="textSecondary">
            Rolle
          </ThemedText>
          <View style={styles.chipRow}>
            {ROLE_OPTIONS.slice(0, 3).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={role === option.value}
                onPress={() => ready && setRole(option.value)}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            {ROLE_OPTIONS.slice(3, 6).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={role === option.value}
                onPress={() => ready && setRole(option.value)}
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
            editable={ready}
            placeholder={ready ? undefined : 'Lädt …'}
          />

          <View style={styles.row}>
            <View style={styles.rowField}>
              <DateChoiceField label="Von" value={metFrom} onChange={setMetFrom} enabled={ready} />
            </View>
            <View style={styles.rowField}>
              <DateChoiceField label="Bis" value={metTo} onChange={setMetTo} enabled={ready} />
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
  enabled,
}: {
  label: string;
  value: string;
  onChange: (localDate: string) => void;
  /** False while the record is still loading — see Architekturregel 9. */
  enabled: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { dangerText } = useUiColors();

  return (
    <View style={styles.dateField}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable onPress={() => setPickerOpen(true)} disabled={!enabled}>
        <ThemedView type="backgroundElement" style={styles.dateValueButton}>
          <ThemedText themeColor={enabled ? undefined : 'textSecondary'}>
            {!enabled ? 'Lädt …' : value ? toGermanDate(value) : 'Datum wählen'}
          </ThemedText>
        </ThemedView>
      </Pressable>
      {enabled && value ? (
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
