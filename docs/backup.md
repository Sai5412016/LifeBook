# Datenbank-Sicherung (wöchentlich, verschlüsselt)

Seit dem Umzug in den kostenlosen Supabase-Plan gibt es keine automatischen
Backups mehr. Der GitHub-Workflow `.github/workflows/db-backup.yml` ersetzt sie:
Er sichert die komplette LifeBook-Datenbank (alle Tabellen, auch die
Anmeldekonten), verschlüsselt die Sicherung und legt sie im Cloudflare-Bucket
`lifebook-backups` ab. Dort wird jede Sicherung nach 56 Tagen automatisch
gelöscht.

**Wichtig vorab:**
- Die Fotos selbst sind **nicht** in dieser Sicherung. Sie liegen im
  Foto-Speicher. Für sie gibt es „Alle Fotos sichern“ in der App und das
  Skript `sichern.ps1` auf G:.
- Die Sicherung kann **nur mit deinem privaten Schlüssel** wieder geöffnet
  werden. Geht der verloren, sind alle Sicherungen wertlos. Schritt 1 ist
  deshalb der wichtigste.

Alle Schritte unten sind für Windows. Rechne mit etwa 30 Minuten.

---

## 1. Schlüsselpaar erzeugen (einmalig)

1. Startmenü → „Terminal“ eingeben → **Terminal** öffnen.
2. Das Programm `age` installieren:
   ```
   winget install FiloSottile.age
   ```
   Danach das Terminal schließen und neu öffnen, damit der Befehl gefunden wird.
3. In einen Ordner wechseln, der NICHT synchronisiert wird (nicht OneDrive), zum Beispiel:
   ```
   cd $env:USERPROFILE\Desktop
   ```
4. Das Schlüsselpaar erzeugen:
   ```
   age-keygen -o lifebook-backup-schluessel.txt
   ```
   Ausgabe: `Public key: age1…` — das ist der **öffentliche** Schlüssel.
   Die Datei `lifebook-backup-schluessel.txt` enthält den **privaten** Schlüssel
   (Zeile `AGE-SECRET-KEY-1…`).
5. Den öffentlichen Schlüssel (die ganze Zeile ab `age1`) notieren. Er kommt in
   Schritt 2 als Secret `AGE_PUBLIC_KEY` zu GitHub. Er ist nicht geheim.
6. Den **privaten** Schlüssel doppelt sichern:
   - **Passwortmanager:** neuen Eintrag „LifeBook Backup-Schlüssel“ anlegen und
     die Datei `lifebook-backup-schluessel.txt` als Anhang speichern, oder ihren
     Inhalt in ein Notizfeld kopieren.
   - **Offline-Kopie:** die Datei auf einen USB-Stick kopieren, der zu Hause an
     einem sicheren Ort liegt, oder den Inhalt ausdrucken und abheften.
7. Erst wenn beide Kopien da sind: die Datei vom Desktop löschen und den
   Papierkorb leeren. Der private Schlüssel gehört **nie** zu GitHub, in eine
   E-Mail oder in einen Chat.

---

## 2. Secrets bei GitHub eintragen

Ort: GitHub → Repository **Sai5412016/LifeBook** → **Settings** → links
**Secrets and variables** → **Actions** → Knopf **New repository secret**.
Für jedes der sechs Secrets: Name exakt wie unten eintippen, Wert einfügen,
**Add secret**.

| Name | Wert | Wo du ihn findest |
|---|---|---|
| `BACKUP_DB_URL` | Verbindungsadresse der Datenbank | siehe 2a |
| `R2_ENDPOINT` | `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` | siehe 2b |
| `R2_ACCESS_KEY_ID` | Access Key ID des R2-Tokens | siehe 2c |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key des R2-Tokens | siehe 2c |
| `R2_BUCKET` | `lifebook-backups` | genau so eintragen |
| `AGE_PUBLIC_KEY` | die Zeile `age1…` aus Schritt 1 | Schritt 1, Punkt 5 |

### 2a. `BACKUP_DB_URL` (Supabase)

1. supabase.com/dashboard → Projekt **lifebook** öffnen.
2. Oben auf **Connect** klicken.
3. Im Fenster den Abschnitt **Session pooler** suchen (nicht „Direct connection“,
   nicht „Transaction pooler“). Format **URI** wählen.
4. Die Adresse kopieren. Sie sieht so aus:
   `postgresql://postgres.qjoujiyzthzwkqhildub:[YOUR-PASSWORD]@aws-….pooler.supabase.com:5432/postgres`
