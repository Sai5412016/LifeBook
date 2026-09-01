/**
 * pumping/components/pumping-entry-sheet — the entry sheet, built to be
 * usable one-handed in under ten seconds, in the dark, holding a bottle.
 *
 * WHY ITS OWN KEYPAD INSTEAD OF A TextInput
 * -------------------------------------------
 * The system keyboard costs an animation, takes over half the screen,
 * puts the digits wherever that device's layout happens to put them, and
 * on Android brings the whole edge-to-edge inset problem with it (see
 * CLAUDE.md rule 7). A fixed 3×4 pad has none of that: the keys are
 * always in the same place, always large, and the sheet needs no
 * KeyboardSafeScreen because no system keyboard is ever raised. The
 * amount field is therefore NOT a TextInput at all — it is a rendered
 * number, and the pad below is the only way to change it, which is also
 * why "Fokus liegt beim Öffnen darauf" needs no focus call: there is
 * nowhere else the digits could go.
 *
 * Everything optional (duration, note) sits behind "Mehr", collapsed, so
 * the three decisions that matter — amount, pump, side — are the only
 * things on screen when it opens.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { KeyboardSafeScreen } from '@/ui';

import type { PumpingPalette } from '../night-mode';
import { PUMP_OPTIONS, type PumpingSide } from '../types';

/** Every touch target in this sheet is at least this tall (night-mode requirement: ≥ 48 dp). */
const TOUCH_TARGET = 56;
/** Guards against a slipped finger on the pad turning into an absurd amount. */
const MAX_AMOUNT_ML = 9999;

export type PumpingEntryValues = {
  amountMl: number;
  side: PumpingSide;
  pump: string | null;
  /** "HH:mm" — only sent when the parent actually changed it. */
  time?: string;
  durationS?: number | null;
  note?: string | null;
};

export type PumpingEntrySheetProps = {
  visible: boolean;
  palette: PumpingPalette;
  /** The pump chosen last time, pre-selected — most people own one pump and use it every time. */
  initialPump: string | null;
  /** Current wall-clock "HH:mm" in the device timezone, shown as the default time. */
  nowHhMm: string;
  onCancel: () => void;
  onSave: (values: PumpingEntryValues) => void;
};

