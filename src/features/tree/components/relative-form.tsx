/**
 * Shared add/edit form for a relative — used by both src/app/stammbaum/neu.tsx
 * and src/app/stammbaum/[id]/bearbeiten.tsx, mirroring
 * features/people/components/person-form.tsx's and
 * features/events/components/event-form.tsx's shape exactly: a `mode`
 * union instead of optional initial values (Architekturregel 9), plus
 * `useHydrateOnce` and "Speichern" locked until the record has loaded.
 *
 * Mutter/Vater/Partner are picked from the household's OTHER relatives —
 * never the person being edited themselves (task requirement, see
 * `logic.ts#excludeSelf`, applied once here rather than at every one of
 * the three picker call sites).
 */

import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSignedUrls } from '@/features/photos/hooks';
import { PersonAvatar } from '@/features/people/components/person-avatar';
import { Chip, KeyboardSafeScreen, TextField, useHydrateOnce, useUiColors } from '@/ui';

import { GENDER_OPTIONS, displayName, excludeSelf } from '../logic';
import { RelativePhotoPickCancelledError, pickRelativePhotoUri } from '../photo';
import type { RelativeGender, RelativeRow } from '../types';

export type RelativeFormSubmitInput = {
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: RelativeGender | null;
  bornOn: string | null;
  bornPlace: string | null;
  deceased: boolean;
  diedOn: string | null;
  diedPlace: string | null;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  note: string | null;
  /** Freshly picked, not-yet-uploaded local file — null = keep the existing/no photo. */
  pickedPhotoUri: string | null;
};

/** The already-localised values of an existing relative, as this form shows them. */
export type RelativeFormValues = {
  givenName: string;
  familyName: string;
  birthName: string;
  gender: RelativeGender | null;
  bornOn: string;
  bornPlace: string;
  deceased: boolean;
  diedOn: string;
  diedPlace: string;
  motherId: string | null;
  fatherId: string | null;
  partnerId: string | null;
  photoKey: string | null;
  note: string;
};

/** The record being edited, once it has actually loaded. */
export type RelativeFormRecord = {
  /** Identity for `useHydrateOnce` — seeding re-runs if this ever points at a different relative. */
  id: string;
  values: RelativeFormValues;
};

/** Which of the two jobs this form is doing — see the file header. */
export type RelativeFormMode =
  | { kind: 'create' }
  | { kind: 'edit'; record: RelativeFormRecord | null };

export type RelativeFormProps = {
  mode: RelativeFormMode;
  /** Every other relative of the household, for the Mutter/Vater/Partner pickers — the person being edited is filtered out internally. */
  candidates: RelativeRow[];
  headerTitle: string;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (input: RelativeFormSubmitInput) => void;
  onDelete?: () => void;
  deleting?: boolean;
};

