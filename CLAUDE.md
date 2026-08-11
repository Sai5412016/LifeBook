# LifeBook — Arbeitsanweisung für KI-Sessions

Diese Datei wird von Claude Code und Cowork automatisch gelesen. Sie enthält die
Regeln, an die sich jede Session halten muss, und die Fallstricke, die in diesem
Projekt bereits Zeit gekostet haben. **Wer sie ignoriert, baut Fehler nach, die
schon einmal behoben wurden.**

## Was LifeBook ist

Eine Offline-First-App für Eltern: Fotochronik und Alltagsdaten eines Kindes
(Füttern, Schlafen, Wickeln, Wachstum, Impfungen). Zwei Elternteile teilen einen
Haushalt und sehen dieselben Daten auf beiden Handys, auch ohne Netz.

Zielplattform ist Android (Entwicklung auf Windows ohne Android Studio, Builds
laufen über EAS). iOS ist vorbereitet, aber nicht getestet.

## Stack

| Schicht | Technologie |
|---|---|
| App | Expo SDK 57, Expo Router, React Native, New Architecture |
| Lokale DB | PowerSync v2 auf SQLCipher (verschlüsselt, Schlüssel in SecureStore) |
| Backend | Supabase (Auth, Postgres, Storage) |
| Sync | PowerSync über **WebSocket** (nicht HTTP-Streaming, siehe Fallstricke) |
| Tests | Vitest für reine Logik, `tsc --noEmit` als Typprüfung |

## Architekturregeln

1. **Repository-Muster ist Pflicht.** Feature-Code greift *niemals* direkt auf
   die Datenbank zu, sondern ausschließlich über `src/features/<feature>/repository.ts`.
2. **Zeit wird nur in `src/core/time` konstruiert.** Kein `new Date()` in
   Feature-Code. Alle Instants sind ISO-8601 UTC. `local_date` wird beim Einfügen
   einmal berechnet und **nie** neu berechnet, damit „die Nacht vom 3." über
   Umzüge und Zeitumstellungen stabil bleibt.
3. **Reine Logik von Gerätecode trennen.** Module mit Expo-Importen sind nicht
   testbar. Muster: `identity.ts` (rein, getestet) neben `media.ts` (Gerät).
4. **Abweichungen von der Spec werden dokumentiert, nicht verschwiegen.** Als
   Kommentar direkt am Code, mit Begründung und Datum.
5. **Kommentare erklären das WARUM**, nicht das WAS. Besonders bei allem, was
   wie ein Umweg aussieht — sonst wird es beim nächsten Aufräumen entfernt.
6. **Sichtbare Texte auf Deutsch**, Code und Kommentare auf Englisch.

## Verifizierte Fallstricke — nicht erneut hineinlaufen

### 1. `upsert()` funktioniert beim ersten Haushalt nicht

Gegen die Live-Datenbank als Rolle `authenticated` getestet (2026-08-09):

| Variante | Ergebnis |
|---|---|
| `INSERT` (einfach) | OK |
| `INSERT .. ON CONFLICT DO UPDATE` | 42501 Zugriffsregel-Verstoß |
| `INSERT .. ON CONFLICT DO NOTHING` | 42501 |
| `INSERT .. RETURNING` | 42501 |

Jede `ON CONFLICT`-Klausel und jedes `RETURNING` zwingt Postgres, zusätzlich die
Leseregel zu prüfen. Die verlangt auf `households` eine Mitgliedschaft, die beim
allerersten Haushalt noch nicht existiert. `supabase-js.upsert()` erzeugt immer
`ON CONFLICT` und kann den ersten Haushalt daher **nie** anlegen.

→ `src/core/sync/connector.ts` nutzt `.insert()`, schluckt Fehlercode 23505 als
„bereits angewendet" und hängt **kein** `.select()` an Upload-Statements.

### 2. HTTP-Streaming ist auf Android unzuverlässig

PowerSync-Standardtransport stirbt reproduzierbar mit „Fetch request has been
canceled". → `connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET` in
`src/core/db/index.ts`. Nicht zurückdrehen.

