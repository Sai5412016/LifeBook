/**
 * Shared add/edit form for an event — used by both src/app/ereignisse/neu.tsx
 * and src/app/ereignisse/[id]/bearbeiten.tsx, mirroring
 * features/people/components/person-form.tsx's shape exactly: a `mode`
 * union instead of optional initial values (Architekturregel 9 — see that
 * file's own doc comment for why), `useHydrateOnce` to seed edit mode, and
 * "Speichern" locked until the record has actually loaded.
 *
 * Date/time use the SAME `@expo/ui` community `DateTimePicker` as
 * features/people (task requirement) — but unlike Von/Bis there, an event's
 * moment needs a TIME too, not just a day. Android's community picker has
 * no inline `datetime` mode (falls back to date-only — see that package's
 * own `DateTimePicker.android.tsx`), so this form uses two separate
 * pickers, `mode="date"` and `mode="time"`, exactly like the two fields
 * below each open their own dialog.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  formatTimeLabel,
  localDateToPickerDate,
  localTimeToPickerDate,
  nowUtcIso,
  pickerDateToLocalDate,
  pickerDateToLocalTime,
  toLocalDate,
} from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { toggleSelected } from '@/features/photos/selection';
import { KeyboardSafeScreen, TextField, useHydrateOnce, useUiColors } from '@/ui';

import { formatShortGermanDate } from '../logic';
import { EventPhotoPicker } from './event-photo-picker';

export type EventFormSubmitInput = {
  title: string;
  note: string | null;
  localDate: string;
  time: string;
  photoIds: string[];
};

/** The already-localised values of an existing event, as this form shows them. */
export type EventFormValues = {
  title: string;
  note: string;
  localDate: string;
  time: string;
  photoIds: string[];
};

/** The record being edited, once it has actually loaded. */
export type EventFormRecord = {
  /** Identity for `useHydrateOnce` — seeding re-runs if this ever points at a different event. */
  id: string;
  values: EventFormValues;
};

/** Which of the two jobs this form is doing — see the file header. */
export type EventFormMode =
  /** Nothing to load; the form starts empty (pre-filled with "now") and is immediately usable. */
  | { kind: 'create' }
  /** `record: null` means "still loading" — the form locks itself until it arrives. */
  | { kind: 'edit'; record: EventFormRecord | null };

export type EventFormProps = {
  mode: EventFormMode;
  childId: string | undefined;
  headerTitle: string;
  submitLabel: string;
  saving: boolean;
  /** Save failure from the screen (e.g. a write error) — shown alongside this form's own validation errors. */
  error: string | null;
  onSubmit: (input: EventFormSubmitInput) => void;
  /** Present only in edit mode. */
  onDelete?: () => void;
  deleting?: boolean;
};

export function EventForm({
  mode,
  childId,
  headerTitle,
  submitLabel,
  saving,
  error,
  onSubmit,
  onDelete,
  deleting = false,
}: EventFormProps) {
  const { dangerText } = useUiColors();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  // Anlegen startet auf "jetzt" (die meisten Ereignisse werden kurz danach
  // erfasst) statt leer — sonst wäre "Speichern" ohne einen zusätzlichen,
  // unnötigen Antipp-Schritt gesperrt. Bearbeiten überschreibt das gleich
  // wieder über useHydrateOnce, sobald der echte Datensatz da ist.
  const [localDate, setLocalDate] = useState(() =>
    mode.kind === 'create' ? toLocalDate(nowUtcIso(), deviceTimeZone()) : '',
  );
  const [time, setTime] = useState(() =>
    mode.kind === 'create' ? formatTimeLabel(nowUtcIso(), deviceTimeZone()) : '',
  );
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const hydrate = useCallback((loaded: EventFormRecord) => {
    setTitle(loaded.values.title);
    setNote(loaded.values.note);
    setLocalDate(loaded.values.localDate);
    setTime(loaded.values.time);
    setPhotoIds(loaded.values.photoIds);
  }, []);

  const editRecord = mode.kind === 'edit' ? mode.record : null;
  const hydrated = useHydrateOnce(editRecord, editRecord?.id, hydrate);
  // Anlegen hat nichts zu laden und ist deshalb sofort benutzbar; beim
  // Bearbeiten erst, wenn der Datensatz wirklich da ist (Architekturregel 9).
  const ready = mode.kind === 'create' || hydrated;

  const busy = saving || deleting;

  const handleSubmit = () => {
    // Architekturregel 9: niemals speichern, bevor die Daten da sind —
    // sonst schreibt das Formular seine eigene Leere über den Datensatz.
    if (!ready) {
      return;
    }
    setValidationError(null);

    if (title.trim().length === 0) {
      setValidationError('Bitte einen Titel eingeben.');
      return;
    }
    if (!localDate || !time) {
      setValidationError('Bitte Datum und Uhrzeit wählen.');
      return;
    }

    onSubmit({
      title: title.trim(),
      note: note.trim().length > 0 ? note.trim() : null,
      localDate,
      time,
      photoIds,
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

        <TextField
          label="Titel"
          value={title}
          onChangeText={setTitle}
          editable={ready}
          placeholder={ready ? undefined : 'Lädt …'}
        />

        <TextField
          label="Text"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={4}
          style={styles.noteInput}
          editable={ready}
          placeholder={ready ? undefined : 'Lädt …'}
        />

        <EventDateTimeField
          localDate={localDate}
          time={time}
          onChangeDate={setLocalDate}
          onChangeTime={setTime}
          enabled={ready}
        />

        <ThemedText type="smallBold">Fotos</ThemedText>
        {ready ? (
          <EventPhotoPicker
            childId={childId}
            selectedIds={photoIds}
            onToggle={(photoId) => setPhotoIds((current) => toggleSelected(current, photoId))}
          />
        ) : null}

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
                Ereignis löschen
              </ThemedText>
            )}
          </Pressable>
        ) : null}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

