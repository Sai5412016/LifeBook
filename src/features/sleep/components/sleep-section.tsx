/**
 * Schlafen section of the "Heute" screen.
 *
 * Same interaction pattern as Füttern/Wickeln: one big button per state, a
 * tap-to-edit list, a naming delete confirmation, review/runaway banners.
 * Unlike Füttern there is no pause/resume — a sleep is either running or
 * finished — so the state machine is a single toggle. Reuses the shared
 * `BigButton`/`Chip` primitives and colors from `@/ui`.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatDuration, formatTimeLabel, toLocalDate } from '@/core/time';
import { isRunaway } from '@/core/tracking/running-conflicts';
import type { ActiveChild } from '@/features/household/repository';
import { ACCENT, BigButton, Chip, DANGER_BG, DANGER_TEXT, TextField, WARNING_BG } from '@/ui';

import {
  acknowledgeSleepReviewFlag,
  editSleep,
  endSleep,
  softDeleteSleep,
  startSleep,
  useLastCompletedSleep,
  useRunningSleep,
  useSleepsNeedingReview,
  useSleepsOfDay,
} from '../repository';
import type { SleepEditInput } from '../repository';
import {
  describeSleepLocation,
  formatAwakeSince,
  formatSleepSummaryLabel,
  formatSleepingSince,
  sleepDurationSeconds,
  summarizeSleepOfDay,
} from '../timer';
import type { SleepLocation, SleepRow } from '../types';

const LOCATION_OPTIONS: readonly SleepLocation[] = ['bed', 'stroller', 'arms', 'car', 'other'];

/** A newborn sleeps in stretches of two to four hours; 12 hours running almost always means someone forgot to end it. */
const RUNAWAY_THRESHOLD_HOURS = 12;

export type SleepSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
  tickingNow: string;
};

