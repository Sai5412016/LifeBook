/**
 * Person bearbeiten — dieselbe Form-UI wie beim Anlegen (siehe ../neu.tsx),
 * vorausgefüllt, plus "Person löschen" (weiches Löschen mit Rückfrage, wie
 * überall sonst im Projekt — vgl. Fotochronik).
 *
 * 2026-08-17: Dieser Bildschirm hielt `<PersonForm>` zurück, bis `person`
 * geladen war — eine eigene Warteschranke, die dasselbe Problem löste wie
 * `useHydrateOnce` in kind/bearbeiten.tsx, nur anders. Zwei Verfahren für
 * einen Fehler sind eines zu viel (Architekturregel 9), deshalb liegt das
 * Warten jetzt IM Formular: dieser Bildschirm reicht den Datensatz als
 * `mode={{ kind: 'edit', record }}` durch und setzt `record` auf `null`,
 * solange eine der beiden Quellen (`person` ODER `child` — letzteres nur
 * für die Zeitzone von "Von"/"Bis") noch lädt. Genau dieses `child`
 * fehlte in der alten Schranke: kam es später an als `person`, standen
 * Von/Bis dauerhaft leer, obwohl Werte vorhanden waren.
 */

import { usePowerSync } from '@powersync/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { combineLocalDateAndTime, toLocalDate } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import {
  PersonForm,
  type PersonFormRecord,
  type PersonFormSubmitInput,
} from '@/features/people/components/person-form';
import { uploadPersonPhoto } from '@/features/people/photo';
import { setPersonPhotoKey, softDeletePerson, updatePerson, usePersonById } from '@/features/people/repository';
import { removeStoredObjects } from '@/features/photos/storage';

export default function PersonEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const { child, isLoading: childLoading } = useActiveChild();
  const { person, isLoading: personLoading } = usePersonById(id);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: PersonFormSubmitInput) => {
    if (!person || !child) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const metFromUtcIso =
        input.metFrom.length > 0 ? combineLocalDateAndTime(input.metFrom, '00:00', child.birthTz) : null;
      const metToUtcIso =
        input.metTo.length > 0 ? combineLocalDateAndTime(input.metTo, '00:00', child.birthTz) : null;

      await updatePerson(db, person.id, {
        name: input.name,
        role: input.role,
        note: input.note,
        metFromUtcIso,
        metToUtcIso,
      });

      if (input.pickedPhotoUri) {
        try {
          const photoKey = await uploadPersonPhoto(child.householdId, person.id, input.pickedPhotoUri);
          await setPersonPhotoKey(db, person.id, photoKey);
        } catch (uploadError) {
          console.error('[LifeBook] Personenfoto-Upload fehlgeschlagen', uploadError);
        }
      }

      router.back();
    } catch (saveError) {
      console.error('[LifeBook] Person konnte nicht gespeichert werden', saveError);
      setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!person) {
      return;
    }
    Alert.alert('Person löschen?', `${person.name} wird aus der Übersicht entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await softDeletePerson(db, person.id);

            // Hartes Löschen der Bilddatei ist Best-Effort, wie bei den
            // Fotos: schlägt es fehl, ist das weiche Löschen in der
            // Datenbank trotzdem gültig.
            if (person.photo_key) {
              try {
                await removeStoredObjects(person.photo_key, null, null);
              } catch (removeError) {
                console.error('[LifeBook] Personenfoto konnte nicht entfernt werden', removeError);
              }
            }

            router.back();
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  // Echtes "gibt es nicht" (gelöscht, falsche id) — NICHT dasselbe wie
  // "lädt noch", das erledigt jetzt das Formular selbst über `record: null`.
  if (!personLoading && !person) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // `null`, solange EINE der beiden Quellen noch fehlt — `child` wird für
  // die Zeitzone von Von/Bis gebraucht, siehe Dateikopf.
  const record: PersonFormRecord | null =
    person && child
      ? {
          id: person.id,
          values: {
            name: person.name,
            role: person.role,
            note: person.note ?? '',
            metFrom: person.met_from ? toLocalDate(person.met_from, child.birthTz) : '',
            metTo: person.met_to ? toLocalDate(person.met_to, child.birthTz) : '',
            photoKey: person.photo_key,
          },
        }
      : null;

  return (
    <PersonForm
      // Ausdrücklich "bearbeiten": `record` ist null, solange geladen wird —
      // das Formular sperrt sich so lange selbst (Architekturregel 9).
      mode={{ kind: 'edit', record }}
      headerTitle="Person bearbeiten"
      submitLabel="Speichern"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleting={deleting}
    />
  );
}
