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
   **Eine Ausnahme (seit 2026-08-13):** eine ausdrückliche Nutzerkorrektur
   eines gespeicherten Zeitpunkts (z. B. das Aufnahmedatum eines Fotos).
   Dort ändert sich die Bedeutung der Zeile absichtlich — anders als bei
   einer automatischen Neuberechnung im Hintergrund, vor der Regel 2
   eigentlich schützt. In diesem einen Fall werden der Zeitpunkt UND
   `local_date` gemeinsam, in derselben Schreiboperation neu gesetzt (siehe
   `core/time#applyOccurredAtCorrection`, verwendet in
   `features/photos/repository.ts#correctPhotoOccurredAt`) — sonst zeigt der
   Bildschirm ein neues Datum, aber die Chronik sortiert weiter unter dem
   alten ein, was schlimmer ist als vor der Korrektur. Die Zeitzone dafür
   ist immer die gespeicherte `tz`-Spalte der Zeile, nie die aktuelle
   Geräte-Zeitzone.
3. **Reine Logik von Gerätecode trennen.** Module mit Expo-Importen sind nicht
   testbar. Muster: `identity.ts` (rein, getestet) neben `media.ts` (Gerät).
4. **Abweichungen von der Spec werden dokumentiert, nicht verschwiegen.** Als
   Kommentar direkt am Code, mit Begründung und Datum.
5. **Kommentare erklären das WARUM**, nicht das WAS. Besonders bei allem, was
   wie ein Umweg aussieht — sonst wird es beim nächsten Aufräumen entfernt.
6. **Sichtbare Texte auf Deutsch**, Code und Kommentare auf Englisch.
7. **Jeder Bildschirm mit Texteingabe wird in KeyboardSafeScreen gelegt.**
   Seit Edge-to-Edge auf Android verpflichtend ist, verkleinert das System
   das App-Fenster nicht mehr; KeyboardAvoidingView reicht nicht. Ein
   nacktes TextInput außerhalb von KeyboardSafeScreen ist ein Fehler, auch
   wenn er im Emulator nicht auffällt — Emulatoren blenden häufig gar keine
   Tastatur ein.
8. **Was für jeden angemeldeten Nutzer gelten soll, hängt am Anmeldezustand,
   nicht am Anmeldevorgang.** Die Push-Registrierung stand nur hinter dem
   interaktiven Anmeldeformular und lief deshalb bei wiederkehrenden
   Nutzern mit bestehender Sitzung nie — der Normalfall ab dem zweiten Tag.
   Solche Effekte gehören an den Auth-Zustand im Wurzel-Layout, nach dem
   Muster von `PushRegistrationEffect` und `PowerSyncConnector`.
