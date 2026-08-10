/**
 * core/auth/errors — maps Supabase Auth error messages to German user-facing text.
 *
 * Supabase does not localize its error messages, and there is no stable error
 * code to switch on in supabase-js today — only the English message string.
 * We match on lowercased substrings for the common cases; anything unmapped
 * falls back to the original message rather than hiding it.
 */
export function translateAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'E-Mail oder Passwort ist falsch.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Bitte bestätige zuerst deine E-Mail-Adresse (siehe Posteingang).';
  }
  if (lower.includes('user already registered')) {
    return 'Für diese E-Mail existiert bereits ein Konto — melde dich stattdessen an.';
  }
  if (lower.includes('password should be at least')) {
    return 'Das Passwort muss mindestens 6 Zeichen lang sein.';
  }
  if (lower.includes('unable to validate email address')) {
    return 'Diese E-Mail-Adresse scheint ungültig zu sein.';
  }
  if (lower.includes('network')) {
    return 'Keine Verbindung — bitte Internetverbindung prüfen und erneut versuchen.';
  }

  return message;
}
