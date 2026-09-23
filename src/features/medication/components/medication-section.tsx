/**
 * Medikamente & Vitamine section of the "Heute" screen.
 *
 * No timer, no multi-device conflict — a dose is logged once, corrected or
 * soft-deleted afterwards, same interaction shape as Wickeln (see
 * features/diaper/components/diaper-section.tsx). One quick button per
 * favorite (derived from history, ./logic.ts#favoritenAusVerlauf — no
 * separate favorites table), a doppelgabe (double-dose) confirmation before
 * a repeat, a full form for anything else or for backdating ("Nachtragen"),
 * and today's list underneath. Reuses the shared BigButton-adjacent look —
 * a bespoke quick button, not BigButton itself, since BigButton only
 * supports a single line of text and this one needs up to three.
 */

import DateTimePicker from '@expo/ui/community/datetime-picker';
import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

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
import type { ActiveChild } from '@/features/household/repository';
import { useHouseholdMemberNames } from '@/features/household/repository';
import { Chip, TextField, useHydrateOnce, useUiColors } from '@/ui';

import {
  describeDoseUnit,
  describeMedicationRoute,
  favoritenAusVerlauf,
  firstNameOf,
  formatDoseLabel,
  formatDuplicateDoseWarning,
  formatGivenTodayLabel,
  letzteGabeHeute,
} from '../logic';
import type { MedicationFavorite } from '../logic';
import { gabeAendern, gabeEintragen, gabeLoeschen, useGabenDesTages, useGabenHistorie } from '../repository';
import type { GabeAendernInput } from '../repository';
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

export type MedicationSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
};

