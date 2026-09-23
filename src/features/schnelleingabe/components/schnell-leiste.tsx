/**
 * schnelleingabe/components/schnell-leiste — die Schnelleingabe-Leiste (task
 * 2026-09-23): ein Tipp genügt für einen Eintrag, mit den zuletzt benutzten
 * Werten als Vorgabe, danach korrigierbar. Jeder Tipp ruft nur
 * ../repository.ts auf, die ihrerseits an die jeweils zuständige Funktion
 * der EIGENEN Repository-Datei des Features weitergibt (Füttern, Wickeln,
 * Medikamente) — diese Datei schreibt selbst nichts in die Datenbank.
 *
 * Dieselbe Komponente wird an zwei Stellen eingebunden: als klebende Leiste
 * im Alltag-Tab (app/(tabs)/alltag.tsx) und als Karte im ersten Tab
 * (app/(tabs)/index.tsx, ohne Tageswahl — dort immer "heute"). `onRequestEdit`
 * unterscheidet die beiden: im Alltag-Tab hebt es lokal einen State an, vom
 * ersten Tab aus navigiert es zum Alltag-Tab mit Parametern.
 */

import { usePowerSync } from '@powersync/react-native';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatTimeLabel, nowUtcIso } from '@/core/time';
import { formatBackfillHint } from '@/core/tracking/day-selection';
import { softDeleteDiaper } from '@/features/diaper/repository';
import type { DiaperKind } from '@/features/diaper/types';
import { softDeleteFeed, useRecentFeedsForChild } from '@/features/feeding/repository';
import type { ActiveChild } from '@/features/household/repository';
import { favoritenAusVerlauf } from '@/features/medication/logic';
import type { MedicationFavorite } from '@/features/medication/logic';
import { gabeLoeschen, useGabenHistorie } from '@/features/medication/repository';
import { useUiColors, withAlpha } from '@/ui';

import { formatSnackbarLabel, isDoubleTap } from '../logic';
import { schnellBrust, schnellFlasche, schnellMedikament, schnellWindel } from '../repository';
import type { SchnellContext } from '../repository';

export type SchnellEditKind = 'bottle' | 'breast' | 'diaper' | 'medication';

export type SchnellLeisteProps = {
  child: ActiveChild | null;
  session: Session | null;
  tz: string;
  /** Der Alltag-Tageswahl gewählter Tag — im ersten Tab immer "heute" (kein Tageswahl dort). */
  selectedLocalDate: string;
  todayLocalDate: string;
  /** "Ändern" auf der Snackbar — öffnet das zuständige Formular für genau diesen Eintrag. */
  onRequestEdit: (kind: SchnellEditKind, id: string) => void;
};

type Snackbar = { entryId: string; kind: SchnellEditKind; label: string };

const SNACKBAR_MS = 6000;