9. **Bearbeitungsformulare befüllen sich, wenn die Daten da sind — und
   speichern erst dann.** Formularzustand aus einer asynchronen Abfrage
   direkt beim ersten Aufbau zu setzen, merkt sich die Leere für immer:
   Die Abfrage liefert beim ersten Durchlauf noch nichts. Sichtbar wird
   das als leeres Formular über vorhandenen Daten — und Speichern
   überschreibt sie. Am 16.08.2026 in „Kind bearbeiten" passiert, um ein
   Haar mit Verlust von Marinas Geburtsdaten.
   → Befüllen über `useHydrateOnce` (src/ui), und „Speichern" bleibt
   gesperrt, bis die Daten geladen sind. Die Sperre ist der wichtigere
   Teil: Sie verhindert den Schaden auch dann, wenn das Befüllen scheitert.

   **Derselbe Fehler in der zweiten Bauform (17.08.2026):** Nicht nur
   spätes Ankommen bricht `useState`, sondern auch ein WECHSELNDER
   Datensatz. Ein Panel als `{ziel ? <Panel zeile={ziel}/> : null}` bleibt
   beim Antippen einer anderen Zeile dieselbe React-Instanz — `useState`
   läuft nicht erneut, und die Werte von Zeile A stehen in einem Panel,
   das auf Zeile B speichert. Gefunden in den Bearbeiten-Panels von
   Füttern, Wickeln und Schlafen, wo je ein Schreibvorgang mehrere Spalten
   gleichzeitig setzt. Deshalb nimmt `useHydrateOnce` die Identität des
   Datensatzes entgegen und befüllt bei deren Wechsel neu. Ein Formular,
   das denselben Datensatz behält, wird dabei NICHT neu befüllt — eine
   laufende Eingabe darf ein Hintergrund-Abgleich nie überschreiben.

   **Ein Verfahren, nicht mehrere.** Wartende Aufrufer-Schranken
   („Formular erst mounten, wenn geladen") gab es früher parallel dazu;
   sie sind entfernt. Ein gemeinsam genutztes Formular muss ausdrücklich
   erfahren, welchen Fall es bedient — siehe `PersonFormMode` in
   `features/people/components/person-form.tsx`: „anlegen" hat gar kein
   Feld für einen Datensatz, „bearbeiten" hat eines, das `null` sein darf,
   solange geladen wird. Standardwerte wie `initialName = ''` sind genau
   deshalb verboten: Sie machen „lädt noch" von „legt frisch an"
   ununterscheidbar.

   **Letztes Netz in der Datenschicht.** `updateChild` und `updatePerson`
   weisen einen leeren Pflichtnamen ab. Ein leerer Name ist nie eine
   gültige Absicht und zugleich das zuverlässigste Kennzeichen eines
   Formulars, das ohne Laden gespeichert hat. Ein pauschales „alle Felder
   leer"-Verbot wäre dagegen falsch: Einzelne optionale Werte zu leeren
   ist eine legitime Korrektur.

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

### 6. Neue synchronisierte Tabellen brauchen REPLICA IDENTITY FULL

Am 12.08.2026 gegen die Live-Datenbank festgestellt: Die Tabelle `people`
wurde ohne `REPLICA IDENTITY FULL` angelegt und war damit die einzige der
20 replizierten Tabellen mit dem Standardwert `DEFAULT`.

Bei `DEFAULT` protokolliert Postgres bei UPDATE und DELETE nur den
Primärschlüssel. PowerSync verteilt Zeilen aber anhand von `household_id`
auf Buckets. Fehlt die im Protokoll, kann PowerSync bei einer Löschung
nicht bestimmen, welcher Bucket betroffen ist — die Löschung erreicht
kein Gerät. Ergebnis: Die Zeile verschwindet auf einem Handy und bleibt
auf dem anderen für immer stehen.

Weder Typprüfung noch Tests fangen das ab, weil es keine Eigenschaft des
Codes ist.

→ Jede Migration, die eine neue synchronisierte Tabelle anlegt, MUSS
enden mit:
```sql
ALTER TABLE public.<tabelle> REPLICA IDENTITY FULL;
```
**Präzisiert am 15.08.2026, gegen die Datenbank geprüft:** Die Publikation
`powersync` ist auf das ganze Schema `public` eingerichtet, nicht auf eine
Tabellenliste — eine neue Tabelle landet also AUTOMATISCH in der
Replikation, der Schritt „in die Publikation aufnehmen" entfällt. Was NICHT
automatisch folgt: `REPLICA IDENTITY FULL` bleibt auf dem Standardwert und
muss weiterhin von Hand gesetzt werden (siehe oben), ebenso die Zeile in
`sync-rules.yaml` — und die Sync-Regeln müssen zusätzlich von Hand in der
PowerSync-Konsole freigegeben werden. Zwei Schritte, nicht drei.

### 7. Expo-Pakete niemals mit `npm install` und geratener Version

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

### 8. Expo-Plugins von Drittanbietern brechen `expo config`, nicht erst den Build

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
Fallstrick 7). Plugin-Eintrag als `["<plugin>", {}]` schreiben, nicht als reine
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

### 9. Im Wurzel-Layout gehört `<Stack />`, nicht `<Slot />`

