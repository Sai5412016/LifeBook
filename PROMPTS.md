# Fertige Prompts für Claude Code

Zum Kopieren ins Terminal-Claude-Code. Jeder Prompt ist eigenständig — Claude Code
liest `CLAUDE.md` im Projektstamm automatisch und kennt damit Architekturregeln und
Fallstricke, ohne dass sie hier wiederholt werden müssen.

## Modellwahl

Modell wechseln mit `/model` in Claude Code.

| Situation | Modell | Warum |
|---|---|---|
| Klar umrissene Aufgabe, Muster existiert schon | **Sonnet 5** | Schnell, günstiger, reicht völlig |
| Bildschirme und Komponenten nach Vorgabe bauen | **Sonnet 5** | Handwerk, keine Architekturfragen |
| Tests schreiben, Umbenennen, Aufräumen | **Sonnet 5** | Mechanisch |
| Fehlersuche über mehrere Systeme hinweg | **Opus 5** | Braucht Hypothesenbildung statt Mustererkennung |
| Architektur, Datenmodell, Zugriffsregeln | **Opus 5** | Fehler hier kosten Wochen |
| Datenschutz- und Sicherheitsbewertung | **Opus 5** | Folgen sind rechtlich, nicht nur technisch |

Faustregel: **Weißt du schon, wie das Ergebnis aussehen soll, nimm Sonnet 5.
Musst du es erst herausfinden, nimm Opus 5.** Der Preisunterschied ist gering
(3 gegen 5 Dollar je Million Eingabe-Token), der Unterschied bei verkorkster
Architektur nicht.

Die `upsert`-Falle aus diesem Projekt ist ein Opus-Fall gewesen: Vier plausible
Erklärungen waren falsch, die richtige kam erst durch systematisches Testen gegen
die echte Datenbank.

---

## Prompt 1 — Vollbildansicht und Löschen

**Modell: Sonnet 5.** Das Muster steht, die Bausteine existieren, es ist reine
Umsetzungsarbeit.

```
Baue Stufe 2 der Fotochronik: Vollbildansicht und Löschen.

AUSGANGSLAGE
Die Chronik unter src/app/(tabs)/index.tsx zeigt Fotos als Kacheln. Antippen tut
bisher nichts. Löschen gibt es nur in der Datenschicht, ohne Bedienoberfläche.

Bereits vorhanden und zu verwenden, nicht neu zu bauen:
- softDeletePhoto() in src/features/photos/repository.ts
- removeStoredObjects() in src/features/photos/storage.ts (aktuell ungenutzt)
- createSignedUrls() in src/features/photos/storage.ts
- useSignedUrls() in src/features/photos/hooks.ts

AUFGABE
1. Neue Route src/app/foto/[id].tsx: Foto formatfüllend auf dunklem Grund.
   Quelle ist das Original über original_key als signierte URL; solange
   local_uri gesetzt ist, stattdessen die lokale Datei verwenden.
2. Kachel in der Chronik antippbar machen, führt zu dieser Route.
3. In der Vollbildansicht eine Kopfzeile mit Zurück, Aufnahmedatum und
   Altersangabe (formatDayLabel und formatAgeLabel aus dem Bestand).
4. Löschen-Knopf mit Rückfrage. Bei Bestätigung: softDeletePhoto aufrufen,
   danach removeStoredObjects mit thumb_key und original_key, danach zurück
   zur Chronik.
5. Ist local_uri noch gesetzt, zusätzlich die lokale Datei mit deleteQuietly
   entfernen, damit nichts liegen bleibt.

REGELN
- Datenzugriff ausschließlich über das Repository.
- Sichtbare Texte auf Deutsch.
- Löschen ist ein weiches Löschen in der Datenbank; die Dateien im Speicher
  werden hart entfernt. Schlägt das Entfernen der Dateien fehl, darf das den
  Löschvorgang nicht abbrechen — protokollieren und weitermachen.
- Reine Logik testbar halten, Gerätecode getrennt.

ABNAHME
- npx tsc --noEmit läuft sauber.
- npx vitest run läuft sauber.
- Neue reine Logik ist durch Tests abgedeckt.
Zeige mir am Ende eine Liste der geänderten Dateien mit je einem Satz, was
sich geändert hat.
```

---

## Prompt 2 — Serienbilder stapeln

**Modell: Opus 5.** Hier wird ein Verfahren entworfen, nicht ein Muster
angewendet. Schwellenwerte falsch gewählt heißt: entweder es stapelt nichts oder
es stapelt Bilder zusammen, die nichts miteinander zu tun haben.

```
Baue Stufe 3 der Fotochronik: ähnliche Bilder erkennen und stapeln.

ZIEL
Serienaufnahmen (acht fast gleiche Bilder in zehn Sekunden) sollen in der
Chronik als EIN Stapel erscheinen. Antippen öffnet den Stapel, ein Bild lässt
sich als bestes markieren, der Rest bleibt erhalten, aber eingeklappt.

ABGRENZUNG ZUM BESTAND
Exakte Dubletten werden bereits über content_hash beim Import verworfen. Hier
geht es um ÄHNLICHE, nicht identische Bilder. Das ist ein anderes Verfahren.

VORGEHEN
1. Entwirf zuerst das Verfahren und begründe es, bevor du Code schreibst:
   Welcher Wahrnehmungs-Hash, welche Distanz, welcher Schwellenwert, wie fließt
   der zeitliche Abstand der Aufnahmen ein? Erkläre die Fehlerfälle in beide
   Richtungen.
2. Reine Logik in src/features/photos/similarity.ts, vollständig testbar ohne
   Gerät, mit Tests für Grenzfälle.
3. Berechnung des Hashes auf dem Gerät in src/features/photos/media.ts.
4. Neue Spalten im Schema NUR wenn nötig; wenn ja, sowohl in
   src/core/db/schema.ts als auch als Migration für Postgres, und sag mir
   ausdrücklich Bescheid, weil ich die Migration einspielen muss.
5. Bestandsfotos müssen nachträglich verarbeitet werden können.

REGELN
- Datenzugriff ausschließlich über das Repository.
- Kein Netzwerkaufruf für die Ähnlichkeitsberechnung, alles auf dem Gerät.
- Sichtbare Texte auf Deutsch.

ABNAHME
- npx tsc --noEmit und npx vitest run laufen sauber.
- Die Schwellenwerte sind im Code begründet, nicht bloß gesetzt.
Beginne mit dem Entwurf und warte auf meine Zustimmung, bevor du Code schreibst.
```

---

## Wie wir das gemeinsam nutzen

Ich schreibe neue Prompts in diese Datei, sobald ein Schritt ansteht. Du kopierst
sie ins Terminal. Was zurückkommt — Fehler, Fragen, Entscheidungen — bringst du
hierher oder ins Claude-Projekt.

Sinnvolle Trennung: **Claude Code baut, wenn klar ist was zu bauen ist.** Alles
davor (Was bauen wir? Warum so? Was übersehen wir?) und alles, was mehrere
Systeme berührt, läuft weiter über die Cowork-Aufgabe, weil dort der Zugriff auf
Supabase, die Datenbank und die echten Zugriffsregeln besteht.
