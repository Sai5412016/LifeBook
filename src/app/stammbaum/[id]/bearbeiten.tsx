/**
 * Person im Stammbaum bearbeiten — dieselbe Form-UI wie beim Anlegen (siehe
 * ../neu.tsx), vorausgefüllt, plus "Person löschen" (weiches Löschen mit
 * Rückfrage) — exakt das Muster von src/app/menschen/[id]/bearbeiten.tsx
 * und src/app/ereignisse/[id]/bearbeiten.tsx: der Datensatz wird als
 * `mode={{ kind: 'edit', record }}` durchgereicht, `record` ist `null`,
 * solange geladen wird (Architekturregel 9).
 *
 * Mit `suggestionId` in der Route ("Bearbeiten und übernehmen" auf einem
 * kind:'edit'-Vorschlag, stammbaum/vorschlaege.tsx) werden die vom Vorschlag
 * GESETZTEN Felder über die aktuellen Werte gelegt — nicht gesetzte Felder
 * bleiben unverändert die heutigen Werte der Person, deshalb genügt ein
 * einfaches Überschreiben statt einer eigenen Vorschlags-Form.
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
  type RelativeFormValues,
} from '@/features/tree/components/relative-form';
import { uploadRelativePhoto } from '@/features/tree/photo';
import {
  markSuggestionAccepted,
  setRelativePhotoKey,
  softDeleteRelative,
  updateRelative,
  useRelativeById,
  useRelativePartnerId,
  useRelativesOfHousehold,
  useTreeSuggestionById,
} from '@/features/tree/repository';
import { isSuggestionFieldSet, SUGGESTIBLE_RELATIVE_FIELDS } from '@/features/tree/suggestions';
import type { TreeSuggestionRow } from '@/features/tree/types';
import { useAuth } from '@/core/auth/session-store';
import { removeStoredObjects } from '@/core/storage/objects';

/**
 * Legt die vom Vorschlag GESETZTEN Felder über `values` — nicht gesetzte
 * Felder bleiben die heutigen Werte der Person. Derselbe Feldkatalog wie
 * suggestions.ts#changedFields (`SUGGESTIBLE_RELATIVE_FIELDS`), damit
 * vorbefüllte Werte hier und angezeigte Änderungen in vorschlaege.tsx nie
 * auseinanderlaufen.
 */
function applySuggestionOverrides(
  values: RelativeFormValues,
  suggestion: TreeSuggestionRow | undefined,
): RelativeFormValues {
  if (!suggestion) {
    return values;
  }
  const merged = { ...values };
  for (const field of SUGGESTIBLE_RELATIVE_FIELDS) {
    if (!isSuggestionFieldSet(suggestion, field)) {
      continue;
    }
    switch (field) {
      case 'given_name':
        merged.givenName = suggestion.given_name as string;
        break;
      case 'family_name':
        merged.familyName = suggestion.family_name as string;
        break;
      case 'birth_name':
        merged.birthName = suggestion.birth_name as string;
        break;
      case 'gender':
        merged.gender = suggestion.gender;
        break;
      case 'born_on':
        merged.bornOn = suggestion.born_on as string;
        break;
      case 'born_place':
        merged.bornPlace = suggestion.born_place as string;
        break;
      case 'deceased':
        merged.deceased = suggestion.deceased === 1;
        break;
      case 'died_on':
        merged.diedOn = suggestion.died_on as string;
        break;
      case 'died_place':
        merged.diedPlace = suggestion.died_place as string;
        break;
    }
  }
  return merged;
}

export default function StammbaumBearbeitenScreen() {
  const { id, suggestionId } = useLocalSearchParams<{ id: string; suggestionId?: string }>();
  const db = usePowerSync();
  const { session } = useAuth();
  const { child } = useActiveChild();
  const { relative, isLoading: relativeLoading } = useRelativeById(id);
  const { partnerId, isLoading: partnerLoading } = useRelativePartnerId(id);
  const { relatives } = useRelativesOfHousehold(child?.householdId);
  const { suggestion, isLoading: suggestionLoading } = useTreeSuggestionById(suggestionId);

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
          const previousPhotoKey = relative.photo_key;
          const photoKey = await uploadRelativePhoto(relative.household_id, relative.id, input.pickedPhotoUri);
          await setRelativePhotoKey(db, relative.id, photoKey);

          // Jede Portrait-Aufnahme bekommt einen frischen Speicherschlüssel
          // (identity.ts#buildRelativePhotoKey) — das alte Objekt räumt
          // niemand sonst auf, sonst bliebe es als Waise liegen. Best
          // effort, wie das Löschen eines Menschen-Portraits schon: ein
          // Fehler hier darf den bereits gespeicherten neuen Schlüssel
          // nicht rückgängig machen.
          if (previousPhotoKey) {
            try {
              await removeStoredObjects(previousPhotoKey, null, null);
            } catch (cleanupError) {
              console.error('[LifeBook] Altes Portrait konnte nicht aufgeräumt werden', cleanupError);
            }
          }
        } catch (uploadError) {
          console.error('[LifeBook] Portrait-Upload fehlgeschlagen', uploadError);
        }
      }

      // Aus einem Vorschlag entstanden ("Bearbeiten und übernehmen") — die
      // relatives-Zeile ist bereits geschrieben (oben), jetzt erst den
      // Vorschlag als erledigt markieren (Fallstrick 12).
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

  // Echtes "gibt es nicht" (gelöscht, falsche id, oder eine suggestionId,
  // die zu keinem Vorschlag mehr passt) — NICHT dasselbe wie "lädt noch",
  // das erledigt das Formular selbst über `record: null`.
  if ((!relativeLoading && !relative) || (suggestionId && !suggestionLoading && !suggestion)) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // `null`, solange EINE der Quellen noch fehlt — die Person selbst, ihr
  // aktueller Partner und (falls per suggestionId angefordert) der
  // Vorschlag kommen aus getrennten Abfragen.
  const suggestionReady = !suggestionId || suggestion !== undefined;
  const record: RelativeFormRecord | null =
    relative && !partnerLoading && suggestionReady
      ? {
          id: relative.id,
          values: applySuggestionOverrides(
            {
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
            suggestion,
          ),
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