export function SchnellLeiste({
  child,
  session,
  tz,
  selectedLocalDate,
  todayLocalDate,
  onRequestEdit,
}: SchnellLeisteProps) {
  const db = usePowerSync();
  const { accent, amber, green } = useUiColors();
  // Ein Farbton je KATEGORIE, Abstufung innerhalb der Kategorie (Gerätetest
  // 2026-09-24, Befund E): vorher trug Farbe für sich genommen die falsche
  // Bedeutung (gleiche Kategorie in zwei Farben, verschiedene Kategorien in
  // derselben). Mahlzeiten = accent (kräftig: Flasche, gedämpft: Brust),
  // Windeln = amber (kräftig: nass, gedämpft: Stuhl), Medizin = green als
  // eigene dritte Farbe — alle drei bereits Teil der Palette
  // (constants/themes/oktopus.ts), keine neue erfunden. `withAlpha` blendet
  // denselben Farbton nur ab, statt einen zweiten zu erfinden. Symbol und
  // Beschriftung bleiben das zweite, farbunabhängige Unterscheidungsmerkmal.
  const mealColor = accent;
  const mealColorMuted = withAlpha(accent, 0.6);
  const diaperColor = amber;
  const diaperColorMuted = withAlpha(amber, 0.6);
  const medicationColor = green;
  const recentFeeds = useRecentFeedsForChild(child?.childId);
  const gabenHistorie = useGabenHistorie(child?.childId);
  const favorites = favoritenAusVerlauf(gabenHistorie, nowUtcIso());

  const [snackbar, setSnackbar] = useState<Snackbar | null>(null);
  const [medSheetOpen, setMedSheetOpen] = useState(false);
  const snackbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pro Schaltfläche der letzte AKZEPTIERTE Tipp — der Doppel-Tipp-Schutz
  // (task requirement: 2 Sekunden) ist strenger als das übliche "busy"-Sperren
  // während eines laufenden Schreibvorgangs: ein lokaler PowerSync-Schreib-
  // vorgang kann in wenigen Millisekunden fertig sein, lange bevor 2 Sekunden
  // vergangen sind.
  const lastTapRef = useRef<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (snackbarTimeoutRef.current) {
        clearTimeout(snackbarTimeoutRef.current);
      }
    };
  }, []);

  const showSnackbar = useCallback((entry: Snackbar) => {
    if (snackbarTimeoutRef.current) {
      clearTimeout(snackbarTimeoutRef.current);
    }
    setSnackbar(entry);
    snackbarTimeoutRef.current = setTimeout(() => setSnackbar(null), SNACKBAR_MS);
  }, []);

  const guardedTap = useCallback((key: string, action: () => Promise<void>) => {
    const now = nowUtcIso();
    if (isDoubleTap(lastTapRef.current[key] ?? null, now)) {
      return;
    }
    lastTapRef.current[key] = now;
    void action();
  }, []);

  const isViewingToday = selectedLocalDate === todayLocalDate;
  const context: SchnellContext | null =
    child && session?.user.id
      ? {
          householdId: child.householdId,
          childId: child.childId,
          userId: session.user.id,
          tz,
          selectedLocalDate,
          todayLocalDate,
        }
      : null;

  const handleFlasche = useCallback(() => {
    if (!context) return;
    guardedTap('bottle', async () => {
      const result = await schnellFlasche(db, context, recentFeeds);
      const timeLabel = formatTimeLabel(result.occurredAtUtcIso, tz);
      showSnackbar({
        entryId: result.id,
        kind: 'bottle',
        label: formatSnackbarLabel('Flasche', result.amountMl, timeLabel),
      });
    });
  }, [context, db, recentFeeds, tz, guardedTap, showSnackbar]);

  const handleBrust = useCallback(() => {
    if (!context) return;
    guardedTap('breast', async () => {
      const result = await schnellBrust(db, context, recentFeeds);
      const timeLabel = formatTimeLabel(result.occurredAtUtcIso, tz);
      showSnackbar({ entryId: result.id, kind: 'breast', label: formatSnackbarLabel('Brust', null, timeLabel) });
    });
  }, [context, db, recentFeeds, tz, guardedTap, showSnackbar]);

  const handleWindel = useCallback(
    (kind: DiaperKind) => {
      if (!context) return;
      guardedTap(`diaper_${kind}`, async () => {
        const result = await schnellWindel(db, context, kind);
        const timeLabel = formatTimeLabel(result.occurredAtUtcIso, tz);
        const kindLabel = kind === 'wet' ? 'Windel nass' : 'Windel Stuhl';
        showSnackbar({ entryId: result.id, kind: 'diaper', label: formatSnackbarLabel(kindLabel, null, timeLabel) });
      });
    },
    [context, db, tz, guardedTap, showSnackbar],
  );

  const handleMedikament = useCallback(
    (favorite: MedicationFavorite) => {
      if (!context) return;
      guardedTap(`medication:${favorite.name.trim().toLowerCase()}`, async () => {
        const result = await schnellMedikament(db, context, favorite);
        if (!result) return;
        setMedSheetOpen(false);
        const timeLabel = formatTimeLabel(result.occurredAtUtcIso, tz);
        showSnackbar({
          entryId: result.id,
          kind: 'medication',
          label: formatSnackbarLabel(result.name, null, timeLabel),
        });
      });
    },
    [context, db, tz, guardedTap, showSnackbar],
  );

  const handleUndo = useCallback(() => {
    if (!snackbar) return;
    const { entryId, kind } = snackbar;
    setSnackbar(null);
    if (kind === 'bottle' || kind === 'breast') {
      void softDeleteFeed(db, entryId);
    } else if (kind === 'diaper') {
      void softDeleteDiaper(db, entryId);
    } else {
      void gabeLoeschen(db, entryId);
    }
  }, [snackbar, db]);

  const handleAendern = useCallback(() => {
    if (!snackbar) return;
    const { entryId, kind } = snackbar;
    setSnackbar(null);
    onRequestEdit(kind, entryId);
  }, [snackbar, onRequestEdit]);

  const disabled = !context;

  return (
    <View pointerEvents="box-none">
      {!isViewingToday ? (
        <ThemedView type="backgroundElement" style={styles.hint}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatBackfillHint(selectedLocalDate)}
          </ThemedText>
        </ThemedView>
      ) : null}

      {snackbar ? (
        <ThemedView type="backgroundElement" style={styles.snackbar}>
          <ThemedText type="small" style={styles.snackbarLabel} numberOfLines={1}>
            {snackbar.label}
          </ThemedText>
          <Pressable onPress={handleAendern} hitSlop={8}>
            <ThemedText type="linkPrimary">Ändern</ThemedText>
          </Pressable>
          <Pressable onPress={handleUndo} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Rückgängig
            </ThemedText>
          </Pressable>
        </ThemedView>
      ) : null}

      {medSheetOpen ? (
        <MedicationSheet
          favorites={favorites}
          accent={accent}
          onPick={handleMedikament}
          onClose={() => setMedSheetOpen(false)}
        />
      ) : null}

      <View style={styles.row}>
        <SchnellButton icon="🍼" label="Flasche" color={mealColor} onPress={handleFlasche} disabled={disabled} />
        <SchnellButton icon="🤱" label="Brust" color={mealColorMuted} onPress={handleBrust} disabled={disabled} />
        <SchnellButton
          icon="💧"
          label="Windel nass"
          color={diaperColor}
          onPress={() => handleWindel('wet')}
          disabled={disabled}
        />
        <SchnellButton
          icon="💩"
          label="Windel Stuhl"
          color={diaperColorMuted}
          onPress={() => handleWindel('dirty')}
          disabled={disabled}
        />
        <SchnellButton
          icon="💊"
          label="Medizin"
          color={medicationColor}
          onPress={() => setMedSheetOpen(true)}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