export function SleepSection({ child, session, tz, tickingNow }: SleepSectionProps) {
  const db = usePowerSync();

  // Reactive conflict resolution: a second concurrently running sleep that
  // arrived via sync is resolved here, not only when a sleep is started.
  const { sleep: runningSleep, isLoading: runningLoading } = useRunningSleep(child?.childId);

  const { sleep: lastCompletedSleep } = useLastCompletedSleep(child?.childId);
  const todayLocalDate = toLocalDate(tickingNow, tz);
  const { sleeps: todaySleeps } = useSleepsOfDay(child?.childId, todayLocalDate);
  const reviewSleeps = useSleepsNeedingReview(child?.childId);

  const [busy, setBusy] = useState(false);
  const [locationPromptId, setLocationPromptId] = useState<string | null>(null);
  const [editSleepId, setEditSleepId] = useState<string | null>(null);
  const [runawayDismissedSleepId, setRunawayDismissedSleepId] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    if (!child || !session?.user.id) return;
    setBusy(true);
    try {
      const sleepId = await startSleep(db, {
        householdId: child.householdId,
        childId: child.childId,
        userId: session.user.id,
        tz,
      });
      setLocationPromptId(sleepId);
      setEditSleepId(null);
    } catch (error) {
      console.error('[LifeBook] Schlaf konnte nicht gestartet werden', error);
    } finally {
      setBusy(false);
    }
  }, [child, session?.user.id, db, tz]);

  const handleEnd = useCallback(async () => {
    if (!runningSleep) return;
    setBusy(true);
    try {
      await endSleep(db, runningSleep.id);
      setRunawayDismissedSleepId(null);
    } finally {
      setBusy(false);
    }
  }, [db, runningSleep]);

  const handleSaveLocation = useCallback(
    async (sleepId: string, location: SleepLocation | null) => {
      setBusy(true);
      try {
        await editSleep(db, sleepId, { location });
        setLocationPromptId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleAcknowledgeReview = useCallback(
    async (sleepId: string) => {
      await acknowledgeSleepReviewFlag(db, sleepId);
      setEditSleepId((current) => (current === sleepId ? null : current));
    },
    [db],
  );

  const handleOpenEdit = useCallback((sleepId: string) => {
    setEditSleepId(sleepId);
    setLocationPromptId(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (sleepId: string, input: SleepEditInput) => {
      setBusy(true);
      try {
        await editSleep(db, sleepId, input);
        setEditSleepId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleRequestDelete = useCallback(
    (sleep: SleepRow) => {
      const isOpenSleep = sleep.ended_at === null;
      const time = formatTimeLabel(sleep.occurred_at, sleep.tz);
      const message = isOpenSleep
        ? `Schlaf, gestartet um ${time}, wirklich verwerfen?`
        : `Schlaf, ${time}, ${formatDuration(sleepDurationSeconds(sleep, tickingNow))} wirklich löschen?`;

      Alert.alert(isOpenSleep ? 'Schlaf verwerfen?' : 'Schlaf löschen?', message, [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: isOpenSleep ? 'Verwerfen' : 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await softDeleteSleep(db, sleep.id);
            setEditSleepId(null);
          },
        },
      ]);
    },
    [db, tickingNow],
  );

  if (runningLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const runawayVisible =
    !!runningSleep &&
    runawayDismissedSleepId !== runningSleep.id &&
    isRunaway(runningSleep.occurred_at, tickingNow, RUNAWAY_THRESHOLD_HOURS);

  let statusText: string;
  if (runningSleep) {
    statusText = formatSleepingSince(runningSleep.occurred_at, tickingNow);
  } else if (lastCompletedSleep && lastCompletedSleep.ended_at) {
    const awake = formatAwakeSince(lastCompletedSleep.ended_at, tickingNow);
    const lastDuration = formatDuration(sleepDurationSeconds(lastCompletedSleep, tickingNow));
    statusText = `${awake} · letzter Schlaf ${lastDuration}`;
  } else {
    statusText = 'Noch kein Schlaf erfasst';
  }

  const summary = summarizeSleepOfDay(todaySleeps, tickingNow);
  const reviewSleepOpen = editSleepId
    ? reviewSleeps.find((sleep) => sleep.id === editSleepId)
    : undefined;
  const editTarget =
    (editSleepId ? todaySleeps.find((sleep) => sleep.id === editSleepId) : undefined) ?? reviewSleepOpen;

  return (
    <View style={styles.section}>
      {reviewSleeps.length > 0 ? (
        <ReviewBanner
          count={reviewSleeps.length}
          onOpen={() => {
            setEditSleepId(reviewSleeps[0].id);
            setLocationPromptId(null);
          }}
          onAcknowledge={() => handleAcknowledgeReview(reviewSleeps[0].id)}
        />
      ) : null}

      {runawayVisible && runningSleep ? (
        <RunawayBanner onEnd={handleEnd} onDismiss={() => setRunawayDismissedSleepId(runningSleep.id)} />
      ) : null}

      <ThemedText type="title" style={styles.status}>
        {statusText}
      </ThemedText>

      <View style={styles.actions}>
        {runningSleep ? (
          <BigButton label="Wach" color={ACCENT} onPress={handleEnd} disabled={busy} />
        ) : (
          <BigButton label="Schläft jetzt" color={ACCENT} onPress={handleStart} disabled={busy || !child} />
        )}
      </View>

      {locationPromptId ? (
        <LocationPrompt
          busy={busy}
          onSave={(location) => handleSaveLocation(locationPromptId, location)}
          onDismiss={() => setLocationPromptId(null)}
        />
      ) : null}

      {/* Tally before the (potentially long) list below, same placement as Wickeln's summary. */}
      <ThemedText type="smallBold">{formatSleepSummaryLabel(summary)}</ThemedText>

      {editTarget ? (
        <SleepEditPanel
          sleep={editTarget}
          busy={busy}
          onCancel={() => setEditSleepId(null)}
          onSave={(input) => handleSaveEdit(editTarget.id, input)}
          onDelete={() => handleRequestDelete(editTarget)}
        />
      ) : null}

      {todaySleeps.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Noch kein Schlaf heute.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {[...todaySleeps].reverse().map((sleep) => (
            <TodaySleepRow
              key={sleep.id}
              sleep={sleep}
              tickingNow={tickingNow}
              onPress={() => handleOpenEdit(sleep.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ReviewBanner({
  count,
  onOpen,
  onAcknowledge,
}: {
  count: number;
  onOpen: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <ThemedView style={[styles.banner, { backgroundColor: WARNING_BG }]}>
      <ThemedText type="smallBold" style={styles.warningText}>
        {count === 1
          ? 'Zwei Schlaf-Timer liefen gleichzeitig — bitte prüfen'
          : `${count} Schlafphasen mit gleichzeitig laufenden Timern — bitte prüfen`}
      </ThemedText>
      <View style={styles.bannerActions}>
        <Pressable onPress={onOpen} hitSlop={8}>
          <ThemedText type="linkPrimary">Öffnen</ThemedText>
        </Pressable>
        <Pressable onPress={onAcknowledge} hitSlop={8}>
          <ThemedText type="linkPrimary">Bestätigen</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function RunawayBanner({ onEnd, onDismiss }: { onEnd: () => void; onDismiss: () => void }) {
  return (
    <ThemedView style={[styles.banner, { backgroundColor: DANGER_BG }]}>
      <ThemedText type="smallBold" style={{ color: DANGER_TEXT }}>
        Läuft schon länger als 12 Stunden — schläft das Kind wirklich noch?
      </ThemedText>
      <View style={styles.bannerActions}>
        <Pressable onPress={onEnd} hitSlop={8}>
          <ThemedText type="linkPrimary">Jetzt beenden</ThemedText>
        </Pressable>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <ThemedText type="link" themeColor="textSecondary">
            Läuft weiter
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function LocationChips({
  location,
  onChange,
}: {
  location: SleepLocation | null;
  onChange: (value: SleepLocation | null) => void;
}) {
  return (
    <>
      <View style={styles.chipRow}>
        {LOCATION_OPTIONS.slice(0, 3).map((option) => (
          <Chip
            key={option}
            label={describeSleepLocation(option)}
            selected={location === option}
            onPress={() => onChange(location === option ? null : option)}
          />
        ))}
      </View>
      <View style={styles.chipRow}>
        {LOCATION_OPTIONS.slice(3, 5).map((option) => (
          <Chip
            key={option}
            label={describeSleepLocation(option)}
            selected={location === option}
            onPress={() => onChange(location === option ? null : option)}
          />
        ))}
      </View>
    </>
  );
}

/**
 * Transient prompt right after starting — "wer sie ignoriert, hat trotzdem
 * einen korrekten Eintrag": dismissing via "Fertig" leaves the entry exactly
 * as `startSleep` created it, no location required. Mirrors
 * `features/diaper/components/diaper-section.tsx#DiaperDetailsPrompt`.
 */
function LocationPrompt({
  busy,
  onSave,
  onDismiss,
}: {
  busy: boolean;
  onSave: (location: SleepLocation | null) => void;
  onDismiss: () => void;
}) {
  const [location, setLocation] = useState<SleepLocation | null>(null);

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <ThemedText type="smallBold">Ort ergänzen?</ThemedText>
      <LocationChips location={location} onChange={setLocation} />
      <View style={styles.panelActions}>
        <Pressable onPress={onDismiss} hitSlop={8} disabled={busy}>
          <ThemedText type="link" themeColor="textSecondary">
            Fertig
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => onSave(location)} hitSlop={8} disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

/** Correction panel opened by tapping a row — same shape as Füttern's/Wickeln's edit panels. */
function SleepEditPanel({
  sleep,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  sleep: SleepRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: SleepEditInput) => void;
  onDelete: () => void;
}) {
  const isOpenSleep = sleep.ended_at === null;

  const [time, setTime] = useState(formatTimeLabel(sleep.occurred_at, sleep.tz));
  const [endTime, setEndTime] = useState(sleep.ended_at ? formatTimeLabel(sleep.ended_at, sleep.tz) : '');
  const [location, setLocation] = useState<SleepLocation | null>(sleep.location);
  const [error, setError] = useState<string | null>(null);

  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  const handleSave = () => {
    if (!timePattern.test(time)) {
      setError('Uhrzeit bitte als HH:MM eingeben.');
      return;
    }
    if (!isOpenSleep && endTime && !timePattern.test(endTime)) {
      setError('Ende bitte als HH:MM eingeben.');
      return;
    }
    setError(null);
    onSave({ time, endTime: isOpenSleep ? undefined : endTime || undefined, location });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      <ThemedText type="smallBold">Schlaf</ThemedText>

      <TextField
        label="Beginn (HH:MM)"
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
      />

      {!isOpenSleep ? (
        <TextField
          label="Ende (HH:MM)"
          value={endTime}
          onChangeText={setEndTime}
          keyboardType="numbers-and-punctuation"
        />
      ) : null}

      <ThemedText type="small" themeColor="textSecondary">
        Ort
      </ThemedText>
      <LocationChips location={location} onChange={setLocation} />

      {error ? (
        <ThemedText type="small" style={{ color: DANGER_TEXT }}>
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
          <ThemedText type="link" style={{ color: DANGER_TEXT }}>
            {isOpenSleep ? 'Verwerfen' : 'Löschen'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={handleSave} hitSlop={8} disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function TodaySleepRow({
  sleep,
  tickingNow,
  onPress,
}: {
  sleep: SleepRow;
  tickingNow: string;
  onPress: () => void;
}) {
  const time = formatTimeLabel(sleep.occurred_at, sleep.tz);
  const durationLabel = formatDuration(sleepDurationSeconds(sleep, tickingNow));
  const locationLabel = sleep.location ? describeSleepLocation(sleep.location) : null;

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold" style={styles.rowTime}>
          {time}
        </ThemedText>
        <ThemedText type="small" style={styles.rowType}>
          {durationLabel}
          {locationLabel ? ` · ${locationLabel}` : ''}
        </ThemedText>
        {sleep.needs_review === 1 ? <ThemedText style={{ color: DANGER_TEXT }}> ⚠</ThemedText> : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.four },
  status: { fontSize: 30, lineHeight: 36 },
  actions: { gap: Spacing.two },
  banner: { gap: Spacing.one, padding: Spacing.three, borderRadius: Spacing.three },
  bannerActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  warningText: { color: '#ffd54f' },
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
