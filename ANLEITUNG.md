# Claude-Projekt anlegen — Schritt für Schritt

Dieser Ordner enthält alles, was das Claude-Projekt braucht. Die drei
`WISSEN-*.md` sind **Kopien** der Originale aus dem Projektstamm; sie werden bei
Änderungen neu erzeugt, damit die Originale die einzige Wahrheit bleiben.

## 1. Projekt erstellen

Claude öffnen → linke Seitenleiste → **Projekte** → **Projekt erstellen**.

- **Name:** `LifeBook`
- **Beschreibung:** `Offline-First-App für Eltern: Fotochronik und Alltagsdaten
  eines Kindes. Expo, PowerSync, Supabase.`

## 2. Projektanweisungen einfügen

Im Projekt auf **Anweisungen hinzufügen** (bzw. das Stift-Symbol bei
„Projektanweisungen") klicken.

Den **gesamten Inhalt von `PROJEKTANWEISUNG.md`** hineinkopieren — allerdings
**ohne** die ersten Zeilen bis zur Trennlinie `---`. Die sind nur diese Erklärung.

Speichern.

## 3. Projektwissen hochladen

Im Projekt auf **Dateien hinzufügen** und diese drei Dateien hochladen:

| Datei | Inhalt |
|---|---|
| `WISSEN-01-Projektstand.md` | Ziel, Stand, Entscheidungen, Roadmap, Risiken |
| `WISSEN-02-Technik-und-Regeln.md` | Architektur, Fallstricke, Befehle |
| `WISSEN-03-PowerSync-Einrichtung.md` | Einrichtung der Synchronisierung |

## 4. Prüfen, ob es sitzt

Neue Unterhaltung im Projekt starten und fragen:

> Warum darf im Upload-Connector kein `.select()` verwendet werden?

**Erwartet:** Claude erklärt, dass `RETURNING` die Leseregel auslöst, die beim
ersten Haushalt noch nicht erfüllbar ist. Kommt stattdessen eine allgemeine
Antwort über Datenbanken, wurde das Projektwissen nicht geladen — dann die
Dateien erneut hochladen.

## Wann diesen Ordner aktualisieren

Nach jedem größeren Schritt: `PROJEKT.md` und `CLAUDE.md` im Projektstamm ändern
sich, die Kopien hier werden neu erzeugt, und die geänderte Datei wird im
Claude-Projekt ersetzt. Das Hochladen ersetzt die alte Fassung nicht automatisch —
alte Datei entfernen, neue hochladen.
