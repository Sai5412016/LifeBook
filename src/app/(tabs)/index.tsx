/**
 * Füttern — the start screen (Stufe 4, first tracking feature).
 *
 * Route "index": needed many times a day, unlike the Chronik (a few times a
 * week), so it gets the app's launch slot — see components/app-tabs.tsx.
 *
 * Built for one-handed, in-the-dark use: large full-width buttons, high
 * contrast, no small tap targets. All timer math is the pure logic in
 * features/feeding/timer.ts; this file only renders it and calls the
 * repository — no time construction happens here.
 */

import { usePowerSync } from '@powersync/react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { formatTimeLabel, nowUtcIso, toLocalDate } from '@/core/time';
import { deviceTimeZone } from '@/core/time/device';
import { useActiveChild } from '@/features/household/repository';
import {
  acknowledgeReviewFlag,
  correctFeedDurations,
  editFeed,
  endFeed,
  logBottle,
  pauseFeed,
  resumeFeed,
  softDeleteFeed,
  startBreastFeed,
  switchSide,
  useFeedsNeedingReview,
  useFeedsOfDay,
  useLastCompletedFeed,
  useOpenFeed,
  useRunningFeed,
} from '@/features/feeding/repository';
import type { FeedEditInput } from '@/features/feeding/repository';
import {
  describeFeedAmount,
  describeFeedQuantity,
  describeFeedType,
  elapsedSeconds,
  formatClock,
  formatDuration,
  formatSinceLastFeed,
  isRunaway,
} from '@/features/feeding/timer';
import type { BottleKind, FeedRow, FeedSide } from '@/features/feeding/types';
import { TextField } from '@/ui';

const ACCENT = '#3c87f7';
const AMBER = '#d9822b';
const GREEN = '#3ba55d';
const WARNING_BG = '#3a2c10';
const DANGER_BG = '#3a1414';
const DANGER_TEXT = '#ff8a80';

