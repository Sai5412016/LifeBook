/**
 * Stammbaum → Vorschläge — Ergänzungen aus dem geteilten Stammbaum prüfen
 * und übernehmen (features/tree/repository.ts's accept/reject-Funktionen).
 * Erreichbar über den "Vorschläge"-Knopf in (tabs)/stammbaum.tsx, der die
 * Anzahl offener Vorschläge als Ausrufezeichen trägt.
 *
 * WICHTIG: Absendername, Vor-/Nachname, Geburtsname, Orte und die Notiz
 * eines Vorschlags sind Text, den ein Gast ohne App getippt hat — hier NUR
 * angezeigt, NIE ausgewertet. Die Längenbegrenzung dafür sitzt in
 * features/tree/suggestions.ts#truncateGuestText, nicht hier. Ein
 * angehängtes Foto ist genauso unbeglaubigtes Fremdmaterial — deshalb gibt
 * es ohne sichtbar geladenes Bild keinen "Übernehmen"-Knopf (Task 1).
 */

import { usePowerSync } from '@powersync/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/core/auth/session-store';
import { deviceTimeZone } from '@/core/time/device';
import { formatDayLabel, formatTimeLabel, toLocalDate } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { deleteQuietly } from '@/features/photos/media';
import { listShares } from '@/features/shares/repository';
import { PortraitCropper } from '@/features/tree/components/portrait-cropper';
import { displayName } from '@/features/tree/logic';
import {
  acceptAddSuggestion,
  acceptEditSuggestion,
  acceptNoteSuggestion,
  rejectSuggestion,
  useRelativesOfHousehold,
  useTreeSuggestionsOfHousehold,
} from '@/features/tree/repository';
import {
  downloadSuggestionPhotoForCropping,
  findOrphanedSuggestionPhotoCount,
  signSuggestionPhotoUrl,
  type DownloadedSuggestionPhoto,
} from '@/features/tree/suggestion-photo';
import {
  addedFields,
  changedFields,
  describeSuggestion,
  describeSuggestionKind,
  formatSuggestionPhotoSizeMb,
  truncateGuestText,
} from '@/features/tree/suggestions';
import type { RelativeRow, TreeSuggestionRow } from '@/features/tree/types';
import { useUiColors } from '@/ui';

type CropSession = { suggestion: TreeSuggestionRow; photo: DownloadedSuggestionPhoto };

export default function StammbaumVorschlaegeScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { suggestions, isLoading } = useTreeSuggestionsOfHousehold(child?.householdId);
  const { relatives } = useRelativesOfHousehold(child?.householdId);
  const relativesById = new Map(relatives.map((relative) => [relative.id, relative]));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const [cropLoadingId, setCropLoadingId] = useState<string | null>(null);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [orphanCount, setOrphanCount] = useState<number | null>(null);

  const open = suggestions.filter((s) => s.status === 'open');
  const done = suggestions.filter((s) => s.status !== 'open');

  // Signierte Anzeige-Adressen für jedes angehängte Gastfoto — Task 1:
  // "Nicht über PowerSync versuchen — das ist eine Datei, keine Zeile."
  const photoKeys = suggestions.map((s) => s.photo_key).filter((key): key is string => !!key);
  const photoKeysJoined = photoKeys.join('|');
  useEffect(() => {
    if (photoKeys.length === 0) {
      setPhotoUrls(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(photoKeys.map(async (key) => [key, await signSuggestionPhotoUrl(key)] as const)).then((entries) => {
      if (cancelled) {
        return;
      }
      const next = new Map<string, string>();
      for (const [key, url] of entries) {
        if (url) {
          next.set(key, url);
        }
      }
      setPhotoUrls(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKeysJoined]);

  // Task 5, "Aufräumen": einmal beim Öffnen prüfen, nicht bei jeder
  // Änderung der Liste — best-effort, siehe suggestion-photo.ts's eigenen
  // Kommentar zu den Grenzen dieser Prüfung ohne Live-Zugriff.
  const orphanCheckedRef = useRef(false);
  useEffect(() => {
    if (isLoading || !child?.householdId || orphanCheckedRef.current) {
      return;
    }
    orphanCheckedRef.current = true;
    (async () => {
      try {
        const shares = await listShares(child.householdId);
        const treeShareIds = shares.filter((share) => share.kind === 'tree').map((share) => share.id);
        if (treeShareIds.length === 0) {
          return;
        }
        const known = new Set(suggestions.map((s) => s.photo_key).filter((key): key is string => !!key));
        const count = await findOrphanedSuggestionPhotoCount(treeShareIds, known);
        setOrphanCount(count);
      } catch (sweepError) {
        console.error('[LifeBook] Aufräumen des Gästefoto-Speichers konnte nicht geprüft werden', sweepError);
      }
    })();
  }, [isLoading, child?.householdId, suggestions]);

  const reportOutcome = (droppedMotherId: boolean, droppedFatherId: boolean, photoFailed: boolean) => {
    const parts: string[] = [];
    const dropped = [droppedMotherId ? 'Mutter' : null, droppedFatherId ? 'Vater' : null].filter(
      (part): part is string => !!part,
    );
    if (dropped.length > 0) {
      parts.push(`${dropped.join(' und ')} konnte nicht gesetzt werden, da die vorgeschlagene Person nicht im Stammbaum gefunden wurde.`);
    }
    if (photoFailed) {
      parts.push('Das Foto konnte nicht übernommen werden.');
    }
    if (parts.length > 0) {
      Alert.alert('Vorschlag übernommen', parts.join('\n'));
    }
  };

  const handleAccept = async (s: TreeSuggestionRow) => {
    if (!session?.user.id) {
      return;
    }
    setError(null);
    setBusyId(s.id);
    try {
      if (s.kind === 'add') {
        const result = await acceptAddSuggestion(db, s, session.user.id);
        reportOutcome(result.droppedMotherId, result.droppedFatherId, result.photoFailed);
      } else if (s.kind === 'edit') {
        const result = await acceptEditSuggestion(db, s, session.user.id);
        reportOutcome(false, false, result.photoFailed);
      } else {
        await acceptNoteSuggestion(db, s, session.user.id);
      }
    } catch (acceptError) {
      console.error('[LifeBook] Vorschlag konnte nicht übernommen werden', acceptError);
      setError(acceptError instanceof Error ? acceptError.message : 'Übernehmen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  const handleEditAndAccept = async (s: TreeSuggestionRow) => {
    if (!s.photo_key) {
      // Kein Foto — der bestehende Weg über das normale Formular.
      if (s.kind === 'add') {
        router.push({ pathname: '/stammbaum/neu', params: { suggestionId: s.id } });
      } else if (s.kind === 'edit' && s.relative_id) {
        router.push({ pathname: '/stammbaum/[id]/bearbeiten', params: { id: s.relative_id, suggestionId: s.id } });
      }
      return;
    }

    // Vorschlag mit Foto: Reihenfolge laut Task 2 — anzeigen (bereits
    // geschehen, die Karte zeigt es schon) → zuschneiden/verschieben →
    // speichern. Der Zuschnitt öffnet sich direkt hier, keine Navigation.
    setError(null);
    setCropLoadingId(s.id);
    try {
      const downloaded = await downloadSuggestionPhotoForCropping(s.photo_key, s.photo_mime);
      setCropSession({ suggestion: s, photo: downloaded });
    } catch (downloadError) {
      console.error('[LifeBook] Gastfoto konnte nicht für den Zuschnitt geladen werden', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : 'Foto konnte nicht geladen werden.');
    } finally {
      setCropLoadingId(null);
    }
  };

  const handleCropCancel = () => {
    if (cropSession) {
      deleteQuietly(cropSession.photo.uri);
    }
    setCropSession(null);
  };

  const handleCropConfirm = async (croppedUri: string) => {
    if (!cropSession || !session?.user.id) {
      return;
    }
    const s = cropSession.suggestion;
    const downloadUri = cropSession.photo.uri;
    setCropSession(null);
    setError(null);
    setBusyId(s.id);
    try {
      if (s.kind === 'add') {
        const result = await acceptAddSuggestion(db, s, session.user.id, croppedUri);
        reportOutcome(result.droppedMotherId, result.droppedFatherId, result.photoFailed);
      } else if (s.kind === 'edit') {
        const result = await acceptEditSuggestion(db, s, session.user.id, croppedUri);
        reportOutcome(false, false, result.photoFailed);
      }
    } catch (acceptError) {
      console.error('[LifeBook] Vorschlag mit zugeschnittenem Foto konnte nicht übernommen werden', acceptError);
      setError(acceptError instanceof Error ? acceptError.message : 'Übernehmen fehlgeschlagen.');
    } finally {
      deleteQuietly(downloadUri);
      deleteQuietly(croppedUri);
      setBusyId(null);
    }
  };

  const handleReject = async (s: TreeSuggestionRow) => {
    if (!session?.user.id) {
      return;
    }
    setError(null);
    setBusyId(s.id);
    try {
      await rejectSuggestion(db, s, session.user.id);
    } catch (rejectError) {
      console.error('[LifeBook] Vorschlag konnte nicht abgelehnt werden', rejectError);
      setError(rejectError instanceof Error ? rejectError.message : 'Ablehnen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="link" themeColor="textSecondary">
              Zurück
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Vorschläge</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        {isLoading && suggestions.length === 0 ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {error ? (
              <ThemedText type="small" themeColor="dangerText">
                {error}
              </ThemedText>
            ) : null}

            {orphanCount ? (
              <ThemedText type="small" themeColor="textSecondary">
                {orphanCount === 1
                  ? '1 Gästefoto ohne zugehörigen Vorschlag liegt noch im Zwischenspeicher.'
                  : `${orphanCount} Gästefotos ohne zugehörigen Vorschlag liegen noch im Zwischenspeicher.`}
              </ThemedText>
            ) : null}

            {open.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Keine offenen Vorschläge.
              </ThemedText>
            ) : (
              open.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  target={s.relative_id ? relativesById.get(s.relative_id) : undefined}
                  photoUrl={s.photo_key ? photoUrls.get(s.photo_key) : undefined}
                  busy={busyId === s.id}
                  editLoading={cropLoadingId === s.id}
                  onAccept={() => handleAccept(s)}
                  onEditAndAccept={() => handleEditAndAccept(s)}
                  onReject={() => handleReject(s)}
                  onOpenFullscreen={setFullscreenUrl}
                />
              ))
            )}

            {done.length > 0 ? (
              <View style={styles.doneSection}>
                <Pressable onPress={() => setDoneExpanded((current) => !current)} style={styles.doneHeader}>
                  <ThemedText type="smallBold">Erledigt ({done.length})</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {doneExpanded ? 'einklappen' : 'anzeigen'}
                  </ThemedText>
                </Pressable>
                {doneExpanded
                  ? done.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        target={s.relative_id ? relativesById.get(s.relative_id) : undefined}
                        photoUrl={s.photo_key ? photoUrls.get(s.photo_key) : undefined}
                        busy={busyId === s.id}
                        editLoading={false}
                        onAccept={() => handleAccept(s)}
                        onEditAndAccept={() => handleEditAndAccept(s)}
                        onReject={() => handleReject(s)}
                        onOpenFullscreen={setFullscreenUrl}
                      />
                    ))
                  : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>

      {fullscreenUrl ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFullscreenUrl(null)}>
          <Pressable style={styles.fullscreenBackdrop} onPress={() => setFullscreenUrl(null)}>
            <Image source={{ uri: fullscreenUrl }} style={styles.fullscreenImage} contentFit="contain" />
          </Pressable>
        </Modal>
      ) : null}

      {cropSession ? (
        <PortraitCropper
          imageUri={cropSession.photo.uri}
          imageWidth={cropSession.photo.width}
          imageHeight={cropSession.photo.height}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
        />
      ) : null}
    </ThemedView>
  );
}

function SuggestionCard({
  suggestion,
  target,
  photoUrl,
  busy,
  editLoading,
  onAccept,
  onEditAndAccept,
  onReject,
  onOpenFullscreen,
}: {
  suggestion: TreeSuggestionRow;
  /** The relatives row this 'edit' suggestion targets — undefined for 'add'/'note', or if the target was deleted since. */
  target: RelativeRow | undefined;
  /** Signed display URL for `suggestion.photo_key` — undefined while still signing, or if signing failed. */
  photoUrl: string | undefined;
  busy: boolean;
  /** True while this card's "Bearbeiten und übernehmen" is downloading the guest photo for cropping. */
  editLoading: boolean;
  onAccept: () => void;
  onEditAndAccept: () => void;
  onReject: () => void;
  onOpenFullscreen: (url: string) => void;
}) {
  const { dangerText, accent } = useUiColors();
  const decided = suggestion.status !== 'open';
  const visitorName = suggestion.visitor_name?.trim()
    ? truncateGuestText(suggestion.visitor_name)
    : 'Unbekannter Gast';
  const tz = deviceTimeZone();
  const when = `${formatDayLabel(toLocalDate(suggestion.created_at, tz))} · ${formatTimeLabel(suggestion.created_at, tz)}`;

  const hasPhoto = !!suggestion.photo_key;
  const [photoState, setPhotoState] = useState<'loading' | 'loaded' | 'error'>('loading');
  // Ohne sichtbares Bild kein "Übernehmen" — Task 1: "Wer fremdes Material
  // freigibt, das er nicht gesehen hat, kann es nicht prüfen."
  const photoReady = !hasPhoto || photoState === 'loaded';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <ThemedText type="smallBold">{visitorName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {describeSuggestionKind(suggestion.kind)}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {when}
      </ThemedText>

      <ThemedText style={styles.summary}>{describeSuggestion(suggestion)}</ThemedText>

      {suggestion.kind === 'add' ? <FieldList entries={addedFields(suggestion).map((f) => [f.feld, f.wert])} /> : null}

      {suggestion.kind === 'edit' ? (
        target ? (
          <>
            <ThemedText type="small">Betrifft: {displayName(target)}</ThemedText>
            <FieldList
              entries={changedFields(suggestion, target).map((f) => [f.feld, `bisher ${f.bisher} → vorgeschlagen ${f.vorgeschlagen}`])}
            />
          </>
        ) : (
          <ThemedText type="small" themeColor="dangerText">
            Die betroffene Person wurde inzwischen gelöscht.
          </ThemedText>
        )
      ) : null}

      {hasPhoto ? (
        <View style={styles.photoRow}>
          <Pressable onPress={() => photoUrl && onOpenFullscreen(photoUrl)} disabled={!photoUrl}>
            <View style={[styles.photoThumbWrapper, { borderColor: accent }]}>
              {photoUrl ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={styles.photoThumb}
                  contentFit="cover"
                  onLoad={() => setPhotoState('loaded')}
                  onError={() => setPhotoState('error')}
                />
              ) : (
                <ActivityIndicator style={styles.photoThumb} />
              )}
            </View>
          </Pressable>
          <View style={styles.photoCaption}>
            <ThemedText type="small" themeColor="textSecondary">
              Foto von einem Gast
              {typeof suggestion.photo_bytes === 'number' ? ` · ${formatSuggestionPhotoSizeMb(suggestion.photo_bytes)}` : ''}
            </ThemedText>
            {photoState === 'error' ? (
              <ThemedText type="small" themeColor="dangerText">
                Bild konnte nicht angezeigt werden.
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}

      {decided ? (
        <ThemedText type="small" themeColor={suggestion.status === 'accepted' ? undefined : 'dangerText'} style={suggestion.status === 'accepted' ? { color: accent } : undefined}>
          {suggestion.status === 'accepted' ? 'Übernommen' : 'Abgelehnt'}
        </ThemedText>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable onPress={onAccept} hitSlop={8} disabled={busy || !photoReady || (suggestion.kind === 'edit' && !target)}>
            <ThemedText type="linkPrimary" themeColor={!photoReady ? 'textSecondary' : undefined}>
              Übernehmen
            </ThemedText>
          </Pressable>
          {suggestion.kind !== 'note' ? (
            <Pressable
              onPress={onEditAndAccept}
              hitSlop={8}
              disabled={busy || editLoading || (suggestion.kind === 'edit' && !target)}>
              <ThemedText type="linkPrimary">{editLoading ? '…' : 'Bearbeiten und übernehmen'}</ThemedText>
            </Pressable>
          ) : null}
          <Pressable onPress={onReject} hitSlop={8} disabled={busy}>
            <ThemedText type="linkPrimary" style={{ color: dangerText }}>
              Ablehnen
            </ThemedText>
          </Pressable>
        </View>
      )}
    </ThemedView>
  );
}

/** Plain "Label: Wert" rows — used for both the 'add' field list and the 'edit' diff, whose lines already come pre-formatted from suggestions.ts. */
function FieldList({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <View style={styles.fieldList}>
      {entries.map(([label, value]) => (
        <ThemedText key={label} type="small" themeColor="textSecondary">
          {label}: {value}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerSpacer: { width: 48 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  spinner: { marginTop: Spacing.five },
  card: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summary: { paddingTop: Spacing.one },
  fieldList: { gap: 2, paddingTop: Spacing.one },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.one },
  photoThumbWrapper: {
    width: 72,
    height: 72,
    borderRadius: Spacing.two,
    borderWidth: 2,
    overflow: 'hidden',
  },
  photoThumb: { width: '100%', height: '100%' },
  photoCaption: { flex: 1, gap: 2 },
  actionsRow: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap', paddingTop: Spacing.two },
  doneSection: { gap: Spacing.two, marginTop: Spacing.two },
  doneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fullscreenBackdrop: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: { width: '100%', height: '100%' },
});