Am 13.08.2026 gefunden: `app/_layout.tsx` rendert für den Hauptzustand
`<Slot />`. Slot zeigt immer nur die aktive Route und baut alles darunter
ab. Beim Öffnen eines Bildschirms neben `(tabs)` — Foto, Menschen,
Einstellungen, Kindprofil — wurde deshalb der GESAMTE Reiter-Navigator
abgebaut und beim Zurückspringen neu erzeugt. Ein frischer Reiter-
Navigator startet immer auf seinem Standardreiter. Symptome: Rücksprung
landet auf der Startseite statt beim vorherigen Reiter, und die
Scrollposition ist weg.

Der naheliegende Verdacht (falsch verdrahtetes Navigationsziel) war
nachweislich falsch — `router.back()` stand korrekt da. Die Ursache lag eine
Ebene höher.

→ Bildschirme, die über den Reitern liegen sollen, brauchen im Wurzel-
Layout einen echten Stapel. Nicht auf `<Slot />` zurückdrehen.

### 10. Zum Teilen gehört die Datei in den Cache-Ordner

Am 13.08.2026 gefunden: react-native-share bringt einen eigenen
Dateifreigeber mit, der nur zwei Wurzeln freigibt — den Download-Ordner
und den Cache (share_download_paths.xml, kein files-path-Eintrag). Frisch
importierte, noch nicht hochgeladene Originale liegen aber unter
Paths.document. Das native Modul fängt die daraus entstehende Ausnahme mit
einem System.out.println ab, gibt still null zurück, und dieses null landet
ungeprüft in der Anhangsliste. Ergebnis: Die Auswahl der Ziel-App öffnet
sich, der Anhang ist leer, die Empfänger-App tut gar nichts, und in
JavaScript kommt kein Fehler an.

→ Jede Datei wird vor dem Teilen in den Cache-Ordner kopiert, unabhängig
davon, wo sie liegt. Und: Ein natives Modul, das schweigt, ist kein Beweis
dafür, dass nichts passiert ist.

### 11. PowerSync-Sync-Rules können keine JOINs

Am 22.08.2026 gegen die PowerSync-Dokumentation und die Live-Datenbank
geprüft, bevor die erste Zeile in `milestone_photos` existierte: Eine
Sync-Rules-Zeile der Form

```yaml
- SELECT mp.* FROM milestone_photos mp JOIN milestones m ON m.id = mp.milestone_id
   WHERE m.household_id = bucket.household_id
```

wäre beim Deploy gescheitert — JOINs sind laut PowerSync „Supported in Sync
Streams only. Not available in Sync Rules". Eine Verknüpfungstabelle ohne
eigene `household_id` kann ihre Sync-Rules-Zeile deshalb nicht über die
Elterntabelle herleiten.

→ Jede synchronisierte Tabelle braucht eine einzelne `id`-Spalte (PowerSync
verlangt sie) UND ihre eigene `household_id`-Spalte, auch wenn sie fachlich
nur über eine andere Tabelle zu einem Haushalt gehört. Verknüpfungstabellen
werden dafür denormalisiert: `household_id` direkt in die Tabelle
schreiben, nicht aus der Elternzeile joinen. Jeder Schreibvorgang muss
dieses `household_id` explizit mitgeben — siehe
`features/events/repository.ts#replaceEventPhotos` für das Muster.

### 12. PowerSync lädt die Warteschlange in aufgezeichneter Reihenfolge hoch

Am 22.08.2026 gegen die Live-Umgebung gemessen: In `addEvent`
(`features/events/repository.ts`) stand die `milestone_photos`-Zeile VOR
der `milestones`-Zeile. Beide liefen in derselben Transaktion, aber
PowerSync lädt die Schreiboperationen eines Geräts an Supabase in der
Reihenfolge hoch, in der sie LOKAL AUSGEFÜHRT wurden — nicht nach
Transaktion gruppiert. Der erste Upload-Versuch war deshalb ein
`milestone_photos`-Insert, dessen `milestone_id` in Postgres noch gar
nicht existierte: ein Fremdschlüssel-409, den PowerSync alle 5 Sekunden
endlos wiederholte. Kein einziger POST auf `/rest/v1/milestones` kam an —
das Ereignis wurde nie angelegt — und der Stau blockierte JEDEN weiteren
Upload dieses Geräts, auch Fotos und Alltagseinträge, die mit dem
Ereignis nichts zu tun hatten.

