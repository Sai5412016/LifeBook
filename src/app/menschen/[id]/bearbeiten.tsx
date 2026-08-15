/**
 * Person bearbeiten — dieselbe Form-UI wie beim Anlegen (siehe ../neu.tsx),
 * vorausgefüllt, plus "Person löschen" (weiches Löschen mit Rückfrage, wie
 * überall sonst im Projekt — vgl. Fotochronik).
 *
 * 2026-08-17: `<PersonForm>` wird erst gemountet, wenn `person` fertig
 * geladen ist (siehe unten) — genau das schützt Name/Rolle/Notiz/Foto
 * bereits vor dem "Kind bearbeiten"-Fehler (useState mit einem noch nicht
 * angekommenen Wert). "Von"/"Bis" brauchten aber ZUSÄTZLICH `child` (für
 * dessen Zeitzone), und die alte Bedingung wartete nur auf `person`, nicht
 * auch auf `child` — kam `child` später an als `person`, mountete das
 * Formular mit leeren Von/Bis-Feldern trotz vorhandener Werte, für immer.
 * Behoben, indem die Ladebedingung unten `child`/dessen eigenes
 * `isLoading` mit einschließt — derselbe Grundsatz wie in
 * kind/bearbeiten.tsx (erst rendern/befüllen, wenn ALLE benötigten Daten
 * da sind), hier über die schon vorhandene "noch nicht mounten"-Schranke
 * statt über useHydrateOnce, weil die bereits korrekt für `person` sorgt.
 */

import { usePowerSync } from '@powersync/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { combineLocalDateAndTime, toLocalDate } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { PersonForm, type PersonFormSubmitInput } from '@/features/people/components/person-form';
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

  // Wartet auf BEIDE Quellen, nicht nur auf `person` — siehe Dateikopf.
  if (personLoading || childLoading) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!person || !child) {
    return null;
  }

  return (
    <PersonForm
      headerTitle="Person bearbeiten"
      submitLabel="Speichern"
      saving={saving}
      error={error}
      initialName={person.name}
      initialRole={person.role}
      initialNote={person.note ?? ''}
      initialMetFrom={person.met_from ? toLocalDate(person.met_from, child.birthTz) : ''}
      initialMetTo={person.met_to ? toLocalDate(person.met_to, child.birthTz) : ''}
      existingPhotoKey={person.photo_key}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleting={deleting}
    />
  );
}