function SchnellButton({
  icon,
  label,
  color,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: color },
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <ThemedText style={styles.buttonIcon}>{icon}</ThemedText>
      {/* Gerätetest 2026-09-24, Befund C: "Medikament" brach mitten im Wort
          um ("Medikamen / t") — numberOfLines allein verhindert das nicht
          (kein Leerzeichen zum Umbrechen). adjustsFontSizeToFit schrumpft die
          Schrift stattdessen so weit, bis das ganze Wort passt. */}
      <ThemedText
        style={styles.buttonLabel}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Von Hand gebautes Sheet-Ersatzstück — kein neues Paket (task-Randbedingung:
 * Fingerprint muss identisch bleiben), und kein `position: 'absolute'`
 * Vollbild-Hintergrund (der bräuchte einen sicher positionierten Vorfahren
 * über der ganzen Seite, den es hier nicht gibt). Stattdessen ein einfaches
 * INLINE-Panel direkt über der Leiste, exakt dieselbe Bauform wie jedes
 * andere Korrektur-Panel in dieser App (z. B. DiaperDetailsPrompt,
 * MedicationFormPanel) — "Schließen" statt Antippen außerhalb.
 */
function MedicationSheet({
  favorites,
  accent,
  onPick,
  onClose,
}: {
  favorites: readonly MedicationFavorite[];
  accent: string;
  onPick: (favorite: MedicationFavorite) => void;
  onClose: () => void;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <ThemedText type="smallBold">Medikament</ThemedText>
        <Pressable onPress={onClose} hitSlop={8}>
          <ThemedText type="link" themeColor="textSecondary">
            Schließen
          </ThemedText>
        </Pressable>
      </View>
      {favorites.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Noch keine Favoriten. Im Alltag-Tab unter „Medikamente & Vitamine“ einmal eine Gabe eintragen — von da an
          steht sie auch hier zur Auswahl.
        </ThemedText>
      ) : (
        <ScrollView style={styles.sheetList}>
          {favorites.map((favorite) => (
            <Pressable
              key={`${favorite.name.toLowerCase()}|${favorite.doseAmount ?? ''}|${favorite.doseUnit ?? ''}`}
              onPress={() => onPick(favorite)}
              style={[styles.sheetItem, { borderColor: accent }]}>
              <ThemedText type="smallBold">{favorite.name}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  hint: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  snackbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  snackbarLabel: { flex: 1 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  button: {
    minHeight: 60,
    minWidth: 60,
    flexGrow: 1,
    flexBasis: '18%',
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.half,
    gap: 2,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonIcon: { fontSize: 22, lineHeight: 26 },
  buttonLabel: { fontSize: 11, fontWeight: '700', color: '#ffffff', textAlign: 'center' },
  sheet: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    maxHeight: 320,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetList: { gap: Spacing.two },
  sheetItem: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    marginBottom: Spacing.one,
  },
});
