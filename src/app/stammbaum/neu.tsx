/**
 * Person zum Stammbaum hinzufügen — erreichbar über "Person hinzufügen" im
 * Stammbaum-Reiter, ODER über "Bearbeiten und übernehmen" auf einem
 * kind:'add'-Vorschlag (stammbaum/vorschlaege.tsx), dann mit `suggestionId`
 * in der Route und vorbefüllt aus dem Vorschlag. Die eigentliche Form-UI
 * lebt in features/tree/components/relative-form.tsx und wird von hier und
 * von [id]/bearbeiten.tsx geteilt — exakt das Muster von
 * src/app/menschen/neu.tsx und src/app/ereignisse/neu.tsx.
 */

import { usePowerSync } from '@powersync/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useActiveChild } from '@/features/household/repository';
import {
  RelativeForm,
  type RelativeFormRecord,
  type RelativeFormSubmitInput,
} from '@/features/tree/components/relative-form';
import { uploadRelativePhoto } from '@/features/tree/photo';
import {
  addRelative,
  markSuggestionAccepted,
  setRelativePhotoKey,
  useRelativesOfHousehold,
  useTreeSuggestionById,
} from '@/features/tree/repository';
import { useAuth } from '@/core/auth/session-store';

export default function NeueRelativeScreen() {
  const { suggestionId } = useLocalSearchParams<{ suggestionId?: string }>();
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relatives } = useRelativesOfHousehold(child?.householdId);
  const { suggestion, isLoading: suggestionLoading } = useTreeSuggestionById(suggestionId);

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

      // Aus einem Vorschlag entstanden ("Bearbeiten und übernehmen") — die
      // relatives-Zeile steht bereits (oben), jetzt erst den Vorschlag als
      // erledigt markieren (Fallstrick 12: Elternzeile vor Kindzeile).
      if (suggestionId) {
        await markSuggestionAccepted(db, suggestionId, session.user.id);
      }

      router.back();
    } catch (saveError) {
      console.error('[LifeBook] Person konnte nicht gespeichert werden', saveError);
      setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  // Echtes "gibt es nicht" für eine ungültige suggestionId — NICHT dasselbe
  // wie "lädt noch", das übernimmt das Formular selbst über `record: null`
  // (RelativeFormMode 'createFromSuggestion', Architekturregel 9).
  if (suggestionId && !suggestionLoading && !suggestion) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // Mutter/Vater aus dem Vorschlag werden nur übernommen, wenn diese Person
  // im Haushalt wirklich existiert — dieselbe Regel wie beim direkten
  // "Übernehmen" (repository.ts#acceptAddSuggestion), hier vor dem
  // Vorbefüllen angewendet, damit das Formular niemals eine erfundene ID
  // stumm mitspeichert, nur weil niemand das Mutter/Vater-Feld anfasst.
  const record: RelativeFormRecord | null = suggestion
    ? {
        id: suggestion.id,
        values: {
          givenName: suggestion.given_name ?? '',
          familyName: suggestion.family_name ?? '',
          birthName: suggestion.birth_name ?? '',
          gender: suggestion.gender,
          bornOn: suggestion.born_on ?? '',
          bornPlace: suggestion.born_place ?? '',
          deceased: suggestion.deceased === 1,
          diedOn: suggestion.died_on ?? '',
          diedPlace: suggestion.died_place ?? '',
          motherId: relatives.some((r) => r.id === suggestion.mother_id) ? suggestion.mother_id : null,
          fatherId: relatives.some((r) => r.id === suggestion.father_id) ? suggestion.father_id : null,
          partnerId: null,
          photoKey: null,
          note: '',
        },
      }
    : null;

  return (
    <RelativeForm
      mode={suggestionId ? { kind: 'createFromSuggestion', record } : { kind: 'create' }}
      candidates={relatives}
      headerTitle="Person hinzufügen"
      submitLabel="Hinzufügen"
      saving={saving}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}
