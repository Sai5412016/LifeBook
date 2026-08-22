/**
 * Ereignis hinzufügen — erreichbar über "Ereignis hinzufügen" im
 * Ereignisse-Reiter. Die eigentliche Form-UI lebt in
 * features/events/components/event-form.tsx und wird von hier und von
 * [id]/bearbeiten.tsx geteilt; dieser Bildschirm entscheidet nur, was mit
 * dem Ergebnis passiert (anlegen statt ändern, kein Löschen-Button) — exakt
 * das Muster von src/app/menschen/neu.tsx.
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '@/core/auth/session-store';
import { deviceTimeZone } from '@/core/time/device';
import { EventForm, type EventFormSubmitInput } from '@/features/events/components/event-form';
import { addEvent } from '@/features/events/repository';
import { useActiveChild } from '@/features/household/repository';

export default function NeuesEreignisScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: EventFormSubmitInput) => {
    if (!child || !session?.user.id) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await addEvent(db, {
        householdId: child.householdId,
        childId: child.childId,
        userId: session.user.id,
        title: input.title,
        note: input.note,
        localDate: input.localDate,
        time: input.time,
        tz: deviceTimeZone(),
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

  return (
    <EventForm
      // Ausdrücklich "anlegen": es gibt nichts zu laden, das Formular ist
      // sofort benutzbar (Architekturregel 9 / siehe event-form.tsx' Dateikopf).
      mode={{ kind: 'create' }}
      childId={child?.childId}
      headerTitle="Ereignis hinzufügen"
      submitLabel="Hinzufügen"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}
