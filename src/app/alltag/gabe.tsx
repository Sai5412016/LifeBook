/**
 * Gabe bearbeiten / löschen — eigener Bildschirm (task 2026-10-09). Von ÜBERALL
 * erreichbar, wo eine Gabe angezeigt wird: Tagesverlauf im Alltag-Tab, Liste
 * unter "Mehr …", "Heute fällig" (✓), "Ändern" auf der Snackbar. Vorher gab es
 * das Formular nur als ausklappbares Panel weit unten auf `/alltag/mehr` — für
 * Andi auf dem Gerät nicht auffindbar ("lassen sich weder ändern noch löschen").
 *
 * Löschen ist ein Soft-Delete (`deleted_at`, nie hartes Löschen), vorher mit
 * Rückfrage "Gabe vom 9.10. um 09:12 wirklich löschen?"; danach geht der
 * Bildschirm zu und die Snackbar mit "Rückgängig" (components/gabe-undo-snackbar.tsx)
 * steht auf dem Bildschirm darunter.
 */

import { usePowerSync } from '@powersync/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useActiveChild } from '@/features/household/repository';
import { deviceTimeZone } from '@/core/time/device';
import { useDeleteUndoStore } from '@/features/medication/delete-undo';
import { MedicationFormPanel } from '@/features/medication/components/medication-form-panel';
import type { MedicationFormSubmitInput } from '@/features/medication/components/medication-form-panel';
import { favoritenAusVerlauf, formatDeleteGabeQuestion, formatGabeDeletedLabel } from '@/features/medication/logic';
import { gabeAendern, gabeLoeschen, useGabe, useGabenHistorie } from '@/features/medication/repository';
import { nowUtcIso } from '@/core/time';
import { KeyboardSafeScreen } from '@/ui';

export default function GabeScreen() {
  const db = usePowerSync();
  const router = useRouter();
  const tz = deviceTimeZone();
  const { child } = useActiveChild();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { gabe, isLoading } = useGabe(id);
  const historie = useGabenHistorie(child?.childId);
  const favorites = favoritenAusVerlauf(historie, nowUtcIso());
  const announce = useDeleteUndoStore((state) => state.announce);
  const [busy, setBusy] = useState(false);

  // A soft-deleted row (e.g. opened from a stale list) is treated as gone, never edited.
  const live = gabe && gabe.deleted_at === null ? gabe : null;

  const handleSubmit = useCallback(
    async (input: MedicationFormSubmitInput) => {
      if (!live) {
        return;
      }
      setBusy(true);
      try {
        await gabeAendern(db, live.id, input);
        router.back();
      } finally {
        setBusy(false);
      }
    },
    [db, live, router],
  );

  const handleDelete = useCallback(() => {
    if (!live) {
      return;
    }
    Alert.alert('Gabe löschen?', formatDeleteGabeQuestion(live.occurred_at, live.tz), [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await gabeLoeschen(db, live.id);
            announce(live.id, formatGabeDeletedLabel(live.name, live.occurred_at, live.tz));
            router.back();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [db, live, announce, router]);

  const gone = !isLoading && !live;

  return (
    <ThemedView style={styles.container}>
      <KeyboardSafeScreen contentContainerStyle={styles.content}>
        {gone ? (
          <ThemedView type="backgroundElement" style={styles.gone}>
            <ThemedText>Diese Gabe gibt es nicht mehr.</ThemedText>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ThemedText type="linkPrimary">Zurück</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <MedicationFormPanel
            mode={{ kind: 'edit', medication: live }}
            favorites={favorites}
            tz={tz}
            busy={busy}
            onSubmit={handleSubmit}
            onCancel={() => router.back()}
            onDelete={handleDelete}
          />
        )}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.five },
  gone: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
});
