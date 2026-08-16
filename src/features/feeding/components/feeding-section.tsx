/**
 * Füttern section of the "Heute" screen (Stufe 4, first tracking feature).
 *
 * Extracted verbatim from the old standalone screen when "Heute" grew a
 * second section (Wickeln) — behavior is unchanged, only the outer
 * SafeAreaView/ScrollView shell moved up to the parent screen, and
 * `child`/`session`/`tz`/`tickingNow` are now props instead of being read
 * here directly, so the "Heute" screen only queries the active child once.
 *
 * Built for one-handed, in-the-dark use: large full-width buttons, high
 * contrast, no small tap targets. All timer math is the pure logic in
 * features/feeding/timer.ts; this file only renders it and calls the
 * repository — no time construction happens here.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatTimeLabel, toLocalDate } from '@/core/time';
import type { ActiveChild } from '@/features/household/repository';
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
import { BigButton, Chip, TextField, useHydrateOnce, useUiColors } from '@/ui';

export type FeedingSectionProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
  tickingNow: string;
};

export function FeedingSection({ child, session, tz, tickingNow }: FeedingSectionProps) {
  const db = usePowerSync();
  const { accent, amber, green } = useUiColors();

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

  if (openLoading) {
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
    <View style={styles.section}>
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
        <BottleForm busy={busy} onCancel={() => setBottleFormOpen(false)} onSave={handleSaveBottle} />
      ) : openFeed ? (
        <View style={styles.actions}>
          <BigButton
            label="Seite wechseln"
            color={accent}
            onPress={handleSwitchSide}
            disabled={busy || !isRunning}
          />
          <BigButton
            label={isRunning ? 'Pause' : 'Weiter'}
            color={amber}
            onPress={handlePauseResume}
            disabled={busy}
          />
          <BigButton label="Beenden" color={green} onPress={handleEndFeed} disabled={busy} />
        </View>
      ) : (
        <View style={styles.actions}>
          <BigButton
            label="Stillen links"
            color={accent}
            onPress={() => handleStart('left')}
            disabled={busy || !child}
          />
          <BigButton
            label="Stillen rechts"
            color={accent}
            onPress={() => handleStart('right')}
            disabled={busy || !child}
          />
          <BigButton
            label="Fläschchen"
            color={accent}
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
  const { warningBg, warningText } = useUiColors();

  return (
    <ThemedView style={[styles.banner, { backgroundColor: warningBg }]}>
      <ThemedText type="smallBold" style={{ color: warningText }}>
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
  const [leftMin, setLeftMin] = useState('');
  const [rightMin, setRightMin] = useState('');

  // Gleiche Begründung wie in FeedEditPanel — siehe dort (Architekturregel 9).
  const hydrate = useCallback((loaded: FeedRow) => {
    setLeftMin(String(Math.round((loaded.duration_left_s ?? 0) / 60)));
    setRightMin(String(Math.round((loaded.duration_right_s ?? 0) / 60)));
  }, []);
  useHydrateOnce(feed, feed.id, hydrate);

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
          <TextField label="Links (min)" value={leftMin} onChangeText={setLeftMin} keyboardType="number-pad" />
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
  const { dangerBg, dangerText } = useUiColors();

  return (
    <ThemedView style={[styles.banner, { backgroundColor: dangerBg }]}>
      <ThemedText type="smallBold" style={{ color: dangerText }}>
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
  const { accent, dangerText } = useUiColors();

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
        <Chip label="Muttermilch" selected={kind === 'breastmilk'} onPress={() => setKind('breastmilk')} />
        <Chip label="Nahrung" selected={kind === 'formula'} onPress={() => setKind('formula')} />
      </View>
      {error ? (
        <ThemedText type="small" style={{ color: dangerText }}>
          {error}
        </ThemedText>
      ) : null}
      <View style={styles.bottleFormActions}>
        <BigButton label="Abbrechen" color={accent} variant="secondary" onPress={onCancel} disabled={busy} />
        <BigButton label="Speichern" color={accent} onPress={handleSave} disabled={busy} />
      </View>
    </ThemedView>
  );
}

/**
 * Correction panel opened by tapping a row in the day's list — reused as the
 * pattern for every other tracking feature's edit panel (see
 * features/diaper/components/diaper-section.tsx): same styles
 * (`correctionPanel`, `correctionRow`/`correctionField`, `bannerActions`),
 * time plus type-specific fields, and an `onDelete` label that switches
 * between "Löschen" and "Verwerfen" depending on whether the entry has
 * actually finished.
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

  const [time, setTime] = useState('');
  const [leftMin, setLeftMin] = useState('');
  const [rightMin, setRightMin] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<BottleKind>('breastmilk');
  const [error, setError] = useState<string | null>(null);
  const { dangerText } = useUiColors();

  // Architekturregel 9: Dieses Feld war früher `useState(formatTimeLabel(feed…))`.
  // Die Liste unter diesem Panel bleibt antippbar, also kann der Nutzer
  // mitten im Bearbeiten auf eine ANDERE Fütterung wechseln — das Panel
  // bleibt dabei dieselbe React-Instanz, `useState` läuft nicht erneut, und
  // die Werte von Zeile A standen dann in einem Panel, das auf Zeile B
  // speichert (editFeed schreibt Uhrzeit, Dauer, Menge und Art auf einmal).
  // `useHydrateOnce` befüllt pro `feed.id` neu und räumt dabei auch die
  // Fehlermeldung der vorherigen Zeile weg.
  const hydrate = useCallback((loaded: FeedRow) => {
    setTime(formatTimeLabel(loaded.occurred_at, loaded.tz));
    setLeftMin(String(Math.round((loaded.duration_left_s ?? 0) / 60)));
    setRightMin(String(Math.round((loaded.duration_right_s ?? 0) / 60)));
    setAmount(loaded.amount_ml ? String(loaded.amount_ml) : '');
    setKind(loaded.feed_type === 'bottle_formula' ? 'formula' : 'breastmilk');
    setError(null);
  }, []);
  useHydrateOnce(feed, feed.id, hydrate);

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
            <Chip label="Muttermilch" selected={kind === 'breastmilk'} onPress={() => setKind('breastmilk')} />
            <Chip label="Nahrung" selected={kind === 'formula'} onPress={() => setKind('formula')} />
          </View>
        </>
      )}

      {error ? (
        <ThemedText type="small" style={{ color: dangerText }}>
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
          <ThemedText type="link" style={{ color: dangerText }}>
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
  const { amber } = useUiColors();

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
        {feed.needs_review === 1 ? <ThemedText style={{ color: amber }}> ⚠</ThemedText> : null}
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
  correctionPanel: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  correctionRow: { flexDirection: 'row', gap: Spacing.two },
  correctionField: { flex: 1 },
  bottleForm: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  kindRow: { flexDirection: 'row', gap: Spacing.two },
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
