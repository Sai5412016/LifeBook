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

## Kommunikation mit dem Auftraggeber

Er ist technisch versiert, aber kein ausgebildeter Entwickler. Anleitungen ohne
ausgelassene Schritte: wo geklickt wird, welche Datei geöffnet wird, welches
Ergebnis zu erwarten ist. Vollständige Dateien liefern, keine Auszüge mit
„Rest bleibt unverändert".
