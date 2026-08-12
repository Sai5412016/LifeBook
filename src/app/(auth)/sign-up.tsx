import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { translateAuthError } from '@/core/auth/errors';
import { supabase } from '@/core/supabase';
import { Button, KeyboardSafeScreen, TextField } from '@/ui';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSignUp = async () => {
    setError(null);
    setInfo(null);

    if (!email.trim() || !password) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    if (password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      return;
    }

    if (!data.session) {
      // Email confirmation is required (Supabase project default) — no session
      // yet, so the redirect gate stays on (auth) until the user confirms and
      // signs in.
      setInfo('Konto erstellt. Bitte bestätige deine E-Mail-Adresse und melde dich danach an.');
      return;
    }

    // If a session came back immediately (email confirmation disabled), the
    // root layout's redirect gate reacts to it automatically — on to
    // onboarding. Push registration reacts to the same session too (see
    // _layout.tsx#PushRegistrationEffect) — no separate call needed here.
  };

  return (
    <ThemedView style={styles.root}>
      <KeyboardSafeScreen contentContainerStyle={styles.scrollContent}>
        <ThemedText type="title" style={styles.title}>
          Konto erstellen
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Für LifeBook — dauert eine Minute.
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextField
            label="E-Mail"
            placeholder="du@beispiel.de"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            label="Passwort (mind. 6 Zeichen)"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
          />
          <TextField
            label="Passwort bestätigen"
            placeholder="••••••••"
            value={passwordConfirm}
            onChangeText={setPasswordConfirm}
            secureTextEntry
            textContentType="newPassword"
          />

          {error ? (
            <ThemedText type="small" themeColor="dangerText">
              {error}
            </ThemedText>
          ) : null}
          {info ? (
            <ThemedText type="small" themeColor="green">
              {info}
            </ThemedText>
          ) : null}

          <Button label="Registrieren" onPress={handleSignUp} loading={submitting} />

          <Link href="/sign-in" style={styles.switchLink}>
            <ThemedText type="linkPrimary">Schon ein Konto? Jetzt anmelden</ThemedText>
          </Link>
        </ThemedView>
      </KeyboardSafeScreen>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  form: { gap: Spacing.three, marginTop: Spacing.three },
  switchLink: { alignSelf: 'center', marginTop: Spacing.two },
});
