/**
 * Person zum Stammbaum hinzufügen — erreichbar über "Person hinzufügen" im
 * Stammbaum-Reiter. Die eigentliche Form-UI lebt in
 * features/tree/components/relative-form.tsx und wird von hier und von
 * [id]/bearbeiten.tsx geteilt — exakt das Muster von src/app/menschen/neu.tsx
 * und src/app/ereignisse/neu.tsx.
 */

import { usePowerSync } from '@powersync/react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import { useActiveChild } from '@/features/household/repository';
import { RelativeForm, type RelativeFormSubmitInput } from '@/features/tree/components/relative-form';
import { uploadRelativePhoto } from '@/features/tree/photo';
import { addRelative, setRelativePhotoKey, useRelativesOfHousehold } from '@/features/tree/repository';
import { useAuth } from '@/core/auth/session-store';

export default function NeueRelativeScreen() {
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relatives } = useRelativesOfHousehold(child?.householdId);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: RelativeFormSubmitInput) => {
    if (!child || !session?.user.id) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const relativeId = await addRelative(db, {
        householdId: child.householdId,
        userId: session.user.id,
        givenName: input.givenName,
        familyName: input.familyName,
        birthName: input.birthName,
        gender: input.gender,
        bornOn: input.bornOn,
        bornPlace: input.bornPlace,
        deceased: input.deceased,
        diedOn: input.diedOn,
        diedPlace: input.diedPlace,
        motherId: input.motherId,
        fatherId: input.fatherId,
        partnerId: input.partnerId,
        note: input.note,
      });

      if (input.pickedPhotoUri) {
        try {
          const photoKey = await uploadRelativePhoto(child.householdId, relativeId, input.pickedPhotoUri);
          await setRelativePhotoKey(db, relativeId, photoKey);
        } catch (uploadError) {
          // The person itself is saved and useful without a photo — a failed
          // upload (e.g. offline) must not undo the rest of the save.
          console.error('[LifeBook] Portrait-Upload fehlgeschlagen', uploadError);
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
    <RelativeForm
      mode={{ kind: 'create' }}
      candidates={relatives}
      headerTitle="Person hinzufügen"
      submitLabel="Hinzufügen"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}
