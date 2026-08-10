# Projektanweisung — in Claude unter „Projektanweisungen" einfügen

Dieser Text gehört in das Feld **Projektanweisungen** des Claude-Projekts.
Er ergänzt die persönlichen Einstellungen, wiederholt sie also bewusst nicht.

---

Du arbeitest an **LifeBook**, einer Offline-First-App für Eltern: Fotochronik und
Alltagsdaten eines Kindes. Zwei Elternteile teilen einen Haushalt und sehen
dieselben Daten auf beiden Handys, auch ohne Netz. Erste echte Nutzer sind die
Familie des Auftraggebers, Kind geboren am 05.08.2026.

**Stack:** Expo SDK 57 mit Expo Router, PowerSync v2 auf verschlüsseltem SQLCipher,
Supabase für Anmeldung, Datenbank und Dateispeicher. Builds über EAS, Zielplattform
Android. Entwicklung auf Windows ohne Android Studio.

## Verbindliche Architekturregeln

1. Feature-Code greift **nie** direkt auf die Datenbank zu, sondern ausschließlich
   über `src/features/<feature>/repository.ts`.
2. Zeit wird **nur** in `src/core/time` konstruiert. Kein `new Date()` in
   Feature-Code. Alle Zeitpunkte als ISO-8601 UTC. `local_date` wird beim Einfügen
   einmal berechnet und nie neu berechnet.
3. Reine Logik und Gerätecode gehören in getrennte Dateien, damit die Logik ohne
   Emulator testbar bleibt.
4. Abweichungen von der Spezifikation werden als Kommentar am Code begründet und
   datiert, nicht stillschweigend eingebaut.
5. Kommentare erklären das **Warum**, nicht das Was.
6. Sichtbare Texte auf Deutsch, Code und Kommentare auf Englisch.

## Fallstricke, die bereits Zeit gekostet haben

- **`upsert()` scheitert am ersten Haushalt.** Jede `ON CONFLICT`-Klausel und jedes
  `RETURNING` zieht zusätzlich die Leseregel heran, die beim ersten Haushalt noch
  nicht erfüllbar ist. Gegen die Live-Datenbank verifiziert. Beim Hochladen wird
  `.insert()` verwendet, Fehlercode 23505 gilt als „bereits erledigt", und an
  Upload-Anweisungen kommt **kein** `.select()`.
- **PowerSync läuft über WebSocket**, nicht über HTTP-Streaming. Letzteres bricht
  auf Android reproduzierbar ab. Nicht zurückdrehen.
- **Android-Medienkennungen sind instabil.** Fotos werden ausschließlich über
  ihren Inhalt identifiziert: SHA-256 der ersten 1 MB plus exakte Dateigröße.
- **Der Fotoauswähler legt Kopien im Cache ab**, den Android jederzeit leeren darf.
  Dateien werden deshalb persistent zwischengelagert und erst nach bestätigtem
  Upload gelöscht.
- **Funkupdates liefern keine nativen Module nach.** Nach jedem neuen nativen
  Modul ist ein echter Build zwingend.
- **`.env` ist von Git ausgeschlossen** und erreicht EAS deshalb nicht. Zugangsdaten
  liegen als EAS-Umgebungsvariablen. Fehlen sie, entsteht eine App ohne
  Backend-Adresse, die scheinbar grundlos bei der Anmeldung versagt.

## Vor jeder Abgabe

`npx tsc --noEmit` und `npx vitest run` müssen sauber durchlaufen. Änderungen an
Zugriffsregeln oder Datenbanklogik werden **gegen die echte Datenbank geprüft**,
nicht nur durchdacht — genau so wurde der `upsert`-Fallstrick gefunden.

## Arbeitsteilung

Für Gespräche, Konzepte, Bewertungen und Planung: dieses Projekt. Für tatsächliche
Codeänderungen am Repository: eine Cowork-Aufgabe, weil dort Dateizugriff, Terminal
und die Verbindungen zu Supabase bestehen. Ergebnisse und Entscheidungen kommen
anschließend in `PROJEKT.md` zurück.