/**
 * Two fields, "Datum" and "Uhrzeit", each opening its own native dialog —
 * see the file header for why this is two pickers, not one `mode="datetime"`.
 * Otherwise the same shape as person-form.tsx's `DateChoiceField`.
 */
function EventDateTimeField({
  localDate,
  time,
  onChangeDate,
  onChangeTime,
  enabled,
}: {
  localDate: string;
  time: string;
  onChangeDate: (localDate: string) => void;
  onChangeTime: (time: string) => void;
  /** False while the record is still loading — see Architekturregel 9. */
  enabled: boolean;
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  return (
    <View style={styles.row}>
      <View style={styles.rowField}>
        <ThemedText type="small" themeColor="textSecondary">
          Datum
        </ThemedText>
        <Pressable onPress={() => setDatePickerOpen(true)} disabled={!enabled}>
          <ThemedView type="backgroundElement" style={styles.dateValueButton}>
            <ThemedText themeColor={enabled ? undefined : 'textSecondary'}>
              {!enabled ? 'Lädt …' : localDate ? formatShortGermanDate(localDate) : 'Datum wählen'}
            </ThemedText>
          </ThemedView>
        </Pressable>
        {datePickerOpen ? (
          <DateTimePicker
            mode="date"
            presentation="dialog"
            value={localDateToPickerDate(localDate || toLocalDate(nowUtcIso(), deviceTimeZone()))}
            onValueChange={(_event, date) => {
              setDatePickerOpen(false);
              onChangeDate(pickerDateToLocalDate(date));
            }}
            onDismiss={() => setDatePickerOpen(false)}
          />
        ) : null}
      </View>

      <View style={styles.rowField}>
        <ThemedText type="small" themeColor="textSecondary">
          Uhrzeit
        </ThemedText>
        <Pressable onPress={() => setTimePickerOpen(true)} disabled={!enabled}>
          <ThemedView type="backgroundElement" style={styles.dateValueButton}>
            <ThemedText themeColor={enabled ? undefined : 'textSecondary'}>
              {!enabled ? 'Lädt …' : time || 'Uhrzeit wählen'}
            </ThemedText>
          </ThemedView>
        </Pressable>
        {timePickerOpen ? (
          <DateTimePicker
            mode="time"
            presentation="dialog"
            is24Hour
            value={localTimeToPickerDate(time || formatTimeLabel(nowUtcIso(), deviceTimeZone()))}
            onValueChange={(_event, date) => {
              setTimePickerOpen(false);
              onChangeTime(pickerDateToLocalTime(date));
            }}
            onDismiss={() => setTimePickerOpen(false)}
          />
        ) : null}
      </View>
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
  noteInput: { height: 100, textAlignVertical: 'top', paddingTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1, gap: Spacing.one },
  dateValueButton: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  deleteRow: { alignItems: 'center', paddingTop: Spacing.three },
});
