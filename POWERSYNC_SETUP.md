# PowerSync Cloud — Einrichtung (einmalig)

Deine Supabase-DB ist fertig provisioniert. Jetzt fehlt die PowerSync-Instanz, die
zwischen Supabase (Postgres) und der App synchronisiert. Das machst du im
PowerSync-Dashboard — Schritt für Schritt.

## Was du dafür aus Supabase brauchst

| Wert | Wo in Supabase |
|---|---|
| DB-Connection-String | Projekt `lifebook` → **Connect** (oben) → **Direct connection** / **Session pooler** |
| DB-Passwort | Beim Projekt-Setup vergeben. Falls unbekannt: Settings → **Database** → **Reset database password** |
| JWKS-URL (Auth) | `https://qjoujiyzthzwkqhildub.supabase.co/auth/v1/.well-known/jwks.json` |

Publication ist bereits angelegt: **`powersync`** (musst du nur auswählen, nicht erstellen).

## Schritte

1. **Account:** Gehe zu https://www.powersync.com → **Sign up** (Free-Tier reicht für Phase 1).

2. **Instanz erstellen:** Dashboard → **Create instance** → Name z. B. `lifebook` → Region **EU** (Frankfurt/Ireland, nah an Supabase Frankfurt).

3. **Datenbank verbinden:** In der Instanz → **Connections** → **Add connection** → Typ **Postgres / Supabase**.
   - Connection-String aus Supabase einfügen (Host `db.qjoujiyzthzwkqhildub.supabase.co`, Port `5432`, DB `postgres`, User `postgres`, dein DB-Passwort).
   - **Publication:** `powersync` auswählen.
   - **Test connection** → sollte grün sein.

4. **Client-Auth (JWT):** In der Instanz → **Client Auth** (oder **Settings → Auth**) → **Supabase Auth** aktivieren.
   - JWKS-URL eintragen: `https://qjoujiyzthzwkqhildub.supabase.co/auth/v1/.well-known/jwks.json`
   - Audience: `authenticated`.

5. **Sync Rules:** In der Instanz → **Sync Rules** → Inhalt von **`sync-rules.yaml`** (liegt im Projekt-Root) komplett einfügen → **Deploy**.

6. **Instanz-URL kopieren:** Oben in der Instanz steht die URL, z. B.
   `https://xxxxxxxxxxxx.powersync.journeyapps.com`.
   Diese in die Datei **`.env`** eintragen bei `EXPO_PUBLIC_POWERSYNC_URL=`.

## Erwartetes Ergebnis

- Connection grün, Sync Rules deployed, `.env` enthält die PowerSync-URL.
- Damit ist das Backend komplett. Der nächste Schritt (Client-Wiring) ist schon
  im Code vorbereitet (`src/core/db`, `src/core/sync/connector.ts`) — er verbindet
  sich automatisch, sobald ein Nutzer eingeloggt ist und diese URL gesetzt ist.

## Typische Fehlerquellen

- **Connection schlägt fehl:** meist falsches DB-Passwort oder Port. Nutze den
  **Session Pooler** (Port 5432/6543) wenn die Direktverbindung blockt.
- **„No publication named powersync":** du bist auf der falschen DB/Projekt —
  achte auf Host `...qjoujiyzthzwkqhildub...`.
- **Auth-Fehler beim Sync:** JWKS-URL falsch oder Audience ≠ `authenticated`.
