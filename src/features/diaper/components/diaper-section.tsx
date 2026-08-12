/**
 * Wickeln section of the "Heute" screen.
 *
 * No timer, no multi-device conflict — logging is a single immediate write.
 * Same interaction pattern as Füttern (see
 * features/feeding/components/feeding-section.tsx): big buttons for the
 * common case, a tap-to-edit list, a naming delete confirmation. Reuses the
 * shared `BigButton`/`Chip` primitives and colors from `@/ui`.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';
import { BigButton, Chip, TextField, useUiColors } from '@/ui';

import { editDiaper, logDiaper, softDeleteDiaper, useDiapersOfDay } from '../repository';
import type { DiaperEditInput } from '../repository';
import {
  describeDiaperColor,
  describeDiaperConsistency,
  describeDiaperKind,
  formatDiaperSummaryLabel,
  summarizeDiapersOfDay,
} from '../summary';
import type { DiaperColor, DiaperConsistency, DiaperKind, DiaperRow } from '../types';

const KIND_OPTIONS: readonly DiaperKind[] = ['wet', 'dirty', 'both'];
const CONSISTENCY_OPTIONS: readonly DiaperConsistency[] = ['liquid', 'soft', 'formed', 'hard'];
const COLOR_OPTIONS: readonly DiaperColor[] = ['yellow', 'green', 'brown', 'black', 'red', 'white'];

export type DiaperSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
};

export function DiaperSection({ child, session, tz }: DiaperSectionProps) {
  const db = usePowerSync();
  const { accent, amber, green } = useUiColors();
  const todayLocalDate = toLocalDate(nowUtcIso(), tz);
  const { diapers: todayDiapers } = useDiapersOfDay(child?.childId, todayLocalDate);

  const [busy, setBusy] = useState(false);
  const [detailsPromptId, setDetailsPromptId] = useState<string | null>(null);
  const [editDiaperId, setEditDiaperId] = useState<string | null>(null);

  const handleLog = useCallback(
    async (kind: DiaperKind) => {
      if (!child || !session?.user.id) return;
      setBusy(true);
      try {
        const diaperId = await logDiaper(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          kind,
        });
        setDetailsPromptId(diaperId);
        setEditDiaperId(null);
      } catch (error) {
        console.error('[LifeBook] Wickeln konnte nicht gespeichert werden', error);
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz],
  );

  const handleSaveDetails = useCallback(
    async (diaperId: string, input: DiaperEditInput) => {
      setBusy(true);
      try {
        await editDiaper(db, diaperId, input);
        setDetailsPromptId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleOpenEdit = useCallback((diaperId: string) => {
    setEditDiaperId(diaperId);
    setDetailsPromptId(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (diaperId: string, input: DiaperEditInput) => {
      setBusy(true);
      try {
        await editDiaper(db, diaperId, input);
        setEditDiaperId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleRequestDelete = useCallback(
    (diaper: DiaperRow) => {
      const label = describeDiaperKind(diaper.kind);
      const time = formatTimeLabel(diaper.occurred_at, diaper.tz);

      Alert.alert('Eintrag löschen?', `${label}, ${time} wirklich löschen?`, [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await softDeleteDiaper(db, diaper.id);
            setEditDiaperId(null);
          },
        },
      ]);
    },
    [db],
  );

  const summary = summarizeDiapersOfDay(todayDiapers);
  const editTarget = editDiaperId ? todayDiapers.find((diaper) => diaper.id === editDiaperId) : undefined;

  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <BigButton label="Nass" color={accent} onPress={() => handleLog('wet')} disabled={busy || !child} />
        <BigButton label="Stuhl" color={amber} onPress={() => handleLog('dirty')} disabled={busy || !child} />
        <BigButton label="Beides" color={green} onPress={() => handleLog('both')} disabled={busy || !child} />
      </View>

      {detailsPromptId ? (
        <DiaperDetailsPrompt
          busy={busy}
          onSave={(input) => handleSaveDetails(detailsPromptId, input)}
          onDismiss={() => setDetailsPromptId(null)}
        />
      ) : null}

      {/* The tally a midwife asks for — kept right after the buttons, before
          the (potentially long) list below, so it never needs scrolling to
          find within this section. */}
      <ThemedText type="smallBold">{formatDiaperSummaryLabel(summary)}</ThemedText>

      {editTarget ? (
        <DiaperEditPanel
          diaper={editTarget}
          busy={busy}
          onCancel={() => setEditDiaperId(null)}
          onSave={(input) => handleSaveEdit(editTarget.id, input)}
          onDelete={() => handleRequestDelete(editTarget)}
        />
      ) : null}

      {todayDiapers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Noch kein Wickeln heute.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {[...todayDiapers].reverse().map((diaper) => (
            <DiaperRowItem key={diaper.id} diaper={diaper} onPress={() => handleOpenEdit(diaper.id)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Shared consistency/color/leaked chips, used by both the post-log prompt and the full edit panel. */
function DiaperDetailFields({
  consistency,
  onConsistencyChange,
  color,
  onColorChange,
  leaked,
  onLeakedChange,
}: {
  consistency: DiaperConsistency | null;
  onConsistencyChange: (value: DiaperConsistency | null) => void;
  color: DiaperColor | null;
  onColorChange: (value: DiaperColor | null) => void;
  leaked: boolean;
  onLeakedChange: (value: boolean) => void;
}) {
  const { dangerText } = useUiColors();

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Konsistenz
      </ThemedText>
      <View style={styles.chipRow}>
        {CONSISTENCY_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={describeDiaperConsistency(option)}
            selected={consistency === option}
            onPress={() => onConsistencyChange(consistency === option ? null : option)}
          />
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Farbe
      </ThemedText>
      <View style={styles.chipRow}>
        {COLOR_OPTIONS.slice(0, 3).map((option) => (
          <Chip
            key={option}
            label={describeDiaperColor(option)}
            selected={color === option}
            onPress={() => onColorChange(color === option ? null : option)}
          />
        ))}
      </View>
      <View style={styles.chipRow}>
        {COLOR_OPTIONS.slice(3, 6).map((option) => (
          <Chip
            key={option}
            label={describeDiaperColor(option)}
            selected={color === option}
            onPress={() => onColorChange(color === option ? null : option)}
          />
        ))}
      </View>

      <View style={styles.chipRow}>
        <Chip label="Ausgelaufen" selected={leaked} onPress={() => onLeakedChange(!leaked)} color={dangerText} />
      </View>
    </>
  );
}

/**
 * Transient prompt right after logging — "wer sie ignoriert, hat trotzdem
 * einen korrekten Eintrag": dismissing via "Fertig" leaves the entry exactly
 * as `logDiaper` created it, no details required.
 */
function DiaperDetailsPrompt({
  busy,
  onSave,
  onDismiss,
}: {
  busy: boolean;
  onSave: (input: DiaperEditInput) => void;
  onDismiss: () => void;
}) {
  const [consistency, setConsistency] = useState<DiaperConsistency | null>(null);
  const [color, setColor] = useState<DiaperColor | null>(null);
  const [leaked, setLeaked] = useState(false);

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <ThemedText type="smallBold">Details ergänzen?</ThemedText>
      <DiaperDetailFields
        consistency={consistency}
        onConsistencyChange={setConsistency}
        color={color}
        onColorChange={setColor}
        leaked={leaked}
        onLeakedChange={setLeaked}
      />
      <View style={styles.panelActions}>
        <Pressable onPress={onDismiss} hitSlop={8} disabled={busy}>
          <ThemedText type="link" themeColor="textSecondary">
            Fertig
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => onSave({ consistency, color, leaked: leaked ? 1 : 0 })}
          hitSlop={8}
          disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

/** Correction panel opened by tapping a row — same shape as Füttern's `FeedEditPanel`. */
function DiaperEditPanel({
  diaper,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  diaper: DiaperRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: DiaperEditInput) => void;
  onDelete: () => void;
}) {
  const [time, setTime] = useState(formatTimeLabel(diaper.occurred_at, diaper.tz));
  const [kind, setKind] = useState<DiaperKind>(diaper.kind);
  const [consistency, setConsistency] = useState<DiaperConsistency | null>(diaper.consistency);
  const [color, setColor] = useState<DiaperColor | null>(diaper.color);
  const [leaked, setLeaked] = useState(diaper.leaked === 1);
  const [error, setError] = useState<string | null>(null);
  const { dangerText } = useUiColors();

  const handleSave = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Uhrzeit bitte als HH:MM eingeben.');
      return;
    }
    setError(null);
    onSave({ time, kind, consistency, color, leaked: leaked ? 1 : 0 });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <ThemedText type="smallBold">{describeDiaperKind(diaper.kind)}</ThemedText>

      <TextField
        label="Uhrzeit (HH:MM)"
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
      />

      <View style={styles.chipRow}>
        {KIND_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={describeDiaperKind(option)}
            selected={kind === option}
            onPress={() => setKind(option)}
          />
        ))}
      </View>

      <DiaperDetailFields
        consistency={consistency}
        onConsistencyChange={setConsistency}
        color={color}
        onColorChange={setColor}
        leaked={leaked}
        onLeakedChange={setLeaked}
      />

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
        <Pressable onPress={onDelete} hitSlop={8} disabled={busy}>
          <ThemedText type="link" style={{ color: dangerText }}>
            Löschen
          </ThemedText>
        </Pressable>
        <Pressable onPress={handleSave} hitSlop={8} disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function DiaperRowItem({ diaper, onPress }: { diaper: DiaperRow; onPress: () => void }) {
  const time = formatTimeLabel(diaper.occurred_at, diaper.tz);
  const kindLabel = describeDiaperKind(diaper.kind);
  const { dangerText } = useUiColors();

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold" style={styles.rowTime}>
          {time}
        </ThemedText>
        <ThemedText type="small" style={styles.rowType}>
          {kindLabel}
        </ThemedText>
        {diaper.leaked === 1 ? (
          <ThemedText type="small" style={{ color: dangerText }}>
            ausgelaufen
          </ThemedText>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  actions: { gap: Spacing.two },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  panelActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
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
  rowType: { flex: 1 },
});