export function RelativeForm({
  mode,
  candidates,
  headerTitle,
  submitLabel,
  saving,
  error,
  onSubmit,
  onDelete,
  deleting = false,
}: RelativeFormProps) {
  const { dangerText } = useUiColors();

  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [birthName, setBirthName] = useState('');
  const [gender, setGender] = useState<RelativeGender | null>(null);
  const [bornOn, setBornOn] = useState('');
  const [bornPlace, setBornPlace] = useState('');
  const [deceased, setDeceased] = useState(false);
  const [diedOn, setDiedOn] = useState('');
  const [diedPlace, setDiedPlace] = useState('');
  const [motherId, setMotherId] = useState<string | null>(null);
  const [fatherId, setFatherId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [pickedPhotoUri, setPickedPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const hydrate = useCallback((loaded: RelativeFormRecord) => {
    setGivenName(loaded.values.givenName);
    setFamilyName(loaded.values.familyName);
    setBirthName(loaded.values.birthName);
    setGender(loaded.values.gender);
    setBornOn(loaded.values.bornOn);
    setBornPlace(loaded.values.bornPlace);
    setDeceased(loaded.values.deceased);
    setDiedOn(loaded.values.diedOn);
    setDiedPlace(loaded.values.diedPlace);
    setMotherId(loaded.values.motherId);
    setFatherId(loaded.values.fatherId);
    setPartnerId(loaded.values.partnerId);
    setPhotoKey(loaded.values.photoKey);
    setNote(loaded.values.note);
  }, []);

  const editRecord = mode.kind === 'edit' ? mode.record : null;
  const hydrated = useHydrateOnce(editRecord, editRecord?.id, hydrate);
  // Anlegen hat nichts zu laden und ist deshalb sofort benutzbar; beim
  // Bearbeiten erst, wenn der Datensatz wirklich da ist (Architekturregel 9).
  const ready = mode.kind === 'create' || hydrated;
  const selfId = mode.kind === 'edit' ? editRecord?.id ?? null : null;
  const pickerCandidates = useMemo(() => excludeSelf(candidates, selfId), [candidates, selfId]);

  const signedUrls = useSignedUrls([photoKey]);
  const previewUri = pickedPhotoUri ?? (photoKey ? signedUrls.get(photoKey) : undefined);
  const busy = saving || deleting;

  const handlePickPhoto = async () => {
    try {
      const uri = await pickRelativePhotoUri();
      setPickedPhotoUri(uri);
    } catch (pickError) {
      if (!(pickError instanceof RelativePhotoPickCancelledError)) {
        console.error('[LifeBook] Portrait konnte nicht ausgewählt werden', pickError);
      }
    }
  };

  const handleSubmit = () => {
    // Architekturregel 9: niemals speichern, bevor die Daten da sind.
    if (!ready) {
      return;
    }
    setValidationError(null);

    if (givenName.trim().length === 0) {
      setValidationError('Bitte einen Vornamen eingeben.');
      return;
    }

    onSubmit({
      givenName: givenName.trim(),
      familyName: familyName.trim().length > 0 ? familyName.trim() : null,
      birthName: birthName.trim().length > 0 ? birthName.trim() : null,
      gender,
      bornOn: bornOn.trim().length > 0 ? bornOn.trim() : null,
      bornPlace: bornPlace.trim().length > 0 ? bornPlace.trim() : null,
      deceased,
      diedOn: deceased && diedOn.trim().length > 0 ? diedOn.trim() : null,
      diedPlace: deceased && diedPlace.trim().length > 0 ? diedPlace.trim() : null,
      motherId,
      fatherId,
      partnerId,
      note: note.trim().length > 0 ? note.trim() : null,
      pickedPhotoUri,
    });
  };

  const displayError = validationError ?? error;

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy}>
        <ThemedText type="link" themeColor="textSecondary">
          Abbrechen
        </ThemedText>
      </Pressable>
      <ThemedText type="smallBold">{headerTitle}</ThemedText>
      <Pressable onPress={handleSubmit} hitSlop={12} disabled={busy || !ready}>
        <ThemedText type="linkPrimary">{saving ? '…' : submitLabel}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen header={header} contentContainerStyle={styles.content}>
        {!ready ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">
              Daten werden geladen …
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.photoRow}>
          <PersonAvatar uri={previewUri} name={givenName} size={96} />
          <Pressable onPress={handlePickPhoto} hitSlop={8} disabled={busy || !ready}>
            <ThemedText type="linkPrimary" themeColor={ready ? undefined : 'textSecondary'}>
              Foto auswählen
            </ThemedText>
          </Pressable>
        </View>

        <TextField
          label="Vorname"
          value={givenName}
          onChangeText={setGivenName}
          autoCapitalize="words"
          editable={ready}
          placeholder={ready ? undefined : 'Lädt …'}
        />
        <TextField
          label="Nachname"
          value={familyName}
          onChangeText={setFamilyName}
          autoCapitalize="words"
          editable={ready}
        />
        <TextField
          label="Geburtsname"
          value={birthName}
          onChangeText={setBirthName}
          autoCapitalize="words"
          editable={ready}
        />

        <ThemedText type="small" themeColor="textSecondary">
          Geschlecht
        </ThemedText>
        <View style={styles.chipRow}>
          {GENDER_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={gender === option.value}
              onPress={() => ready && setGender((current) => (current === option.value ? null : option.value))}
            />
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.rowField}>
            <TextField label="geboren am" value={bornOn} onChangeText={setBornOn} editable={ready} />
          </View>
          <View style={styles.rowField}>
            <TextField label="Geburtsort" value={bornPlace} onChangeText={setBornPlace} editable={ready} />
          </View>
        </View>

        <View style={styles.switchRow}>
          <ThemedText>Verstorben</ThemedText>
          <Switch value={deceased} onValueChange={setDeceased} disabled={!ready} />
        </View>

        {deceased ? (
          <View style={styles.row}>
            <View style={styles.rowField}>
              <TextField label="gestorben am" value={diedOn} onChangeText={setDiedOn} editable={ready} />
            </View>
            <View style={styles.rowField}>
              <TextField label="Sterbeort" value={diedPlace} onChangeText={setDiedPlace} editable={ready} />
            </View>
          </View>
        ) : null}

        <RelativePickerField
          label="Mutter"
          value={motherId}
          candidates={pickerCandidates}
          onChange={setMotherId}
          enabled={ready}
        />
        <RelativePickerField
          label="Vater"
          value={fatherId}
          candidates={pickerCandidates}
          onChange={setFatherId}
          enabled={ready}
        />
        <RelativePickerField
          label="Partner"
          value={partnerId}
          candidates={pickerCandidates}
          onChange={setPartnerId}
          enabled={ready}
        />

        <TextField
          label="Notiz"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={3}
          style={styles.noteInput}
          editable={ready}
        />

        {displayError ? (
          <ThemedText type="small" themeColor="dangerText">
            {displayError}
          </ThemedText>
        ) : null}

        {onDelete ? (
          <Pressable onPress={onDelete} hitSlop={8} disabled={busy} style={styles.deleteRow}>
            {deleting ? (
              <ActivityIndicator color={dangerText} />
            ) : (
              <ThemedText type="link" style={{ color: dangerText }}>
                Person löschen
              </ThemedText>
            )}
          </Pressable>
        ) : null}
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

/**
 * One "Mutter"/"Vater"/"Partner" field: the chosen person's name (or a
 * placeholder), and a full-screen list to pick a different one — same
 * `presentationStyle="pageSheet"` modal src/app/foto/[id].tsx already uses
 * for its date/caption editors.
 */
function RelativePickerField({
  label,
  value,
  candidates,
  onChange,
  enabled,
}: {
  label: string;
  value: string | null;
  candidates: RelativeRow[];
  onChange: (relativeId: string | null) => void;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = candidates.find((candidate) => candidate.id === value);

  return (
    <View style={styles.pickerField}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable onPress={() => setOpen(true)} disabled={!enabled}>
        <ThemedView type="backgroundElement" style={styles.pickerValueButton}>
          <ThemedText themeColor={selected ? undefined : 'textSecondary'}>
            {selected ? displayName(selected) : 'Keine Angabe'}
          </ThemedText>
        </ThemedView>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}>
        <ThemedView style={styles.modalRoot}>
          <View style={styles.header}>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <ThemedText type="link" themeColor="textSecondary">
                Schließen
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">{label}</ThemedText>
            <View style={styles.headerSpacer} />
          </View>
          <FlatList
            data={candidates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.modalContent}
            ListHeaderComponent={
              <Pressable
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
                style={styles.modalRow}>
                <ThemedText themeColor="textSecondary">Keine Angabe</ThemedText>
              </Pressable>
            }
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.modalEmpty}>
                Noch niemand anders im Stammbaum.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                style={styles.modalRow}>
                <ThemedText>{displayName(item)}</ThemedText>
              </Pressable>
            )}
          />
        </ThemedView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerSpacer: { width: 48 },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  photoRow: { alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  row: { flexDirection: 'row', gap: Spacing.two },
  rowField: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  noteInput: { height: 84, textAlignVertical: 'top', paddingTop: Spacing.two },
  deleteRow: { alignItems: 'center', paddingTop: Spacing.three },
  pickerField: { gap: Spacing.one },
  pickerValueButton: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  modalRoot: { flex: 1 },
  modalContent: { paddingBottom: Spacing.five },
  modalRow: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  modalEmpty: { textAlign: 'center', paddingTop: Spacing.five },
});