→ Elternzeile immer VOR Kindzeile schreiben, innerhalb derselben
Transaktion (siehe `addEvent`s eigener Kommentar zur Schreibreihenfolge).
Und, präziser als das: zwischen zwei synchronisierten Tabellen am besten
gar keinen Fremdschlüssel anlegen, wenn eine davon aus der anderen heraus
neu entsteht — ein hängengebliebener Stapel wegen eines einzigen
Ordnungsfehlers ist teurer als der Verlust der Datenbank-Garantie. Genau
deshalb tragen `relatives`, `relative_unions` und `relative_photos`
absichtlich KEINE Fremdschlüssel zueinander (nur `household_id` hat einen)
— siehe `core/db/schema.ts`s Kommentar auf `relatives`.

## Speicher- und Zugriffsmodell für Fotos

Privater Bucket `photos`, Pfadaufbau `{household_id}/{photo_id}/…`. **Der erste
Pfadabschnitt ist die Haushalts-ID** — genau darauf greifen die Zugriffsregeln
zu. Deshalb prüft `identity.ts` jede ID, bevor sie in einen Pfad wandert; ein
untergeschobener Schrägstrich würde die Prüfung aushebeln.

Lesen darf jedes Haushaltsmitglied, Schreiben nur `owner` und `caregiver`.
Getestet: fremde Haushalte werden in beide Richtungen abgewiesen.

GPS-Koordinaten kommen **nicht** in die Datenbank. Das Originalfoto wird
unverändert gespeichert, inklusive eingebetteter Aufnahmedaten.

## Edge Functions

- `notify-household` — verschickt Push-Nachrichten an den Haushalt, mit
  Anmeldepflicht.
- `album` — öffentliche Datenschnittstelle für Freigaben, OHNE
  Anmeldepflicht, bewusst; siehe `supabase/config.toml`. Sie ist die
  einzige Ausnahme. Liefert seit 15.08.2026 nur noch JSON, kein HTML mehr
  — Supabase liefert HTML auf einer `supabase.co`-Adresse abgeschottet aus
  (Quelltext statt Seite, zerlegte Umlaute, blockierte Cookies, auf dem
  Gerät bestätigt). Die eigentliche Ansichtsseite liegt deshalb getrennt
  unter `viewer/` und läuft bei Vercel (Projekt `lifebook-album`, Team
  `dabbly`) — nicht zurückbauen zu einer HTML-liefernden Funktion.

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
dem `eas build` sonst erst nach der Build-Warteschlange scheitert (Fallstrick 8).

## Wann etwas fertig ist

`STATUS: fertig` darf nur gemeldet werden, wenn die **Definition of Done**
in `SKILL.md` für den jeweiligen Arbeitstyp (Feature, Release, Bugfix,
Meilenstein „Umsatz") erfüllt ist. Ist auch nur ein Kriterium offen, lautet
die Meldung `STATUS: blockiert`, und das offene Kriterium steht wörtlich
unter `OFFEN:`.

Sauberes `tsc`, grüne Tests und ein unveränderter Fingerabdruck sind
Voraussetzung, nicht Beweis — sie sagen, dass nichts kaputt ist, nicht dass
etwas fertig ist. Kriterien, die nur auf einem echten Gerät oder in einer
fremden Konsole prüfbar sind (Gerätetest, Play Console, Google-Group),
kann eine Sitzung nicht selbst abhaken: Sie werden als offen gemeldet, nie
stillschweigend als erfüllt angenommen.

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
