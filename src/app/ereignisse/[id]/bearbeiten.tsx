/**
 * Ereignis bearbeiten — dieselbe Form-UI wie beim Anlegen (siehe ../neu.tsx),
 * vorausgefüllt, plus "Ereignis löschen" (weiches Löschen mit Rückfrage,
 * wie überall sonst im Projekt) — exakt das Muster von
 * src/app/menschen/[id]/bearbeiten.tsx: der Datensatz wird als
 * `mode={{ kind: 'edit', record }}` durchgereicht, `record` ist `null`,
 * solange geladen wird, das Formular sperrt sich so lange selbst
 * (Architekturregel 9).
 */

import { usePowerSync } from '@powersync/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { formatTimeLabel } from '@/core/time';
import { EventForm, type EventFormRecord, type EventFormSubmitInput } from '@/features/events/components/event-form';
import { softDeleteEvent, updateEvent, useEventById, useEventPhotos } from '@/features/events/repository';
import { useActiveChild } from '@/features/household/repository';

export default function EreignisBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const { child } = useActiveChild();
  const { event, isLoading: eventLoading } = useEventById(id);
  const { photoIds, isLoading: photosLoading } = useEventPhotos(id);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: EventFormSubmitInput) => {
    if (!event) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await updateEvent(db, event.id, {
        title: input.title,
        note: input.note,
        localDate: input.localDate,
        time: input.time,
        photoIds: input.photoIds,
      });
      router.back();
    } catch (saveError) {
      console.error('[LifeBook] Ereignis konnte nicht gespeichert werden', saveError);
      setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!event) {
      return;
    }
    Alert.alert('Ereignis löschen?', `„${event.title}" wird aus der Übersicht entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await softDeleteEvent(db, event.id);
            router.back();
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  // Echtes "gibt es nicht" (gelöscht, falsche id) — NICHT dasselbe wie
  // "lädt noch", das erledigt das Formular selbst über `record: null`.
  if (!eventLoading && !event) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // `null`, solange EINE der beiden Quellen noch fehlt — Ereignis selbst
  // und seine Fotoauswahl kommen aus getrennten Abfragen.
  const record: EventFormRecord | null =
    event && !photosLoading
      ? {
          id: event.id,
          values: {
            title: event.title,
            note: event.note ?? '',
            localDate: event.local_date,
            time: formatTimeLabel(event.occurred_at, event.tz),
            photoIds,
          },
        }
      : null;

  return (
    <EventForm
      mode={{ kind: 'edit', record }}
      childId={child?.childId}
      headerTitle="Ereignis bearbeiten"
      submitLabel="Speichern"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleting={deleting}
    />
  );
}