5. `[YOUR-PASSWORD]` samt eckigen Klammern durch das **Datenbank-Passwort** ersetzen.
   - Kennst du es nicht: Project Settings → **Database** → **Reset database password**.
     Achtung: Die App ist davon nicht betroffen, PowerSync aber schon, falls
     dort dasselbe Passwort eingetragen ist. Dann dort ebenfalls ändern.
   - Enthält das Passwort Sonderzeichen wie `@ : / ? # %`, ein neues Passwort
     nur aus Buchstaben und Ziffern wählen. Sonst ist die Adresse ungültig.
6. Die fertige Adresse als Secret `BACKUP_DB_URL` eintragen.

### 2b. `R2_ENDPOINT` (Cloudflare)

1. dash.cloudflare.com → links **R2 Object Storage** → **Overview**.
2. Rechts im Kasten **Account Details** steht die **Account ID**.
3. Den Wert so zusammensetzen (mit `.eu.`, weil der Bucket in der EU liegt,
   ohne Schrägstrich am Ende, ohne Bucket-Namen):
   `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`

### 2c. `R2_ACCESS_KEY_ID` und `R2_SECRET_ACCESS_KEY` (Cloudflare)

Die beiden Werte gehören zum bereits angelegten, auf die Buckets beschränkten
API-Token. Cloudflare zeigt den Secret Access Key **nur einmal** beim Anlegen.

- Hast du sie gespeichert: von dort übernehmen.
- Sonst ein neues Token anlegen: R2 → **Overview** → **Manage API tokens** →
  **Create API token** → Berechtigung **Object Read & Write** → unter
  „Specify bucket(s)“ nur **lifebook-backups** wählen → **Create**.
  Die angezeigten Werte **Access Key ID** und **Secret Access Key** sofort
  in GitHub eintragen (und im Passwortmanager ablegen).

---

## 3. Ersten Lauf von Hand starten

1. GitHub → Repository → Reiter **Actions** → links **DB-Backup**.
2. Rechts **Run workflow** → **Run workflow**.
3. Nach 2–5 Minuten muss der Lauf grün sein. In der Zusammenfassung des Laufs
   stehen Dateiname, Größe und Prüfsumme.
4. Kontrolle bei Cloudflare: R2 → Bucket **lifebook-backups** → Ordner `db/` →
   dort liegt `lifebook-db-JJJJ-MM-TT_HHMM.dump.age`.

Ist ein Schritt rot: auf den Lauf klicken, den roten Schritt aufklappen und
die Meldung schicken. Die Meldungen enthalten keine Secrets.

---

## 4. Wöchentlichen Zeitplan einschalten

Erst nach einem grünen Testlauf. In `.github/workflows/db-backup.yml` diese
beiden Zeilen:

```
  # schedule:
  #   - cron: '17 3 * * 0'   # sonntags 03:17 UTC
```

so ändern (jeweils `# ` am Anfang entfernen, die Einrückung bleibt):

```
  schedule:
    - cron: '17 3 * * 0'   # sonntags 03:17 UTC
```

Ab dann läuft die Sicherung jeden Sonntag um 04:17 Uhr (Winterzeit) bzw.
05:17 Uhr (Sommerzeit). Schlägt ein Lauf fehl, schickt GitHub eine E-Mail.

---

## 5. Wiederherstellung testen (einmal nach dem ersten Lauf, dann alle paar Monate)

Eine Sicherung, die nie geöffnet wurde, ist nur eine Vermutung.

1. PostgreSQL-17-Kommandozeilenwerkzeuge installieren:
   ```
   winget install PostgreSQL.PostgreSQL.17
   ```
   Im Installer reicht die Auswahl **Command Line Tools**.
2. Bei Cloudflare: R2 → **lifebook-backups** → `db/` → neueste Datei → **Download**.
3. Im Terminal in den Download-Ordner wechseln und entschlüsseln (Pfad zur
   Schlüsseldatei anpassen, zum Beispiel vom USB-Stick):
   ```
   cd $env:USERPROFILE\Downloads
   age -d -i E:\lifebook-backup-schluessel.txt -o lifebook.dump lifebook-db-JJJJ-MM-TT_HHMM.dump.age
   ```
4. Inhalt prüfen:
   ```
   & "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --list lifebook.dump | Select-String "TABLE DATA public photos"
   ```
   Erwartet: eine Zeile mit `TABLE DATA public photos`. Damit ist belegt, dass
   die Sicherung vollständig lesbar ist.
5. Die entschlüsselte Datei `lifebook.dump` danach löschen und den Papierkorb
   leeren. Sie ist unverschlüsselt und enthält alle Daten.

Eine echte Rückspielung in eine leere Datenbank (zum Beispiel ein neues,
leeres Supabase-Projekt) ist der vollständige Test. Den bitte gemeinsam mit
Claude machen, nicht in das laufende Projekt `lifebook` zurückspielen.
