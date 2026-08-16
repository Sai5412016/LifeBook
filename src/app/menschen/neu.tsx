/**
 * Person hinzufügen — erreichbar über die "Menschen"-Reihe auf der
 * Startseite (Reiter 1). Die eigentliche Form-UI lebt in
 * features/people/components/person-form.tsx und wird von hier und von
 * [id]/bearbeiten.tsx geteilt; dieser Bildschirm entscheidet nur, was mit
 * dem Ergebnis passiert (anlegen statt ändern, kein Löschen-Button).
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '@/core/auth/session-store';
import { combineLocalDateAndTime } from '@/core/time';
import { useActiveChild } from '@/features/household/repository';
import { PersonForm, type PersonFormSubmitInput } from '@/features/people/components/person-form';
import { uploadPersonPhoto } from '@/features/people/photo';
import { addPerson, setPersonPhotoKey } from '@/features/people/repository';

export default function NeuePersonScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: PersonFormSubmitInput) => {
    if (!child || !session?.user.id) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // "Von"/"Bis" are edited as plain dates; midnight in the child's own
      // timezone is the only sensible wall-clock to attach — this screen
      // never asks for a time, only a day.
      const metFromUtcIso =
        input.metFrom.length > 0 ? combineLocalDateAndTime(input.metFrom, '00:00', child.birthTz) : null;
      const metToUtcIso =
        input.metTo.length > 0 ? combineLocalDateAndTime(input.metTo, '00:00', child.birthTz) : null;

      const personId = await addPerson(db, {
        householdId: child.householdId,
        childId: child.childId,
        userId: session.user.id,
        name: input.name,
        role: input.role,
        note: input.note,
        metFromUtcIso,
        metToUtcIso,
      });

      if (input.pickedPhotoUri) {
        try {
          const photoKey = await uploadPersonPhoto(child.householdId, personId, input.pickedPhotoUri);
          await setPersonPhotoKey(db, personId, photoKey);
        } catch (uploadError) {
          // The person itself is saved and useful without a photo — a failed
          // upload (e.g. offline) must not undo the rest of the save. The
          // photo can be added again later by editing this person.
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

  return (
    <PersonForm
      // Ausdrücklich "anlegen": es gibt nichts zu laden, das Formular ist
      // sofort benutzbar und startet leer (Architekturregel 9 / siehe
      // person-form.tsx' Dateikopf zum `mode`-Vertrag).
      mode={{ kind: 'create' }}
      headerTitle="Person hinzufügen"
      submitLabel="Hinzufügen"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}
