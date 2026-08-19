# LifeBook — Skill

Ergänzung zu `CLAUDE.md`. Während `CLAUDE.md` regelt, WIE gearbeitet wird
(Architekturregeln, Fallstricke, Berichtsformat), regelt diese Datei, WANN
etwas fertig ist.

## Definition of Done

Diese Kriterien sind bindend. **Ohne erfüllte Kriterien darf nichts als
„fertig" gemeldet werden.** Ist ein Kriterium offen, lautet die Meldung
nicht „fertig", sondern nennt ausdrücklich das offene Kriterium — im
Berichtsformat aus `CLAUDE.md` also `STATUS: blockiert` und unter `OFFEN:`
die Zeile, die noch fehlt.

Das gilt auch dann, wenn der Code sauber ist, `tsc` und die Tests
durchlaufen und der Fingerabdruck stimmt. Diese Prüfungen sind
Voraussetzung, nicht Beweis: Sie sagen, dass nichts kaputt ist, nicht dass
etwas fertig ist. Ein Kriterium, das nur auf einem echten Gerät oder in
einer fremden Konsole prüfbar ist, kann eine KI-Sitzung in aller Regel
nicht selbst abhaken — dann wird es als offen gemeldet, nicht
stillschweigend als erfüllt angenommen.

### Feature fertig, wenn

- [ ] Code in `main` gemergt
- [ ] auf echtem Android-Gerät getestet (nicht nur Expo Go, nicht nur Web)
- [ ] deutsche UND englische Strings vorhanden
- [ ] RLS-Policy für neue Tabellen gesetzt und geprüft
- [ ] `versionCode` erhöht

### Release fertig, wenn

- [ ] EAS-Build hochgeladen und in der Play Console freigegeben
- [ ] `app_config.latest_version_code` in Supabase gesetzt
- [ ] Ankündigung an die Tester-Google-Group raus

### Bugfix fertig, wenn

- [ ] Ursache benannt, nicht nur Symptom weg
- [ ] Reproduktionsschritt vor dem Fix dokumentiert
- [ ] derselbe Schritt nach dem Fix erfolgreich

### Meilenstein „Umsatz" erreicht, wenn

- [ ] ein Kauf von einem Konto, das weder dem Auftraggeber gehört noch
      Tester ist, in der Tabelle `purchases` als verifiziert liegt

## Anmerkungen zum Stand (17.08.2026)

Zwei Kriterien beschreiben einen Sollzustand, der im Projekt noch nicht
eingerichtet ist. Sie stehen bewusst trotzdem hier — sie sind das Ziel,
und ein Kriterium, das man noch nicht erfüllen kann, ist ein offenes
Kriterium, kein falsches.

**`versionCode`.** In `app.json` gibt es kein Feld `versionCode`, und dort
gehört auch keines hin: `eas.json` steht auf `"appVersionSource": "remote"`
mit `"autoIncrement": true` im `production`-Profil. Die Build-Nummer wird
damit von EAS serverseitig geführt und bei jedem Produktions-Build selbst
hochgezählt. Das Kriterium ist deshalb oben als „`versionCode` erhöht"
formuliert statt als „`versionCode` in `app.json` erhöht" — wo die Zahl
liegt, ist eine Einrichtungsfrage, dass sie steigt, ist die eigentliche
Bedingung. Soll sie stattdessen in `app.json` gepflegt werden, muss
vorher `appVersionSource` auf `local` umgestellt werden; ohne diese
Umstellung wäre ein Feld in `app.json` wirkungslos.

**Mehrsprachigkeit.** `CLAUDE.md` schreibt bislang „sichtbare Texte auf
Deutsch, Code und Kommentare auf Englisch" fest, und `src/core/i18n` ist
nicht ausgebaut. Das Kriterium „deutsche UND englische Strings" verlangt
also einen Schritt, den das Projekt noch vor sich hat.

**Nicht geprüft.** Ob die Tabellen `app_config` und `purchases` in
Supabase bereits existieren, wurde in dieser Sitzung nicht verifiziert.