/** Ticks every second so the running timer and "vor …" labels stay live. */
function useTickingNow(): string {
  const [now, setNow] = useState(() => nowUtcIso());

  useEffect(() => {
    const id = setInterval(() => setNow(nowUtcIso()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export default function FuetternScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child, isLoading: childLoading } = useActiveChild();
  const tz = deviceTimeZone();
  const tickingNow = useTickingNow();

  // Reactive conflict resolution: a second concurrently running timer that
  // arrived via sync is resolved here, not only when a timer is started.
  useRunningFeed(child?.childId);

  const { feed: openFeed, isLoading: openLoading } = useOpenFeed(child?.childId);
  const { feed: lastCompletedFeed } = useLastCompletedFeed(child?.childId);
  const todayLocalDate = toLocalDate(tickingNow, tz);
  const { feeds: todayFeeds } = useFeedsOfDay(child?.childId, todayLocalDate);
  const reviewFeeds = useFeedsNeedingReview(child?.childId);

  const [busy, setBusy] = useState(false);
  const [bottleFormOpen, setBottleFormOpen] = useState(false);
  const [reviewFeedIdOpen, setReviewFeedIdOpen] = useState<string | null>(null);
  const [editFeedId, setEditFeedId] = useState<string | null>(null);
  const [runawayDismissedFeedId, setRunawayDismissedFeedId] = useState<string | null>(null);

  const handleStart = useCallback(
    async (side: FeedSide) => {
      if (!child || !session?.user.id) return;
      setBusy(true);
      try {
        await startBreastFeed(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          side,
        });
      } catch (error) {
        console.error('[LifeBook] Stillen konnte nicht gestartet werden', error);
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz],
  );

  const handleSwitchSide = useCallback(async () => {
    if (!openFeed) return;
    setBusy(true);
    try {
      await switchSide(db, openFeed.id);
    } finally {
      setBusy(false);
    }
  }, [db, openFeed]);

  const handlePauseResume = useCallback(async () => {
    if (!openFeed) return;
    setBusy(true);
    try {
      if (openFeed.is_running) {
        await pauseFeed(db, openFeed.id);
      } else {
        await resumeFeed(db, openFeed.id);
      }
    } finally {
      setBusy(false);
    }
  }, [db, openFeed]);

  const handleEndFeed = useCallback(async () => {
    if (!openFeed) return;
    setBusy(true);
    try {
      await endFeed(db, openFeed.id);
      setRunawayDismissedFeedId(null);
    } finally {
      setBusy(false);
    }
  }, [db, openFeed]);

  const handleSaveBottle = useCallback(
    async (amountMl: number, kind: BottleKind) => {
      if (!child || !session?.user.id) return;
      setBusy(true);
      try {
        await logBottle(db, {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          amountMl,
          kind,
        });
        setBottleFormOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [child, session?.user.id, db, tz],
  );

  const handleAcknowledgeReview = useCallback(
    async (feedId: string) => {
      await acknowledgeReviewFlag(db, feedId);
      setReviewFeedIdOpen((current) => (current === feedId ? null : current));
    },
    [db],
  );

  const handleSaveCorrection = useCallback(
    async (feedId: string, durationLeftS: number, durationRightS: number) => {
      await correctFeedDurations(db, feedId, { durationLeftS, durationRightS });
      setReviewFeedIdOpen(null);
    },
    [db],
  );

  const handleOpenEdit = useCallback((feedId: string) => {
    setEditFeedId(feedId);
    setBottleFormOpen(false);
    setReviewFeedIdOpen(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (feedId: string, input: FeedEditInput) => {
      setBusy(true);
      try {
        await editFeed(db, feedId, input);
        setEditFeedId(null);
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  const handleRequestDelete = useCallback(
    (feed: FeedRow) => {
      const isOpenFeed = feed.ended_at === null;
      const label = describeFeedType(feed.feed_type);
      const time = formatTimeLabel(feed.occurred_at, feed.tz);
      const message = isOpenFeed
        ? `${label}, gestartet um ${time}, wirklich verwerfen?`
        : `${label}, ${time}, ${describeFeedQuantity(feed)} wirklich löschen?`;

      Alert.alert(isOpenFeed ? 'Fütterung verwerfen?' : 'Fütterung löschen?', message, [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: isOpenFeed ? 'Verwerfen' : 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await softDeleteFeed(db, feed.id);
            setEditFeedId(null);
          },
        },
      ]);
    },
    [db],
  );

  if (childLoading || openLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const isRunning = openFeed?.is_running === 1;
  const runawayVisible =
    isRunning && !!openFeed && runawayDismissedFeedId !== openFeed.id && isRunaway(openFeed, tickingNow);

  let statusText: string;
  if (openFeed) {
    const elapsed = elapsedSeconds(openFeed, tickingNow);
    const sideLabel = openFeed.running_side === 'right' ? 'rechts' : 'links';
    if (isRunning) {
      const activeSeconds = openFeed.running_side === 'right' ? elapsed.right : elapsed.left;
      statusText = `Stillen ${sideLabel} · ${formatClock(activeSeconds)}`;
    } else {
      statusText = `Pausiert · ${sideLabel}, ${formatDuration(elapsed.left + elapsed.right)}`;
    }
  } else if (lastCompletedFeed) {
    statusText = `Letzte Mahlzeit ${formatSinceLastFeed(lastCompletedFeed.occurred_at, tickingNow)} · ${describeFeedAmount(lastCompletedFeed)}`;
  } else {
    statusText = 'Noch keine Fütterung erfasst';
  }

  const reviewFeedOpen = reviewFeedIdOpen
    ? reviewFeeds.find((feed) => feed.id === reviewFeedIdOpen)
    : undefined;
  const editFeedTarget = editFeedId ? todayFeeds.find((feed) => feed.id === editFeedId) : undefined;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            {child ? child.firstName : 'Füttern'}
          </ThemedText>

          {reviewFeeds.length > 0 ? (
            <ReviewBanner
              count={reviewFeeds.length}
              onOpen={() => {
                setReviewFeedIdOpen(reviewFeeds[0].id);
                setEditFeedId(null);
              }}
              onAcknowledge={() => handleAcknowledgeReview(reviewFeeds[0].id)}
            />
          ) : null}

          {reviewFeedOpen ? (
            <ReviewCorrectionPanel
              feed={reviewFeedOpen}
              onCancel={() => setReviewFeedIdOpen(null)}
              onAcknowledge={() => handleAcknowledgeReview(reviewFeedOpen.id)}
              onSave={(leftS, rightS) => handleSaveCorrection(reviewFeedOpen.id, leftS, rightS)}
            />
          ) : null}

          {runawayVisible && openFeed ? (
            <RunawayBanner onEnd={handleEndFeed} onDismiss={() => setRunawayDismissedFeedId(openFeed.id)} />
          ) : null}

          <ThemedText type="title" style={styles.status}>
            {statusText}
          </ThemedText>

          {bottleFormOpen ? (
            <BottleForm
              busy={busy}
              onCancel={() => setBottleFormOpen(false)}
              onSave={handleSaveBottle}
            />
          ) : openFeed ? (
            <View style={styles.actions}>
              <BigButton label="Seite wechseln" color={ACCENT} onPress={handleSwitchSide} disabled={busy || !isRunning} />
              <BigButton
                label={isRunning ? 'Pause' : 'Weiter'}
                color={AMBER}
                onPress={handlePauseResume}
                disabled={busy}
              />
              <BigButton label="Beenden" color={GREEN} onPress={handleEndFeed} disabled={busy} />
            </View>
          ) : (
            <View style={styles.actions}>
              <BigButton label="Stillen links" color={ACCENT} onPress={() => handleStart('left')} disabled={busy || !child} />
              <BigButton label="Stillen rechts" color={ACCENT} onPress={() => handleStart('right')} disabled={busy || !child} />
              <BigButton
                label="Fläschchen"
                color={ACCENT}
                variant="secondary"
                onPress={() => {
                  setBottleFormOpen(true);
                  setEditFeedId(null);
                }}
                disabled={busy || !child}
              />
            </View>
          )}

          <ThemedText type="smallBold" style={styles.listTitle}>
            Heute
          </ThemedText>

          {editFeedTarget ? (
            <FeedEditPanel
              feed={editFeedTarget}
              busy={busy}
              onCancel={() => setEditFeedId(null)}
              onSave={(input) => handleSaveEdit(editFeedTarget.id, input)}
              onDelete={() => handleRequestDelete(editFeedTarget)}
            />
          ) : null}

          {todayFeeds.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Fütterung heute.
            </ThemedText>
          ) : (
            <View style={styles.list}>
              {[...todayFeeds].reverse().map((feed) => (
                <TodayFeedRow
                  key={feed.id}
                  feed={feed}
                  tickingNow={tickingNow}
                  onPress={() => handleOpenEdit(feed.id)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function BigButton({
  label,
  color,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bigButton,
        variant === 'primary'
          ? { backgroundColor: color }
          : { backgroundColor: 'transparent', borderWidth: 2, borderColor: color },
        disabled && styles.bigButtonDisabled,
        pressed && !disabled && styles.bigButtonPressed,
      ]}>
      <ThemedText
        style={[styles.bigButtonLabel, variant === 'primary' ? { color: '#ffffff' } : { color }]}>
        {label}
      </ThemedText>
    </Pressable>
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
          ? 'Zwei Timer liefen gleichzeitig — bitte prüfen'
          : `${count} Fütterungen mit gleichzeitig laufenden Timern — bitte prüfen`}
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

function ReviewCorrectionPanel({
  feed,
  onCancel,
  onAcknowledge,
  onSave,
}: {
  feed: FeedRow;
  onCancel: () => void;
  onAcknowledge: () => void;
  onSave: (durationLeftS: number, durationRightS: number) => void;
}) {
  const [leftMin, setLeftMin] = useState(String(Math.round((feed.duration_left_s ?? 0) / 60)));
  const [rightMin, setRightMin] = useState(String(Math.round((feed.duration_right_s ?? 0) / 60)));

  const handleSave = () => {
    const left = Math.max(0, Number(leftMin) || 0);
    const right = Math.max(0, Number(rightMin) || 0);
    onSave(left * 60, right * 60);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.correctionPanel}>
      <ThemedText type="smallBold">
        {formatTimeLabel(feed.occurred_at, feed.tz)} · {describeFeedType(feed.feed_type)}
      </ThemedText>
      <View style={styles.correctionRow}>
        <View style={styles.correctionField}>
          <TextField
            label="Links (min)"
            value={leftMin}
            onChangeText={setLeftMin}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.correctionField}>
          <TextField
            label="Rechts (min)"
            value={rightMin}
            onChangeText={setRightMin}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <View style={styles.bannerActions}>
        <Pressable onPress={onCancel} hitSlop={8}>
          <ThemedText type="link" themeColor="textSecondary">
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable onPress={onAcknowledge} hitSlop={8}>
          <ThemedText type="linkPrimary">Nur bestätigen</ThemedText>
        </Pressable>
        <Pressable onPress={handleSave} hitSlop={8}>
          <ThemedText type="linkPrimary">Speichern &amp; bestätigen</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function RunawayBanner({ onEnd, onDismiss }: { onEnd: () => void; onDismiss: () => void }) {
  return (
    <ThemedView style={[styles.banner, { backgroundColor: DANGER_BG }]}>
      <ThemedText type="smallBold" style={{ color: DANGER_TEXT }}>
        Läuft schon länger als 3 Stunden — läuft der Timer noch?
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

function BottleForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (amountMl: number, kind: BottleKind) => void;
}) {
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<BottleKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const amountMl = Number(amount);
    if (!Number.isFinite(amountMl) || amountMl <= 0) {
      setError('Bitte eine Menge in ml eingeben.');
      return;
    }
    if (!kind) {
      setError('Bitte Muttermilch oder Nahrung auswählen.');
      return;
    }
    setError(null);
    onSave(Math.round(amountMl), kind);
  };

  return (
    <ThemedView type="backgroundElement" style={styles.bottleForm}>
      <TextField
        label="Menge (ml)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder="z. B. 120"
      />
      <View style={styles.kindRow}>
        <KindChip label="Muttermilch" selected={kind === 'breastmilk'} onPress={() => setKind('breastmilk')} />
        <KindChip label="Nahrung" selected={kind === 'formula'} onPress={() => setKind('formula')} />
      </View>
      {error ? (
        <ThemedText type="small" style={{ color: DANGER_TEXT }}>
          {error}
        </ThemedText>
      ) : null}
      <View style={styles.bottleFormActions}>
        <BigButton label="Abbrechen" color={ACCENT} variant="secondary" onPress={onCancel} disabled={busy} />
        <BigButton label="Speichern" color={ACCENT} onPress={handleSave} disabled={busy} />
      </View>
    </ThemedView>
  );
}

function KindChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.kindChip, selected && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
      <ThemedText style={selected ? styles.kindChipLabelSelected : styles.kindChipLabel}>{label}</ThemedText>
    </Pressable>
  );
}

/**
 * Correction panel opened by tapping a row in the "Heute" list — same shape
 * as `ReviewCorrectionPanel` above (reused styles: `correctionPanel`,
 * `correctionRow`/`correctionField`, `bannerActions`, and the `KindChip`
 * component), extended with the start time and, for a bottle feed, amount
 * and kind. Works for a feed in any state; `onDelete` is labelled by the
 * caller ("Löschen" once ended, "Verwerfen" while still open).
 */
function FeedEditPanel({
  feed,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  feed: FeedRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: FeedEditInput) => void;
  onDelete: () => void;
}) {
  const isBreast = feed.feed_type.startsWith('breast_');
  const isOpenFeed = feed.ended_at === null;

  const [time, setTime] = useState(formatTimeLabel(feed.occurred_at, feed.tz));
  const [leftMin, setLeftMin] = useState(String(Math.round((feed.duration_left_s ?? 0) / 60)));
  const [rightMin, setRightMin] = useState(String(Math.round((feed.duration_right_s ?? 0) / 60)));
  const [amount, setAmount] = useState(feed.amount_ml ? String(feed.amount_ml) : '');
  const [kind, setKind] = useState<BottleKind>(feed.feed_type === 'bottle_formula' ? 'formula' : 'breastmilk');
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Uhrzeit bitte als HH:MM eingeben.');
      return;
    }

    if (isBreast) {
      const left = Math.max(0, Number(leftMin) || 0);
      const right = Math.max(0, Number(rightMin) || 0);
      setError(null);
      onSave({ time, durationLeftS: left * 60, durationRightS: right * 60 });
      return;
    }

    const amountMl = Number(amount);
    if (!Number.isFinite(amountMl) || amountMl <= 0) {
      setError('Bitte eine Menge in ml eingeben.');
      return;
    }
    setError(null);
    onSave({ time, amountMl: Math.round(amountMl), kind });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.correctionPanel}>
      <ThemedText type="smallBold">{describeFeedType(feed.feed_type)}</ThemedText>

      <TextField
        label="Uhrzeit (HH:MM)"
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
      />

      {isBreast ? (
        <View style={styles.correctionRow}>
          <View style={styles.correctionField}>
            <TextField
              label="Links (min)"
              value={leftMin}
              onChangeText={setLeftMin}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.correctionField}>
            <TextField
              label="Rechts (min)"
              value={rightMin}
              onChangeText={setRightMin}
              keyboardType="number-pad"
            />
          </View>
        </View>
      ) : (
        <>
          <TextField label="Menge (ml)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <View style={styles.kindRow}>
            <KindChip label="Muttermilch" selected={kind === 'breastmilk'} onPress={() => setKind('breastmilk')} />
            <KindChip label="Nahrung" selected={kind === 'formula'} onPress={() => setKind('formula')} />
          </View>
        </>
      )}

      {error ? (
        <ThemedText type="small" style={{ color: DANGER_TEXT }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.bannerActions}>
        <Pressable onPress={onCancel} hitSlop={8} disabled={busy}>
          <ThemedText type="link" themeColor="textSecondary">
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} disabled={busy}>
          <ThemedText type="link" style={{ color: DANGER_TEXT }}>
            {isOpenFeed ? 'Verwerfen' : 'Löschen'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={handleSave} hitSlop={8} disabled={busy}>
          <ThemedText type="linkPrimary">Speichern</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function TodayFeedRow({
  feed,
  tickingNow,
  onPress,
}: {
  feed: FeedRow;
  tickingNow: string;
  onPress: () => void;
}) {
  const time = formatTimeLabel(feed.occurred_at, feed.tz);
  const typeLabel = describeFeedType(feed.feed_type);
  const amountLabel =
    feed.is_running === 1
      ? formatDuration(elapsedSeconds(feed, tickingNow).left + elapsedSeconds(feed, tickingNow).right)
      : describeFeedAmount(feed);

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText type="smallBold" style={styles.rowTime}>
          {time}
        </ThemedText>
        <ThemedText type="small" style={styles.rowType}>
          {typeLabel}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {amountLabel}
        </ThemedText>
        {feed.needs_review === 1 ? <ThemedText style={{ color: AMBER }}> ⚠</ThemedText> : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  content: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  status: { fontSize: 30, lineHeight: 36 },
  actions: { gap: Spacing.two },
  bigButton: {
    minHeight: 88,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  bigButtonDisabled: { opacity: 0.4 },
  bigButtonPressed: { opacity: 0.85 },
  bigButtonLabel: { fontSize: 22, fontWeight: '700' },
  banner: { gap: Spacing.one, padding: Spacing.three, borderRadius: Spacing.three },
  bannerActions: { flexDirection: 'row', gap: Spacing.four, paddingTop: Spacing.one },
  warningText: { color: '#ffd54f' },
  correctionPanel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  correctionRow: { flexDirection: 'row', gap: Spacing.two },
  correctionField: { flex: 1 },
  bottleForm: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  kindRow: { flexDirection: 'row', gap: Spacing.two },
  kindChip: {
    flex: 1,
    minHeight: 56,
    borderRadius: Spacing.two,
    borderWidth: 2,
    borderColor: '#60646C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindChipLabel: { fontSize: 16, fontWeight: '600' },
  kindChipLabelSelected: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  bottleFormActions: { flexDirection: 'row', gap: Spacing.two },
  listTitle: { paddingTop: Spacing.two },
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
