# lifebook-album — Ansichtsseite für Gastfreigaben

Diese drei Dateien sind die komplette Ansichtsseite, die Großeltern und
Geschwister sehen, wenn sie einen Freigabe-Link öffnen. Sie liegt **nicht** bei
Supabase, sondern bei Vercel.

Veröffentlicht unter: `https://lifebook-album-dabbly.vercel.app`
Linkform: `https://lifebook-album-dabbly.vercel.app/a/<zugangsschlüssel>`

## Warum nicht bei Supabase

Am 15.08.2026 auf dem Gerät festgestellt und in der Supabase-Dokumentation
bestätigt: Supabase liefert HTML von einer `supabase.co`-Adresse absichtlich
abgeschottet aus (`default-src 'none'`, Sandbox, kein eigener Ursprung). Folge
waren Quelltext statt Seite, zerlegte Umlaute und blockierte Cookies. Daten
auszuliefern ist erlaubt, Seiten nicht.

Deshalb die Teilung: Die Edge Function `album` prüft Zugangsschlüssel,
Zugangscode und Gerätegrenze und liefert die Bildadressen als Daten. Diese Seite
stellt sie dar. Sie hält **kein einziges Geheimnis** — sie reicht nur weiter, was
der Besucher eingibt.

## Warum ohne Framework

Kein React, kein Next, keine einzige Abhängigkeit. Es gibt nichts zu bauen und
damit nichts, was beim Bauen kaputtgehen kann. Der gesamte Betrachter ist eine
lesbare Datei.

## Veröffentlichen

Die Seite wurde direkt aus der Cowork-Sitzung veröffentlicht. Alternativ über die
Vercel-Oberfläche: Projekt `lifebook-album` im Team `dabbly`, Dateien hochladen.

**Wichtig:** Bei neuen Vercel-Projekten ist „Deployment Protection" (Vercel
Authentication) standardmäßig an. Sie muss aus bleiben, sonst landen Besucher auf
einer Vercel-Anmeldeseite. Der Schutz des Albums liegt im Zugangsschlüssel, im
Zugangscode und in der Gerätegrenze, nicht bei Vercel.

## Wenn die Adresse sich ändert

Zum Beispiel bei einer eigenen Domain: In der App gibt es dafür genau eine
Stelle — `SHARE_VIEWER_BASE_URL` in `src/features/shares/logic.ts`.