### 3. Android-Medienkennungen sind instabil

MediaStore-IDs ändern sich bei Neuindizierung, und der Fotoauswähler liefert bei
jedem Aufruf einen neuen Cache-Pfad. Identität eines Fotos ist deshalb
ausschließlich der Inhalt: SHA-256 der ersten 1 MB plus exakte Dateigröße.

### 4. Der Fotoauswähler legt Kopien im Cache ab, den Android leeren darf

Deshalb wird jede ausgewählte Datei nach `Paths.document/photos-pending/`
zwischengelagert und erst gelöscht, wenn das Original nachweislich hochgeladen
ist. Ohne diesen Schritt zeigen Datenbankeinträge irgendwann ins Leere.

### 5. Funkupdates können keine nativen Module nachliefern

`runtimeVersion` steht auf `fingerprint`: Ändert sich der native Unterbau, gehen
Updates nicht mehr an alte Installationen. Nach jedem neuen nativen Modul ist ein
neuer Build zwingend.

### 6. Expo-Pakete niemals mit `npm install` und geratener Version

Beobachteter Absturz (2026-08-10): `expo-image-picker` stand auf `~17.0.0` (SDK-54-
Reihe), während jedes andere Expo-Paket auf der 57er-Reihe stand. Ergebnis:

```
NoClassDefFoundError: expo.modules.kotlin.types.AnyTypeProvider
at expo.modules.imagepicker.ImagePickerModule.definition(ImagePickerModule.kt:323)
```

Das ist ein **nativer** Absturz beim App-Start, bevor JavaScript überhaupt
läuft — also bevor `installGlobalErrorHandler()`, die `ErrorBoundary` oder
irgendein anderer Fehlerbildschirm aus diesem Projekt greifen kann. Die
gesamte Diagnosefähigkeit aus JavaScript ist hier wirkungslos.

→ Expo-Pakete immer mit `npx expo install <paket>` hinzufügen, nie mit
`npm install <paket>` und einer geratenen oder von einem Tutorial kopierten
Versionsnummer. `expo install` wählt die zur installierten SDK-Reihe passende
Version. In dieser Sandbox ist `api.expo.dev` per Netzwerkrichtlinie
gesperrt — dann `EXPO_OFFLINE=1 npx expo install <paket>` verwenden, das
greift auf die mit dem Paket `expo` ausgelieferte
`expo/bundledNativeModules.json` zurück statt auf den Netzwerkaufruf.

### 7. Expo-Plugins von Drittanbietern brechen `expo config`, nicht erst den Build

Beobachtet (2026-08-11) beim Plugin von `react-native-share`: `eas build` brach
sofort mit „expo config --json exited with non-zero code: 1" ab — nach der
üblichen Wartezeit für den Upload, aber vor jedem eigentlichen Kompilierschritt.
Zwei unabhängige Ursachen, beide im selben Drittanbieter-Plugin:

1. **Fehlende Peer-Abhängigkeit.** Das Plugin ruft intern `expo-build-properties`
   auf, bringt es aber nicht selbst als Abhängigkeit mit — `Cannot find module
   'expo-build-properties'`. Das Paket stand nirgends in `package.json`, obwohl
   das Plugin es zwingend braucht.
2. **Fehlendes Optionsobjekt.** Der Plugin-Eintrag stand in `app.json` als reine
   Zeichenkette `"react-native-share"`. Der Plugin-Code liest `props.android`
   — ohne Optionsobjekt ist `props` `undefined`, also `TypeError: Cannot read
   properties of undefined (reading 'android')`.

→ Fehlende Peer-Abhängigkeit mit `npx expo install <paket>` nachrüsten (siehe
Fallstrick 6). Plugin-Eintrag als `["<plugin>", {}]` schreiben, nicht als reine
Zeichenkette — auch ein leeres Optionsobjekt reicht, damit `props` definiert
ist. Für `react-native-share` speziell: `android` in den Optionen ist nur eine
Liste von Ziel-Apps für den Manifest-Abschnitt `queries` (z. B. um gezielt
nach Instagram/WhatsApp zu teilen) — für den allgemeinen Teilen-Dialog bleibt
das Feld leer.