const SIDE_LABELS: { value: PumpingSide; label: string }[] = [
  { value: 'left', label: 'Links' },
  { value: 'right', label: 'Rechts' },
  { value: 'both', label: 'Beide' },
];

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export function PumpingEntrySheet({
  visible,
  palette,
  initialPump,
  nowHhMm,
  onCancel,
  onSave,
}: PumpingEntrySheetProps) {
  // Digits as typed, not a number: "0" and "" must stay distinguishable
  // while the parent is still tapping, and a leading zero must not survive
  // into the stored amount.
  const [digits, setDigits] = useState('');
  const [side, setSide] = useState<PumpingSide>('both');
  const [pump, setPump] = useState<string | null>(initialPump ?? PUMP_OPTIONS[0]);
  const [time, setTime] = useState(nowHhMm);
  const [timeChanged, setTimeChanged] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('');
  const [note, setNote] = useState('');

  const amountMl = digits === '' ? 0 : Math.min(Number(digits), MAX_AMOUNT_ML);
  const canSave = amountMl > 0;

  const reset = () => {
    setDigits('');
    setSide('both');
    setTime(nowHhMm);
    setTimeChanged(false);
    setShowMore(false);
    setDurationMinutes('');
    setNote('');
  };

  const handleDigit = (digit: string) => {
    setDigits((current) => {
      const next = `${current}${digit}`.replace(/^0+(?=\d)/, '');
      return Number(next) > MAX_AMOUNT_ML ? current : next;
    });
  };

  const handleSave = () => {
    if (!canSave) {
      return;
    }
    const minutes = Number(durationMinutes);
    onSave({
      amountMl,
      side,
      pump,
      // Only sent when actually edited — otherwise the repository stores
      // the real current instant rather than a re-parsed "now".
      time: timeChanged ? time : undefined,
      // The field asks for MINUTES because that is how people think about
      // a pumping session; the column is duration_s, so it is converted
      // here, once, at the only place that knows the unit of the input.
      durationS: durationMinutes !== '' && Number.isFinite(minutes) ? Math.round(minutes * 60) : null,
      note: note.trim() === '' ? null : note.trim(),
    });
    reset();
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const chipStyle = (selected: boolean) => [
    styles.chip,
    {
      backgroundColor: selected ? palette.accent : palette.surface,
      borderColor: selected ? palette.accent : palette.border,
    },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
      {/*
        KeyboardSafeScreen, nicht eine nackte ScrollView: Die drei optionalen
        Felder unten (Uhrzeit, Dauer, Notiz) SIND TextInputs, und damit gilt
        CLAUDE.md Regel 7 auch hier — seit Edge-to-Edge verkleinert Android
        das Fenster nicht mehr, die Tastatur würde sie sonst verdecken. Der
        Zifferblock darüber braucht sie nicht (er ist kein TextInput), das
        Sheet als Ganzes aber schon. `hasTabBar` bleibt aus: ein Modal deckt
        die Tab-Leiste ohnehin ab, sonst würde ihre Höhe doppelt zählen.
      */}
      <View style={[styles.backdrop, { backgroundColor: palette.background }]}>
        <KeyboardSafeScreen contentContainerStyle={styles.content}>
          {/* Menge — kein TextInput, siehe Modulkommentar. */}
          <ThemedText style={[styles.fieldLabel, { color: palette.textSecondary }]}>Menge</ThemedText>
          <View
            accessibilityRole="text"
            accessibilityLabel={`Menge ${amountMl} Milliliter`}
            style={[styles.amountBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText style={[styles.amountValue, { color: palette.text }]}>
              {digits === '' ? '0' : digits}
            </ThemedText>
            <ThemedText style={[styles.amountUnit, { color: palette.textSecondary }]}>ml</ThemedText>
          </View>

          <View style={styles.keypad}>
            {KEYPAD_ROWS.map((row) => (
              <View key={row.join('')} style={styles.keypadRow}>
                {row.map((digit) => (
                  <KeypadKey key={digit} label={digit} palette={palette} onPress={() => handleDigit(digit)} />
                ))}
              </View>
            ))}
            <View style={styles.keypadRow}>
              <KeypadKey
                label="C"
                accessibilityLabel="Eingabe löschen"
                palette={palette}
                onPress={() => setDigits('')}
              />
              <KeypadKey label="0" palette={palette} onPress={() => handleDigit('0')} />
              <KeypadKey
                label="⌫"
                accessibilityLabel="Letzte Ziffer löschen"
                palette={palette}
                onPress={() => setDigits((current) => current.slice(0, -1))}
              />
            </View>
          </View>

          <ThemedText style={[styles.fieldLabel, { color: palette.textSecondary }]}>Pumpe</ThemedText>
          <View style={styles.chipRow}>
            {PUMP_OPTIONS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: pump === option }}
                onPress={() => setPump(option)}
                style={chipStyle(pump === option)}>
                <ThemedText
                  style={{ color: pump === option ? palette.accentText : palette.text }}>
                  {option}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={[styles.fieldLabel, { color: palette.textSecondary }]}>Seite</ThemedText>
          <View style={styles.chipRow}>
            {SIDE_LABELS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: side === option.value }}
                onPress={() => setSide(option.value)}
                style={chipStyle(side === option.value)}>
                <ThemedText
                  style={{ color: side === option.value ? palette.accentText : palette.text }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {/* Zeit ist "jetzt" und bleibt es, bis jemand sie antippt. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Uhrzeit ${time}, zum Ändern antippen`}
            onPress={() => setTimeChanged(true)}
            style={[styles.timeRow, { borderColor: palette.border }]}>
            <ThemedText style={{ color: palette.textSecondary }}>Zeit</ThemedText>
            {timeChanged ? (
              <TextInput
                value={time}
                onChangeText={setTime}
                placeholder="HH:MM"
                placeholderTextColor={palette.textSecondary}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                style={[styles.timeInput, { color: palette.text, borderColor: palette.border }]}
              />
            ) : (
              <ThemedText style={{ color: palette.text }}>{time} · jetzt</ThemedText>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setShowMore((current) => !current)}
            style={styles.moreToggle}>
            <ThemedText style={{ color: palette.textSecondary }}>
              {showMore ? 'Mehr ausblenden' : 'Mehr'}
            </ThemedText>
          </Pressable>

          {showMore ? (
            <View style={styles.moreBlock}>
              <ThemedText style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                Dauer (Minuten)
              </ThemedText>
              <TextInput
                value={durationMinutes}
                onChangeText={(value) => setDurationMinutes(value.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="optional"
                placeholderTextColor={palette.textSecondary}
                style={[styles.input, { color: palette.text, borderColor: palette.border }]}
              />
              <ThemedText style={[styles.fieldLabel, { color: palette.textSecondary }]}>Notiz</ThemedText>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="optional"
                placeholderTextColor={palette.textSecondary}
                multiline
                style={[styles.input, styles.noteInput, { color: palette.text, borderColor: palette.border }]}
              />
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCancel}
              style={[styles.secondaryButton, { borderColor: palette.border }]}>
              <ThemedText style={{ color: palette.textSecondary }}>Abbrechen</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              onPress={handleSave}
              style={[
                styles.primaryButton,
                { backgroundColor: palette.accent, opacity: canSave ? 1 : 0.4 },
              ]}>
              <ThemedText style={[styles.primaryLabel, { color: palette.accentText }]}>
                Speichern
              </ThemedText>
            </Pressable>
          </View>
        </KeyboardSafeScreen>
      </View>
    </Modal>
  );
}

function KeypadKey({
  label,
  palette,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  palette: PumpingPalette;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        {
          backgroundColor: pressed ? palette.surfacePressed : palette.surface,
          borderColor: palette.border,
        },
      ]}>
      <ThemedText style={[styles.keyLabel, { color: palette.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  fieldLabel: { fontSize: 13, marginTop: Spacing.two },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
  },
  amountValue: { fontSize: 56, lineHeight: 64, fontWeight: '700' },
  amountUnit: { fontSize: 20 },
  keypad: { gap: Spacing.two },
  keypadRow: { flexDirection: 'row', gap: Spacing.two },
  key: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  keyLabel: { fontSize: 24, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  timeInput: {
    minWidth: 90,
    minHeight: 44,
    textAlign: 'right',
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  moreToggle: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  moreBlock: { gap: Spacing.two },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  noteInput: { minHeight: 88, paddingTop: Spacing.two, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  secondaryButton: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  primaryButton: {
    flex: 2,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
  },
  primaryLabel: { fontSize: 18, fontWeight: '700' },
});