export function MedicationSection({ child, session, tz }: MedicationSectionProps) {
  const db = usePowerSync();
  const { accent } = useUiColors();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);
  const { gaben: todayGaben } = useGabenDesTages(child?.childId, todayLocalDate);
  const historie = useGabenHistorie(child?.childId);
  const memberNames = useHouseholdMemberNames(child?.householdId);
  const favorites = favoritenAusVerlauf(historie, nowUtcIso());

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMessage = useCallback((text: string) => {
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
    }
    setMessage(text);
    messageTimeoutRef.current = setTimeout(() => setMessage(null), 2500);
  }, []);

  const logNow = useCallback(
    async (favorite: MedicationFavorite) => {
      if (!child || !session?.user.id) {
        return;
      }
      const now = nowUtcIso();
      setBusy(true);
      try {
        await gabeEintragen(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          name: favorite.name,
          doseAmount: favorite.doseAmount,
          doseUnit: favorite.doseUnit,
          // Quick-tap re-logs never carry a route over: favoritenAusVerlauf
          // deliberately does not group by route (task requirement), so
          // entries in the same favorite can disagree on it.
          route: null,
          localDate: toLocalDate(now, tz),
          time: formatTimeLabel(now, tz),
          note: null,
        });
        showMessage(`${favorite.name} eingetragen.`);
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz, showMessage],
  );

  const handleQuickTap = useCallback(
    (favorite: MedicationFavorite) => {
      const given = letzteGabeHeute(todayGaben, favorite, todayLocalDate);
      if (!given) {
        void logNow(favorite);
        return;
      }

      // Doppelgabe-Schutz — darf nicht wegoptimiert werden (task requirement).
      Alert.alert('Schon gegeben', formatDuplicateDoseWarning(given.occurred_at, tz), [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Trotzdem eintragen', onPress: () => void logNow(favorite) },
      ]);
    },
    [todayGaben, todayLocalDate, tz, logNow],
  );

  const handleCreateSubmit = useCallback(
    async (input: MedicationFormSubmitInput) => {
      if (!child || !session?.user.id) {
        return;
      }
      setBusy(true);
      try {
        const id = await gabeEintragen(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          ...input,
        });
        if (id) {
          setCreating(false);
          showMessage(`${input.name} eingetragen.`);
        }
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz, showMessage],
  );

  const handleEditSubmit = useCallback(
    async (medicationId: string, input: GabeAendernInput) => {
      setBusy(true);
      try {
        await gabeAendern(db, medicationId, input);
        setEditId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleRequestDelete = useCallback(
    (medication: MedicationRow) => {
      const time = formatTimeLabel(medication.occurred_at, medication.tz);
      Alert.alert('Eintrag löschen?', `${medication.name}, ${time} wirklich löschen?`, [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await gabeLoeschen(db, medication.id);
            setEditId(null);
          },
        },
      ]);
    },
    [db],
  );

  const editTarget = editId ? todayGaben.find((gabe) => gabe.id === editId) : undefined;

  return (
    <View style={styles.section}>
      {favorites.length > 0 ? (
        <View style={styles.quickGrid}>
          {favorites.map((favorite) => {
            const given = letzteGabeHeute(todayGaben, favorite, todayLocalDate);
            const givenByName = given ? (memberNames.get(given.created_by) ?? '') : '';
            return (
              <MedicationQuickButton
                key={`${favorite.name.toLowerCase()}|${favorite.doseAmount ?? ''}|${favorite.doseUnit ?? ''}`}
                favorite={favorite}
                givenTodayLabel={given ? formatGivenTodayLabel(given.occurred_at, tz, firstNameOf(givenByName)) : null}
                accent={accent}
                disabled={busy || !child}
                onPress={() => handleQuickTap(favorite)}
              />
            );
          })}
        </View>
      ) : null}

      <Pressable onPress={() => setCreating(true)} disabled={busy || !child}>
        <ThemedView type="backgroundElement" style={styles.addRow}>
          <ThemedText type="linkPrimary">+ Neue Gabe</ThemedText>
        </ThemedView>
      </Pressable>

      {message ? (
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}

      {creating ? (
        <MedicationFormPanel
          mode={{ kind: 'create' }}
          favorites={favorites}
          tz={tz}
          busy={busy}
          onSubmit={handleCreateSubmit}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editTarget ? (
        <MedicationFormPanel
          mode={{ kind: 'edit', medication: editTarget }}
          favorites={favorites}
          tz={tz}
          busy={busy}
          onSubmit={(input) => handleEditSubmit(editTarget.id, input)}
          onCancel={() => setEditId(null)}
          onDelete={() => handleRequestDelete(editTarget)}
        />
      ) : null}

      {todayGaben.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Noch keine Gabe heute.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {[...todayGaben].reverse().map((gabe) => (
            <MedicationRowItem
              key={gabe.id}
              gabe={gabe}
              firstName={firstNameOf(memberNames.get(gabe.created_by) ?? '')}
              onPress={() => setEditId(gabe.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function MedicationQuickButton({
  favorite,
  givenTodayLabel,
  accent,
  disabled,
  onPress,
}: {
  favorite: MedicationFavorite;
  givenTodayLabel: string | null;
  accent: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const doseLabel = formatDoseLabel(favorite.doseAmount, favorite.doseUnit);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.quickButton,
        { backgroundColor: accent },
        disabled && styles.quickButtonDisabled,
        pressed && !disabled && styles.quickButtonPressed,
      ]}>
      <ThemedText style={styles.quickButtonName} numberOfLines={1}>
        {favorite.name}
      </ThemedText>
      {doseLabel ? (
        <ThemedText style={styles.quickButtonDose} numberOfLines={1}>
          {doseLabel}
        </ThemedText>
      ) : null}
      {givenTodayLabel ? (
        <ThemedText style={styles.quickButtonGiven} numberOfLines={1}>
          {givenTodayLabel}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function MedicationRowItem({
  gabe,
  firstName,
  onPress,
}: {
  gabe: MedicationRow;
  firstName: string;
  onPress: () => void;
}) {
  const time = formatTimeLabel(gabe.occurred_at, gabe.tz);
  const doseLabel = formatDoseLabel(gabe.dose_amount, gabe.dose_unit);

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold" style={styles.rowTime}>
          {time}
        </ThemedText>
        <ThemedText type="small" style={styles.rowName} numberOfLines={1}>
          {gabe.name}
        </ThemedText>
        {doseLabel ? (
          <ThemedText type="small" themeColor="textSecondary">
            {doseLabel}
          </ThemedText>
        ) : null}
        {firstName ? (
          <ThemedText type="small" themeColor="textSecondary">
            {firstName}
          </ThemedText>
        ) : null}
      </ThemedView>
    </Pressable>
  );
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

export type MedicationFormMode = { kind: 'create' } | { kind: 'edit'; medication: MedicationRow };

/** Shared add/edit form, same shape as diaper-section.tsx's DiaperEditPanel plus a date/time picker (EventForm's pattern). */
function MedicationFormPanel({
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
  // Anlegen startet auf "jetzt" — Nachtragen bleibt möglich, es ändert nur
  // diesen Startwert (task requirement). Bearbeiten überschreibt das gleich
  // wieder über useHydrateOnce, sobald der echte Datensatz da ist.
  const [localDate, setLocalDate] = useState(() =>
    mode.kind === 'create' ? toLocalDate(nowUtcIso(), tz) : '',
  );
  const [time, setTime] = useState(() => (mode.kind === 'create' ? formatTimeLabel(nowUtcIso(), tz) : ''));
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
  useHydrateOnce(editRecord, editRecord?.id, hydrate);

  const applyFavorite = (favorite: MedicationFavorite) => {
    setName(favorite.name);
    setDoseAmountText(favorite.doseAmount !== null ? String(favorite.doseAmount) : '');
    setDoseUnit(favorite.doseUnit);
  };

  const handleSubmit = () => {
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
        {onDelete ? (
          <Pressable onPress={onDelete} hitSlop={8} disabled={busy}>
            <ThemedText type="link" style={{ color: dangerText }}>
              Löschen
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={handleSubmit} hitSlop={8} disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  quickButton: {
    minHeight: 88,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  quickButtonDisabled: { opacity: 0.4 },
  quickButtonPressed: { opacity: 0.85 },
  quickButtonName: { fontSize: 18, fontWeight: '700', color: '#ffffff', textAlign: 'center' },
  quickButtonDose: { fontSize: 14, fontWeight: '600', color: '#ffffff', textAlign: 'center' },
  quickButtonGiven: { fontSize: 12, color: '#ffffff', opacity: 0.85, textAlign: 'center' },
  addRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  panelActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  pickerRow: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1, gap: Spacing.one },
  dateValueButton: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowTime: { width: 48 },
  rowName: { flex: 1 },
});