**Jedes Drittanbieter-Plugin kann eigene Peer-Abhängigkeiten und ein
Pflicht-Optionsobjekt verlangen, ohne dass Expo das beim Hinzufügen prüft.**
`npx expo config --json` führt exakt denselben Konfigurationsschritt aus wie
`eas build` als Allererstes — in Sekunden statt nach zwanzig Minuten
Build-Warteschlange. Deshalb: nach **jeder** Änderung an `app.json` oder an der
Plugin-Liste `npx expo config --json` ausführen, **bevor** ein Build gestartet
wird (siehe „Vor jeder Abgabe").

## Speicher- und Zugriffsmodell für Fotos

Privater Bucket `photos`, Pfadaufbau `{household_id}/{photo_id}/…`. **Der erste
Pfadabschnitt ist die Haushalts-ID** — genau darauf greifen die Zugriffsregeln
zu. Deshalb prüft `identity.ts` jede ID, bevor sie in einen Pfad wandert; ein
untergeschobener Schrägstrich würde die Prüfung aushebeln.

Lesen darf jedes Haushaltsmitglied, Schreiben nur `owner` und `caregiver`.
Getestet: fremde Haushalte werden in beide Richtungen abgewiesen.

GPS-Koordinaten kommen **nicht** in die Datenbank. Das Originalfoto wird
unverändert gespeichert, inklusive eingebetteter Aufnahmedaten.

## Befehle

```bash
npm install                                    # Abhängigkeiten
npx tsc --noEmit                               # Typprüfung
npx vitest run                                 # Tests
eas build --profile preview --platform android # eigenständige APK
eas update --branch preview -m "Beschreibung"  # Funkupdate ohne neuen Build
```

## Vor jeder Abgabe

`npx tsc --noEmit` **und** `npx vitest run` müssen sauber durchlaufen. Für
Änderungen an Zugriffsregeln oder Datenbanklogik zusätzlich gegen die echte
Datenbank prüfen, nicht nur nachdenken — genau das hat Fallstrick 1 aufgedeckt.

Bei jeder Änderung an `app.json` oder an der Plugin-Liste zusätzlich
`npx expo config --json` ausführen — muss ohne Fehler durchlaufen und eine
lesbare Konfiguration ausgeben. Das prüft in Sekunden denselben Schritt, an
dem `eas build` sonst erst nach der Build-Warteschlange scheitert (Fallstrick 7).

## Berichtsformat — am Ende JEDER Aufgabe ausgeben

```
== BERICHT ==
BRANCH: <Zweigname oder "main">
STATUS: fertig | blockiert | rückfrage
TSC: ok | fehler: <erste Meldung>
TESTS: <n> bestanden, <n> fehlgeschlagen
DATEIEN:
- <pfad> — <ein Satz, was sich geändert hat>
ABWEICHUNGEN:
- <was anders gemacht wurde als vorgegeben, und warum — "keine" wenn nichts>
OFFEN:
- <was ungelöst ist, was auf dem Gerät geprüft werden muss — "nichts" wenn nichts>
```

**ABWEICHUNGEN ist der wichtigste Teil.** War eine Vorgabe fachlich falsch oder
nicht umsetzbar, wird der bessere Weg gegangen und hier begründet — nicht
stillschweigend der untauglichen Vorgabe gefolgt. Genau dieses stille Befolgen
ist der teuerste Fehler: Er fällt erst auf, wenn niemand mehr nachvollziehen
kann, warum etwas so gebaut wurde.

## Kommunikation mit dem Auftraggeber

Er ist technisch versiert, aber kein ausgebildeter Entwickler. Anleitungen ohne
ausgelassene Schritte: wo geklickt wird, welche Datei geöffnet wird, welches
Ergebnis zu erwarten ist. Vollständige Dateien liefern, keine Auszüge mit
„Rest bleibt unverändert".
