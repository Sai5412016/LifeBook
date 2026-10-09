/**
 * Gaben-Formular (Anlegen und Bearbeiten) — eigene Datei, damit es sowohl im
 * Bereich "Medikamente" unter "Mehr …" als auch auf dem eigenen Bildschirm
 * `/alltag/gabe` (Tagesverlauf, "Heute fällig") dieselbe Bauform hat. Task
 * 2026-10-09: eine falsch eingetragene Gabe muss von überall korrigierbar sein.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
import { formatShortGermanDate } from '@/features/events/logic';
import { Chip, TextField, useHydrateOnce, useUiColors } from '@/ui';

import { describeDoseUnit, describeMedicationRoute } from '../logic';
import type { MedicationFavorite } from '../logic';
import type { MedicationDoseUnit, MedicationRoute, MedicationRow } from '../types';

const DOSE_UNIT_OPTIONS: readonly MedicationDoseUnit[] = ['ie', 'drops', 'ml', 'mg', 'spoon', 'piece'];
const ROUTE_OPTIONS: readonly MedicationRoute[] = ['oral', 'bottle', 'other'];

/** Ignores a decimal comma, same forgiving parse as everywhere a German user types a number. */
function parseDoseAmount(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

export type MedicationFormSubmitInput = {
  name: string;
  doseAmount: number | null;
  doseUnit: MedicationDoseUnit | null;
  route: MedicationRoute | null;
  localDate: string;
  time: string;
  note: string | null;
};

/**
 * Architekturregel 9: "anlegen" hat Startwerte, aber gar kein Feld für einen
 * Datensatz; "bearbeiten" hat eines, das `null` sein darf, solange noch
 * geladen wird (Speichern bleibt dann gesperrt). Keine Standardwerte, die
 * "lädt noch" von "legt neu an" ununterscheidbar machen.
 */
export type MedicationFormMode =
  | { kind: 'create'; defaultLocalDate: string; defaultTime: string }
  | { kind: 'edit'; medication: MedicationRow | null };

/** Shared add/edit form, same shape as diaper-section.tsx's DiaperEditPanel plus a date/time picker (EventForm's pattern). */
export function MedicationFormPanel({
  mode,
  favorites,
  tz,
  busy,
  onSubmit,
  onCancel,
  onDelete,
}: {
  mode: MedicationFormMode;
  favorites: readonly MedicationFavorite[];
  tz: string;
  busy: boolean;
  onSubmit: (input: MedicationFormSubmitInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { dangerText } = useUiColors();

  const [name, setName] = useState('');
  const [doseAmountText, setDoseAmountText] = useState('');
  const [doseUnit, setDoseUnit] = useState<MedicationDoseUnit | null>(null);
  const [route, setRoute] = useState<MedicationRoute | null>(null);
  // Anlegen startet auf dem gewählten Tag (Vorgabe "jetzt" nur, solange der
  // heute gewählt ist) — Nachtragen bleibt zusätzlich möglich, es ändert nur
  // diesen Startwert (task requirement). Bearbeiten überschreibt das gleich
  // wieder über useHydrateOnce, sobald der echte Datensatz da ist.
  const [localDate, setLocalDate] = useState(() => (mode.kind === 'create' ? mode.defaultLocalDate : ''));
  const [time, setTime] = useState(() => (mode.kind === 'create' ? mode.defaultTime : ''));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const hydrate = useCallback((loaded: MedicationRow) => {
    setName(loaded.name);
    setDoseAmountText(loaded.dose_amount !== null ? String(loaded.dose_amount) : '');
    setDoseUnit(loaded.dose_unit);
    setRoute(loaded.route);
    setLocalDate(loaded.local_date);
    setTime(formatTimeLabel(loaded.occurred_at, loaded.tz));
    setNote(loaded.note ?? '');
    setError(null);
  }, []);
  const editRecord = mode.kind === 'edit' ? mode.medication : null;
  // Architekturregel 9, gleicher Grund wie DiaperEditPanel: der Datensatz
  // kann wechseln, während dieselbe Panel-Instanz stehen bleibt.
  const hydrated = useHydrateOnce(editRecord, editRecord?.id, hydrate);
  // Regel 9: im Bearbeiten-Fall bleibt Speichern gesperrt, bis die Felder
  // wirklich aus dem Datensatz befüllt sind — sonst überschriebe ein leeres
  // Formular die vorhandene Gabe.
  const saveLocked = mode.kind === 'edit' && !hydrated;

  const applyFavorite = (favorite: MedicationFavorite) => {
    setName(favorite.name);
    setDoseAmountText(favorite.doseAmount !== null ? String(favorite.doseAmount) : '');
    setDoseUnit(favorite.doseUnit);
  };

  const handleSubmit = () => {
    if (saveLocked) {
      return;
    }
    if (name.trim().length === 0) {
      setError('Bitte einen Namen eingeben.');
      return;
    }
    const doseAmount = parseDoseAmount(doseAmountText);
    if (doseAmount === 'invalid') {
      setError('Bitte eine gültige Zahl für die Dosis eingeben.');
      return;
    }
    if (!localDate || !time) {
      setError('Bitte Datum und Uhrzeit wählen.');
      return;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      doseAmount,
      doseUnit,
      route,
      localDate,
      time,
      note: note.trim().length > 0 ? note.trim() : null,
    });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <ThemedText type="smallBold">{mode.kind === 'create' ? 'Neue Gabe' : 'Gabe bearbeiten'}</ThemedText>

      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />

      {favorites.length > 0 ? (
        <View style={styles.chipRow}>
          {favorites.map((favorite) => (
            <Chip
              key={`${favorite.name.toLowerCase()}|${favorite.doseAmount ?? ''}|${favorite.doseUnit ?? ''}`}
              label={favorite.name}
              selected={false}
              onPress={() => applyFavorite(favorite)}
            />
          ))}
        </View>
      ) : null}

      <TextField
        label="Dosis"
        value={doseAmountText}
        onChangeText={setDoseAmountText}
        keyboardType="decimal-pad"
      />

      <ThemedText type="small" themeColor="textSecondary">
        Einheit
      </ThemedText>
      <View style={styles.chipRow}>
        {DOSE_UNIT_OPTIONS.slice(0, 3).map((option) => (
          <Chip
            key={option}
            label={describeDoseUnit(option)}
            selected={doseUnit === option}
            onPress={() => setDoseUnit(doseUnit === option ? null : option)}
          />
        ))}
      </View>
      <View style={styles.chipRow}>
        {DOSE_UNIT_OPTIONS.slice(3, 6).map((option) => (
          <Chip
            key={option}
            label={describeDoseUnit(option)}
            selected={doseUnit === option}
            onPress={() => setDoseUnit(doseUnit === option ? null : option)}
          />
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Gabeart
      </ThemedText>
      <View style={styles.chipRow}>
        {ROUTE_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={describeMedicationRoute(option)}
            selected={route === option}
            onPress={() => setRoute(route === option ? null : option)}
          />
        ))}
      </View>

      <View style={styles.pickerRow}>
        <View style={styles.rowField}>
          <ThemedText type="small" themeColor="textSecondary">
            Datum
          </ThemedText>
          <Pressable onPress={() => setDatePickerOpen(true)} disabled={busy}>
            <ThemedView type="backgroundElement" style={styles.dateValueButton}>
              <ThemedText>{localDate ? formatShortGermanDate(localDate) : 'Datum wählen'}</ThemedText>
            </ThemedView>
          </Pressable>
          {datePickerOpen ? (
            <DateTimePicker
              mode="date"
              presentation="dialog"
              value={localDateToPickerDate(localDate || toLocalDate(nowUtcIso(), tz))}
              onValueChange={(_event, date) => {
                setDatePickerOpen(false);
                setLocalDate(pickerDateToLocalDate(date));
              }}
              onDismiss={() => setDatePickerOpen(false)}
            />
          ) : null}
        </View>

        <View style={styles.rowField}>
          <ThemedText type="small" themeColor="textSecondary">
            Uhrzeit
          </ThemedText>
          <Pressable onPress={() => setTimePickerOpen(true)} disabled={busy}>
            <ThemedView type="backgroundElement" style={styles.dateValueButton}>
              <ThemedText>{time || 'Uhrzeit wählen'}</ThemedText>
            </ThemedView>
          </Pressable>
          {timePickerOpen ? (
            <DateTimePicker
              mode="time"
              presentation="dialog"
              is24Hour
              value={localTimeToPickerDate(time || formatTimeLabel(nowUtcIso(), tz))}
              onValueChange={(_event, date) => {
                setTimePickerOpen(false);
                setTime(pickerDateToLocalTime(date));
              }}
              onDismiss={() => setTimePickerOpen(false)}
            />
          ) : null}
        </View>
      </View>

      <TextField label="Notiz (optional)" value={note} onChangeText={setNote} multiline numberOfLines={3} />

      {error ? (
        <ThemedText type="small" style={{ color: dangerText }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.panelActions}>
        <Pressable onPress={onCancel} hitSlop={8} disabled={busy}>
          <ThemedText type="link" themeColor="textSecondary">
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} hitSlop={8} disabled={busy || saveLocked}>
          <ThemedText type="linkPrimary" style={saveLocked ? { opacity: 0.4 } : undefined}>
            Speichern
          </ThemedText>
        </Pressable>
      </View>

      {onDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={busy || saveLocked}
          accessibilityRole="button"
          style={[styles.deleteButton, { borderColor: dangerText }, (busy || saveLocked) && { opacity: 0.4 }]}>
          <ThemedText style={{ color: dangerText, fontWeight: '700' }}>Gabe löschen</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  panelActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  deleteButton: {
    minHeight: 52,
    marginTop: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  pickerRow: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1, gap: Spacing.one },
  dateValueButton: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
