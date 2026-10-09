/**
 * "Gelöscht: Vitamin D3 · 09:12 — Rückgängig" nach dem Löschen einer Gabe
 * (task 2026-10-09). Hängt EINMAL im Wurzel-Layout statt an jedem Bildschirm:
 * das Löschen passiert auf dem eigenen Bildschirm `/alltag/gabe`, der danach
 * sofort zugeht — die Snackbar muss auf dem Bildschirm darunter (Alltag-Tab
 * oder "Mehr …") ankommen, ohne dass jener davon wissen muss. Oben statt
 * unten, weil unten je nach Bildschirm die Reiterleiste oder die
 * Schnellleiste liegt.
 *
 * Gleiche Bauform und Dauer wie die Snackbar der Schnelleingabe
 * (schnelleingabe/components/schnell-leiste.tsx), nur ohne "Ändern".
 */

import { usePowerSync } from '@powersync/react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { useDeleteUndoStore } from '../delete-undo';
import { gabeWiederherstellen } from '../repository';

const SNACKBAR_MS = 6000;

export function GabeUndoSnackbar() {
  const db = usePowerSync();
  const insets = useSafeAreaInsets();
  const pending = useDeleteUndoStore((state) => state.pending);
  const clear = useDeleteUndoStore((state) => state.clear);

  useEffect(() => {
    if (!pending) {
      return;
    }
    const { token } = pending;
    const timer = setTimeout(() => clear(token), SNACKBAR_MS);
    return () => clearTimeout(timer);
  }, [pending, clear]);

  if (!pending) {
    return null;
  }

  const handleUndo = () => {
    clear(pending.token);
    void gabeWiederherstellen(db, pending.entryId);
  };

  return (
    <ThemedView type="backgroundElement" style={[styles.snackbar, { top: insets.top + Spacing.two }]}>
      <ThemedText type="small" style={styles.label} numberOfLines={1}>
        {pending.label}
      </ThemedText>
      <Pressable onPress={handleUndo} hitSlop={12} accessibilityRole="button">
        <ThemedText type="linkPrimary">Rückgängig</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 100,
    elevation: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  label: { flex: 1 },
});
