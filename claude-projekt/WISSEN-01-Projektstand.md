# LifeBook — Stand, Entscheidungen, Ziele

Stand: 09.08.2026

## Ziel

Eine App, die Eltern den Alltag mit einem Neugeborenen abnimmt statt ihn zu
verwalten. Zwei Elternteile, ein Haushalt, dieselben Daten auf beiden Handys —
auch nachts um drei ohne Netz. Erste echte Nutzer: die eigene Familie, Kind
Marina Philomena, geboren am 05.08.2026.

Langfristig ein abonnementbasiertes Produkt. Kurzfristig geht es um etwas
anderes: eine App, die im eigenen Alltag wirklich benutzt wird. Was dort nicht
trägt, trägt bei Fremden erst recht nicht.

## Was funktioniert

| Bereich | Stand |
|---|---|
| Anmeldung, Registrierung, Abmeldung | fertig, auf Gerät getestet |
| Verschlüsselte lokale Datenbank | fertig (SQLCipher, Schlüssel im sicheren Speicher) |
| Synchronisierung in beide Richtungen | fertig, Ende-zu-Ende bewiesen |
| Haushalt und Kind anlegen | fertig |
| Zugriffsregeln in der Datenbank | fertig, gegen echte Datenbank geprüft |
| Fotochronik: Import, Dubletten, Cloud, Zeitleiste | gebaut, Gerätetest offen |
| Zugangsdaten in EAS hinterlegt | erledigt (`preview` und `production`) |
| Eigenständiger Build ohne Notebook | Build läuft |
| Funkupdates | konfiguriert, ab diesem Build aktiv |
| Automatik bei Code-Push | Ablaufdatei liegt bereit, GitHub-Anbindung offen |

Beweis für die Synchronisierung: Ein am 08.08. um 18:27 Uhr lokal angelegter
Haushalt wurde über einen Tag später hochgeladen — mit korrektem
Original-Zeitstempel, ohne Verlust, ohne Duplikat.

## Was bewusst noch fehlt

Vollbildansicht für Fotos, Löschen aus der Oberfläche heraus, Stapel für
Serienbilder. Sämtliche Tracking-Funktionen (Füttern, Schlafen, Wickeln) sind
als Datenmodell vorhanden, aber ohne Oberfläche.

## Getroffene Entscheidungen

**Fotos statt Tracking zuerst.** Fotos sind zeitkritisch und unersetzbar — Tag 4
lässt sich nicht nachholen. Fütterungsdaten schon.

**Originale in die Cloud, nicht nur Vorschaubilder.** Ursprünglich sah die Spec
vor, Originale auf dem Gerät zu lassen. Das scheitert an der eigentlichen
Anforderung: Beide Elternteile brauchen Zugriff auf das volle Bild, nicht nur auf
eine Vorschau.

**Supabase Storage statt Cloudflare R2.** R2 ist bei großem Volumen günstiger
(0,015 $/GB, keine Ausgangsgebühren gegenüber 0,0213 $/GB plus 0,09 $/GB
Ausgang). Dafür spart Supabase Storage erhebliche Bauarbeit: Zugriffsregeln über
dieselben Hilfsfunktionen wie die restliche Datenbank, signierte URLs,
fortsetzbare Uploads — alles vorhanden. Der Pro-Tarif deckt mit 100 GB Speicher
und 250 GB Ausgang die ersten Nutzer vollständig ab. Der Wechsel zu R2 bleibt
möglich, weil der Speicherzugriff hinter dem Repository gekapselt ist.

**Systemauswahl statt Galeriezugriff.** Auf Android 13+ läuft die Fotoauswahl in
einem eigenen Systemprozess. Die App fragt nie nach Zugriff auf die gesamte
Galerie. Datensparsamkeit durch Bauweise.

**Google Photos ist keine Option.** Seit dem 31.03.2025 hat Google die
Bibliotheks-Berechtigungen abgeschaltet. Apps sehen nur noch selbst erstellte
Medien. Eine automatische Chronologie aus Google Photos ist technisch unmöglich,
nicht bloß aufwendig.

**Keine Gesichtserkennung.** Gesichtsmerkmale sind biometrische Daten nach
Art. 9 DSGVO, lösen bei Kindern mit hoher Wahrscheinlichkeit eine
Datenschutz-Folgenabschätzung aus und bringen Transparenzpflichten nach dem
AI Act. Aufwand steht in keinem Verhältnis zum Nutzen.

## Roadmap

**Stufe 1 — erledigt.** Fotoimport, Dublettenerkennung, Cloud-Speicherung,
Zeitleiste mit Altersangabe.

**Stufe 2 — als Nächstes.** Vollbildansicht, Löschen, eigenständige Installation
auf beiden Handys.

**Stufe 3.** Serienbilder erkennen und stapeln (Wahrnehmungs-Hash, nicht bloß
Prüfsumme), bestes Bild auswählen.

**Stufe 4.** Erste Tracking-Funktion: Füttern mit Timer, danach Schlafen und
Wickeln nach demselben Muster.

**Stufe 5.** Partner einladen, mehrere Kinder, Rollen.

## Offene Risiken

**Rechtlich, vor jeder Veröffentlichung:** Auftragsverarbeitungsvertrag mit
Supabase, Speicherort auf die EU festlegen, Datenschutzerklärung, Impressum,
Data-Safety-Formular im Play Store. Solange nur die eigene Familie testet,
unkritisch.

**Play Store:** Privatkonten, die nach dem 13.11.2023 erstellt wurden, brauchen
vor der Produktionsfreigabe einen geschlossenen Test mit 12 Testern über
14 zusammenhängende Tage. Firmenkonten mit D-U-N-S-Nummer sind befreit.

**Speicherkosten** sind die einzige echte Grenzkostenposition: rund 22 GB pro
Kind und Jahr bei 15 Fotos täglich. Ein kostenloser Tarif mit vollem
Original-Backup wäre ein Geschäftsmodellrisiko.

**Videos** sind bewusst ausgeschlossen. 4K-Video liegt bei rund 300 MB pro
Minute und würde die Kostenrechnung um Faktor 50 verschieben.

## Auslieferung

Die App wird **direkt installiert**, nicht über einen Store. Bewusste
Entscheidung: kein Entwicklerkonto, keine Prüfung, keine Datenschutzerklärung
nötig, solange nur die eigene Familie sie nutzt.

| Weg | Wofür |
|---|---|
| `eas build --profile preview --platform android` | Neue APK, nötig bei nativen Änderungen |
| `eas update --branch preview -m "..."` | Funkupdate für JavaScript, Texte, Layout |
| Push auf `main` bei GitHub | löst das Funkupdate automatisch aus |

**Wichtig:** `.env` ist von Git ausgeschlossen und wird deshalb nicht zu EAS
hochgeladen. Die Zugangsdaten liegen als EAS-Umgebungsvariablen. Ohne sie
baut EAS eine App ohne Backend-Adresse — sie startet, versagt aber bei jeder
Anmeldung, und der Fehler steht nirgends im Code.

## Kosten heute

Expo Free: 15 Android-Builds monatlich, Funkupdates bis 1.000 aktive Nutzer.
Supabase: aktuell im kostenlosen Rahmen. Direktinstallation auf die eigenen
Handys: keine Store-Gebühren.
