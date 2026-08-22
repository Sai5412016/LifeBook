/**
 * Person im Stammbaum bearbeiten — dieselbe Form-UI wie beim Anlegen (siehe
 * ../neu.tsx), vorausgefüllt, plus "Person löschen" (weiches Löschen mit
 * Rückfrage) — exakt das Muster von src/app/menschen/[id]/bearbeiten.tsx
 * und src/app/ereignisse/[id]/bearbeiten.tsx: der Datensatz wird als
 * `mode={{ kind: 'edit', record }}` durchgereicht, `record` ist `null`,
 * solange geladen wird (Architekturregel 9).
 */

import { usePowerSync } from '@powersync/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useActiveChild } from '@/features/household/repository';
import {
  RelativeForm,
  type RelativeFormRecord,
  type RelativeFormSubmitInput,
} from '@/features/tree/components/relative-form';
import { uploadRelativePhoto } from '@/features/tree/photo';
import {
  setRelativePhotoKey,
  softDeleteRelative,
  updateRelative,
  useRelativeById,
  useRelativePartnerId,
  useRelativesOfHousehold,
} from '@/features/tree/repository';
import { useAuth } from '@/core/auth/session-store';

export default function StammbaumBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relative, isLoading: relativeLoading } = useRelativeById(id);
  const { partnerId, isLoading: partnerLoading } = useRelativePartnerId(id);
  const { relatives } = useRelativesOfHousehold(child?.householdId);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: RelativeFormSubmitInput) => {
    if (!relative || !session?.user.id) {
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await updateRelative(db, relative.id, session.user.id, {
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

      if (input.pickedPhotoUri && relative.household_id) {
        try {
          const photoKey = await uploadRelativePhoto(relative.household_id, relative.id, input.pickedPhotoUri);
          await setRelativePhotoKey(db, relative.id, photoKey);
        } catch (uploadError) {
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

  const handleDelete = () => {
    if (!relative) {
      return;
    }
    Alert.alert('Person löschen?', `${relative.given_name} wird aus dem Stammbaum entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await softDeleteRelative(db, relative.id);
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
  if (!relativeLoading && !relative) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // `null`, solange EINE der beiden Quellen noch fehlt — die Person selbst
  // und ihr aktueller Partner kommen aus getrennten Abfragen.
  const record: RelativeFormRecord | null =
    relative && !partnerLoading
      ? {
          id: relative.id,
          values: {
            givenName: relative.given_name,
            familyName: relative.family_name ?? '',
            birthName: relative.birth_name ?? '',
            gender: relative.gender,
            bornOn: relative.born_on ?? '',
            bornPlace: relative.born_place ?? '',
            deceased: Boolean(relative.deceased),
            diedOn: relative.died_on ?? '',
            diedPlace: relative.died_place ?? '',
            motherId: relative.mother_id,
            fatherId: relative.father_id,
            partnerId,
            photoKey: relative.photo_key,
            note: relative.note ?? '',
          },
        }
      : null;

  return (
    <RelativeForm
      mode={{ kind: 'edit', record }}
      candidates={relatives}
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
