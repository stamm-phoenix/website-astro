# Datenbank (Azure SQL) und Dateien (Blob Storage)

In einer Azure-SQL-Datenbank liegen (#165) die Daten des Nikolausdienstes (Schema `nikolaus`:
Buchungen, Helfende, Einteilung, Dispo, die Einstellungen der Steuerung und der gemeinsame
Zustand) sowie Blog und Fragen & Antworten (Schema `content`). Dateien wie die Bilder der
Blogbeiträge liegen in Azure Blob Storage ([Blob Storage](#blob-storage)). Die übrigen Inhalte
liegen vorerst weiter in SharePoint. PR-Previews haben je eine eigene Datenbank und einen
eigenen Blob-Container mit Testdaten ([Previews](#previews)).

| Was | Wo |
| --- | --- |
| Server und Datenbankname | `CONFIG.database` in `api/lib/config.ts` |
| Schema | `api/migrations/*.sql`, Typen für den Code in `api/lib/db-schema.ts` |
| Zugriff im Code | `api/lib/db.ts` (Kysely mit tedious, Anmeldung mit dem Zertifikat der App-Registrierung) |
| Migrationen ausführen | `api/scripts/db-migrate.ts`, im Deploy-Job auf `main` |
| Datenbanken der Previews | `api/scripts/db-preview.ts`, im Deploy-Job eines PRs |
| Tests | gegen einen SQL-Server-Container, siehe [Tests](#tests) |
| Blob Storage | `CONFIG.storage` in `api/lib/config.ts`, Zugriff in `api/lib/blob-storage.ts` |

## Ressourcen anlegen

Einmalig, im Azure-Portal mit einem Konto, das in der Subscription Ressourcen anlegen darf.
Alles kommt in die Ressourcengruppe `website-astro`, in der auch die Static Web App liegt.

### 1. Gruppe für die Datenbank-Admins

In Entra ID eine Sicherheitsgruppe anlegen, z. B. **Website SQL Admins**, und die Personen
aufnehmen, die das Schema verwalten dürfen (zunächst Nico). Eine Gruppe statt einer Person als
Admin erlaubt später Wechsel ohne Änderung am Server.

### 2. Logischen SQL-Server anlegen

Portal → **SQL servers** → **Create**:

- **Resource group:** `website-astro`
- **Server name:** `stamm-phoenix-website` (der Name ist weltweit eindeutig; ist er vergeben,
  einen anderen wählen und `CONFIG.database.server` anpassen)
- **Location:** Germany West Central (Daten in Deutschland; die Functions in West Europe
  brauchen dadurch pro Abfrage nur wenige Millisekunden länger)
- **Authentication method:** *Use Microsoft Entra-only authentication*
- **Microsoft Entra admin:** die Gruppe aus Schritt 1

Reiter **Networking**:

- **Connectivity method:** Public endpoint
- **Allow Azure services and resources to access this server:** **Yes**. Die Functions der
  Static Web App haben keine festen ausgehenden IP-Adressen und keine Managed Identity, deshalb
  geht es nicht enger. Geschützt ist die Datenbank durch die Entra-Anmeldung: Ohne Benutzer in
  der Datenbank kommt niemand hinein, auch nicht aus Azure.
- **Add current client IP address:** Yes, damit du lokal migrieren und Daten ansehen kannst.
  Weitere Adressen später unter *Networking* des Servers.
- **Minimum TLS version:** 1.2

### 3. Datenbank anlegen

Am neuen Server → **Create database**:

- **Database name:** `website` (`CONFIG.database.name`)
- **Want to use SQL elastic pool?** No
- **Workload environment:** Production
- **Compute + storage:** *Configure database* → **Standard S1** (DTU-Modell, 20 DTU). Läuft
  ständig, also ohne Kaltstart, und reicht für unsere Datenmenge mit viel Reserve. Kein
  Serverless mit Auto-Pause: Der erste Zugriff nach einer Pause dauert bis zu einer Minute,
  das Buchungsformular würde so lange hängen.
- **Backup storage redundancy:** Geo-redundant (Kopien in der gepaarten Region Germany North,
  also ebenfalls in Deutschland)

Nach dem Anlegen unter **Data management → Backups → Retention policies** die
Point-in-Time-Aufbewahrung auf **7 Tage** prüfen und keine Langzeitaufbewahrung einrichten.
Die 7 Tage stehen so in der Datenschutzerklärung (`/datenschutz#nikolaus`): Gelöschte
Buchungen sind danach auch aus den Sicherungen verschwunden.

### 4. Zugriff der Website

Die Website meldet sich mit ihrer App-Registrierung an (Client-ID
`5dd5864b-e2c3-4c21-9ef2-8bb3290cd374`, dasselbe Zertifikat `AZURE_CLIENT_CERT` wie für
SharePoint). Sie darf nur lesen und schreiben, nicht das Schema ändern.

Portal → Datenbank `website` → **Query editor**, mit deinem Entra-Konto anmelden (du bist über
die Gruppe Admin) und ausführen, mit dem Anzeigenamen der App-Registrierung:

```sql
CREATE USER [<Anzeigename der App-Registrierung>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<Anzeigename der App-Registrierung>];
ALTER ROLE db_datawriter ADD MEMBER [<Anzeigename der App-Registrierung>];
```

Meldet der Server, er könne den Namen nicht auflösen, den Benutzer über die Objekt-ID der
*Enterprise Application* (nicht der App-Registrierung) anlegen:

```sql
CREATE USER [website-astro] FROM EXTERNAL PROVIDER
  WITH OBJECT_ID = '<Objekt-ID der Enterprise Application>';
```

### 5. Identität für Migrationen (GitHub Actions)

Migrationen laufen im Deploy-Job auf `main` mit einer eigenen Identität, die das Schema ändern
darf. Sie braucht kein Secret, GitHub meldet sich per OIDC an.

1. Entra ID → **App registrations** → **New registration**, Name z. B.
   `website-astro-db-migrations`, sonst Standardwerte. Die **Application (client) ID** notieren.
2. In der neuen Registrierung → **Certificates & secrets** → **Federated credentials** →
   **Add credential** → *GitHub Actions deploying Azure resources*:
   - Organization `stamm-phoenix`, Repository `website-astro`
   - Entity type **Branch**, Branch `main`
3. Im Query editor der Datenbank:

   ```sql
   CREATE USER [website-astro-db-migrations] FROM EXTERNAL PROVIDER;
   ALTER ROLE db_owner ADD MEMBER [website-astro-db-migrations];
   ```

4. GitHub → Repository → **Settings → Secrets and variables → Actions → Variables**:
   - `SQL_MIGRATION_CLIENT_ID` = Client-ID aus Schritt 1
   - `ENTRA_TENANT_ID` = `0e650e3e-3da0-4a47-bf6c-df3dd3980caa`, falls noch nicht vorhanden
     (wird schon für die Preview-Anmeldung verwendet)

Fehlt `SQL_MIGRATION_CLIENT_ID`, schlägt der Deploy-Job auf `main` absichtlich fehl, bevor er
Code ausrollt, der ein noch nicht angelegtes Schema braucht. Die bisherige Version bleibt dann
online.

### 6. Erste Migration von Hand

Vor dem Merge einmal lokal ausführen, damit Preview und Produktion das Schema schon haben
(dafür braucht deine IP-Adresse die Firewall-Regel aus Schritt 2):

```bash
az login                      # mit deinem Konto aus der Admin-Gruppe
cd api
bun install
bun scripts/db-migrate.ts --dry-run   # zeigt, was angewendet würde
bun scripts/db-migrate.ts
```

Danach gibt es das Schema `nikolaus` mit seinen Tabellen und `dbo.schema_migrations`, in der
jede angewendete Migration mit Prüfsumme steht.

### 7. Prüfen

Die Online-Anmeldung ist in der Steuerung noch aus, deshalb mit den Testdaten prüfen. Der
Wartungsmodus der Steuerung muss aus sein. Lokal mit `api/local.settings.json` (braucht
`AZURE_CLIENT_CERT`):

```bash
cd api
bun scripts/nikolaus-testdata.ts             # füllt alle Slots mit erfundenen Familien
bun scripts/nikolaus-testdata.ts --helfende  # etwa 30 erfundene Helfende
```

Ohne `local.settings.json`, z. B. in der Azure Cloud Shell (angemeldet als Datenbank-Admin):

```bash
bun scripts/nikolaus-testdata.ts --azure-cli
bun scripts/nikolaus-testdata.ts --azure-cli --helfende
```

Dann in der Preview dieses PRs im Leitendenbereich Buchungen, Dispo (speichern), Fahrtansicht
(Besuch abhaken), Helfende und Einteilung (speichern) öffnen, eine Buchung verlegen und eine
absagen. Im Query editor lässt sich der Stand nachsehen:

```sql
SELECT status, COUNT(*) FROM nikolaus.booking GROUP BY status;
SELECT * FROM nikolaus.dispo_visit;
```

Zum Schluss alles wieder entfernen:

```bash
bun scripts/nikolaus-testdata.ts --delete
bun scripts/nikolaus-testdata.ts --helfende --delete
```

(in der Cloud Shell wieder mit `--azure-cli`)

### 8. Aufräumen nach dem Umzug

Die SharePoint-Listen „Nikolaus“, „Nikolaus-Dispo“, „Nikolaus-Helfende“, „Nikolaus-Einteilung“
und „NikolausZustand“ verwendet der Code nicht mehr. Sie enthalten nur Testdaten und können
gelöscht werden. Das App Setting `NIKOLAUS_STATE_SECRET` (Schlüssel für die Adress-Hashes im
Geocoding-Cache) bleibt.

Seit der Nikolaus-Steuerung im Leitendenbereich ([nikolaus-betrieb.md](nikolaus-betrieb.md))
werden außerdem nicht mehr gebraucht: das App Setting `NIKOLAUS_WRITES_ENABLED` (jetzt der
Wartungsmodus), die Repository-Variablen `NIKOLAUS_RETENTION_ENABLED` und
`NIKOLAUS_RETENTION_TARGET_DIGEST` sowie das GitHub-Environment `nikolaus-retention` mit seinem
Secret `AZURE_CLIENT_CERT` (der tägliche Löschlauf ist durch die Knöpfe der Steuerung ersetzt).

### 9. Blog und Fragen & Antworten

Die Migration `0003_blog_faq.sql` legt das Schema `content` an. Die SharePoint-Listen „Blog“
und „Fragen & Antworten“ waren in der Produktion leer und werden nicht mehr verwendet; sie
können gelöscht werden. Die Blog-Bilder brauchen außerdem das Storage-Konto aus
[Blob Storage](#blob-storage), und zwar bevor der Code ausgerollt wird.

## Blob Storage

Dateien liegen in Azure Blob Storage, im Storage-Konto `stammphoenixwebsite` (Container
`website`) für die Produktion und `stammphoenixpreviews` für die Previews (ein Container
`pr-<Nummer>` je PR). Bisher sind das die Bilder der Blogbeiträge unter
`blog/<Beitrag>/<Datei>/<Breite>.jpg`; Downloads und Belege sollen folgen.

- Kein öffentlicher Zugriff und keine Kontoschlüssel: Die Website meldet sich wie bei der
  Datenbank mit dem Zertifikat ihrer App-Registrierung an und liefert die Dateien selbst aus,
  nachdem sie geprüft hat, ob sie gezeigt werden dürfen (z. B. nur Bilder veröffentlichter
  Beiträge).
- Gelöschte Dateien bleiben 7 Tage wiederherstellbar (Soft Delete für Blobs und Container),
  wie die Sicherungen der Datenbank.

### Einrichtung (einmalig)

Mit einem Konto, das in der Subscription Rollen vergeben darf (Owner), z. B. in der Azure
Cloud Shell:

```bash
az provider register -n Microsoft.Storage --wait

for account in stammphoenixwebsite stammphoenixpreviews; do
  az storage account create -g website-astro -n "$account" -l germanywestcentral \
    --sku "$([ "$account" = stammphoenixwebsite ] && echo Standard_ZRS || echo Standard_LRS)" \
    --kind StorageV2 --min-tls-version TLS1_2 --https-only true \
    --allow-blob-public-access false --allow-shared-key-access false
done
az storage account blob-service-properties update -g website-astro -n stammphoenixwebsite \
  --enable-delete-retention true --delete-retention-days 7 \
  --enable-container-delete-retention true --container-delete-retention-days 7
az storage container-rm create -g website-astro --storage-account stammphoenixwebsite -n website

scope() { az storage account show -g website-astro -n "$1" --query id -o tsv; }
# Die Website (auch in Previews mit demselben Zertifikat) liest und schreibt in beiden Konten
for account in stammphoenixwebsite stammphoenixpreviews; do
  az role assignment create --role "Storage Blob Data Contributor" \
    --assignee 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 --scope "$(scope "$account")"
done
# Die Identität der Previews (SQL_PREVIEW_CLIENT_ID) legt Container an und löscht sie, nur
# im Konto der Previews
az role assignment create --role "Storage Blob Data Contributor" \
  --assignee <Client-ID von website-astro-previews> --scope "$(scope stammphoenixpreviews)"
```

Rollen wirken nach einigen Minuten. Zum Ansehen der Dateien braucht auch ein Admin eine
Datenrolle (z. B. „Storage Blob Data Reader“); danach im Portal unter Storage-Konto →
**Storage browser** oder mit dem Azure Storage Explorer.

## Schema ändern

Das Schema gehört dem Repository. Niemand ändert Tabellen von Hand im Portal.

1. Eine neue Datei `api/migrations/NNNN_beschreibung.sql` anlegen, mit der nächsten Nummer.
   Bereits angewendete Dateien nie ändern; der Migrator bricht ab, wenn sich die Prüfsumme einer
   angewendeten Migration geändert hat. `GO` auf einer eigenen Zeile trennt Batches wie in
   sqlcmd (`CREATE SCHEMA` braucht z. B. einen eigenen).
2. `api/lib/db-schema.ts` an die neuen Spalten anpassen.
3. Rückwärtskompatibel ändern (*expand/contract*): Die Migration läuft vor dem Deploy, eine
   Weile arbeitet also noch der alte Code mit dem neuen Schema. Neue Spalten daher mit Default
   oder `NULL`; Spalten erst in einem späteren PR entfernen, wenn kein Code sie mehr liest. Die
   Preview des PRs wendet die Migration vorher schon an ihrer eigenen Datenbank an.
4. Die Tests laufen gegen alle Migrationen; damit ist die neue Datei vor dem Merge geprüft.

Jede Migration läuft in einer eigenen Transaktion. Schlägt ein Batch fehl, bleibt die Datenbank
auf dem alten Stand und der Deploy bricht ab.

## Daten ansehen

Portal → Datenbank → **Query editor** (Entra-Anmeldung) oder Azure Data Studio / die
VS-Code-Erweiterung *SQL Server (mssql)* mit Server `stamm-phoenix-website.database.windows.net`,
Authentifizierung *Microsoft Entra ID*. Wer nur lesen soll, bekommt einen eigenen Benutzer mit
`db_datareader`. Daten nur über die Website ändern; Ausnahmen sind Testdaten und die
Wiederherstellung unten.

## Wiederherstellen

Azure SQL sichert automatisch und stellt jeden Zeitpunkt der letzten 7 Tage wieder her
(Portal → Datenbank → **Restore**). Die Wiederherstellung legt eine **neue** Datenbank an, z. B.
`website-restore-2026-12-06`; die laufende bleibt unverändert. Aus der Kopie dann die
benötigten Zeilen per SQL zurückholen und die Kopie wieder löschen. Eine wiederhergestellte
Kopie enthält personenbezogene Daten und darf nicht länger als nötig bestehen.

## Tests

Die API-Tests der Nikolaus-Daten laufen gegen einen echten SQL Server, weil es gerade um
Sperren und Transaktionen geht. Jede Testdatei legt eine eigene Datenbank an, wendet alle
Migrationen an und löscht sie am Ende (`api/test/fixtures/database.ts`).

```bash
docker run -d --name sql -p 1433:1433 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Test_Passw0rd!' \
  mcr.microsoft.com/mssql/server:2022-latest
cd api
TEST_SQL_PASSWORD='Test_Passw0rd!' bun run test
```

Ohne `TEST_SQL_PASSWORD` werden diese Tests lokal übersprungen; in CI (`CI=true`) ist die
Variable Pflicht, der Build-Job startet dafür einen SQL-Server-Container.

## Previews

Jede PR-Preview hat eine eigene Datenbank `website-pr-<Nummer>` auf dem eigenen logischen Server
`stamm-phoenix-previews` (`CONFIG.database.previewServer`) und einen Blob-Container `pr-<Nummer>` im Storage-Konto `stammphoenixpreviews`, mit erfundenen Testdaten
statt der echten Daten:

- **PR geöffnet oder aktualisiert:** Der Deploy-Job legt die Datenbank an, falls es sie noch
  nicht gibt (Stufe *Basic*, lokale Sicherungen), wendet alle Migrationen an, gibt der Website
  Lese- und Schreibrechte und füllt eine neue Datenbank mit Testdaten
  (`scripts/nikolaus-testdata.ts`: Familien in allen Terminen, etwa 30 Helfende; dazu die
  vorgeschlagene Einteilung und eine Dispo je Tag aus `seedPreviewPlans` in
  `api/lib/db-preview.ts`; in der Steuerung sind Online-Anmeldung und Verwaltung an; dazu
  erfundene Fragen & Antworten und Blogbeiträge mit Testbildern im Container). Spätere Pushes
  behalten, was in der Preview geändert wurde, und wenden nur neue Migrationen an. Danach
  schreibt er die Namen in `api/lib/deployment.ts`; nur so weiß die Preview, welche Datenbank
  und welchen Container sie nutzt (und damit, dass sie den Preview-Server nutzt). Im Repository
  steht dort immer `null`, also die Produktion.
- **Neue Tabellen** (z. B. wenn eine SharePoint-Liste nach Azure SQL umzieht) bekommen in
  derselben PR Testdaten für die Previews: das Befüllen in `scripts/db-preview.ts` ergänzen
  und die Zahl in `SEEDED_KEY` (`api/lib/db-preview.ts`) erhöhen, damit bestehende Previews
  nachgefüllt werden. Jeder Schritt füllt nur, was fehlt.
- **PR geschlossen oder gemergt:** Der Job „Close Pull Request“ löscht Datenbank und Container.
- **Migrationen eines PRs** laufen zuerst an seiner Preview-Datenbank, vor dem Merge also schon
  einmal gegen Azure SQL. In die Produktion kommen sie erst mit dem Deploy auf `main`.

Das alles macht `api/scripts/db-preview.ts` mit einer eigenen Identität
`website-astro-previews`. Sie hat die Rolle `dbmanager` in `master` **des Preview-Servers**: Sie
darf dort Datenbanken anlegen und ist Eigentümerin der Datenbanken, die sie angelegt hat. Auf
dem Produktionsserver hat sie keinen Benutzer. Ein eigener Server ist nötig, weil `dbmanager`
jede Datenbank seines Servers löschen darf und der Workflow das Skript aus dem Checkout des PRs
ausführt; auf einem gemeinsamen Server könnte ein PR so `website` löschen (#228). Die Website selbst meldet sich in Previews weiter mit
ihrem Zertifikat an; das schützt die echten Daten vor Versehen, nicht vor Absicht (Code eines
PRs könnte sich gezielt mit `website` verbinden). PRs aus Forks bekommen keine Preview.

Ohne die Variable `SQL_PREVIEW_CLIENT_ID` schlägt der Deploy einer Preview fehl, statt auf die
Produktionsdaten zurückzufallen.

Kosten: Eine Datenbank der Stufe *Basic* kostet rund 5 € im Monat, anteilig nur, solange der PR
offen ist.

### Einrichtung (einmalig)

0. Den Preview-Server anlegen, mit denselben Einstellungen wie der Produktionsserver (nur
   Entra-Anmeldung, gleicher Entra-Admin, Zugriff für Azure-Dienste, TLS 1.2). Der Server
   selbst kostet nichts. Mit `az login` als Owner, z. B. in der Azure Cloud Shell:

   ```bash
   admin=$(az sql server show -g website-astro -n stamm-phoenix-website \
     --query administrators -o json)
   az sql server create -g website-astro -n stamm-phoenix-previews -l germanywestcentral \
     --enable-ad-only-auth --minimal-tls-version 1.2 \
     --external-admin-principal-type "$(jq -r .principalType <<<"$admin")" \
     --external-admin-name "$(jq -r .login <<<"$admin")" \
     --external-admin-sid "$(jq -r .sid <<<"$admin")"
   az sql server firewall-rule create -g website-astro -s stamm-phoenix-previews \
     -n AllowAllWindowsAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
   ```

   Für Schritt 3 von außerhalb Azures braucht die eigene IP-Adresse vorübergehend eine
   Firewall-Regel (`az sql server firewall-rule create … -n Admin --start-ip-address <IP>
   --end-ip-address <IP>`, danach wieder löschen); die Cloud Shell braucht keine.
1. Entra ID → **App registrations** → **New registration**, Name `website-astro-previews`,
   sonst Standardwerte. Die **Application (client) ID** notieren.
2. In der neuen Registrierung → **Certificates & secrets** → **Federated credentials** →
   **Add credential** → *GitHub Actions deploying Azure resources*: Organization
   `stamm-phoenix`, Repository `website-astro`, Entity type **Pull request**. Der Antragsteller
   (Subject) muss `repo:stamm-phoenix/website-astro:pull_request` lauten, wie beim Credential
   der Preview-Anmeldung ([entra-preview-login.md](entra-preview-login.md)).
3. Der Identität das Anlegen von Datenbanken erlauben. Als Datenbank-Admin (Mitglied der Gruppe
   aus Schritt 1), z. B. in der Azure Cloud Shell:

   ```bash
   cd website-astro/api && git pull && bun install
   bun scripts/db-preview.ts grant-creator <Client-ID aus Schritt 1>
   ```

   Das legt in `master` des Preview-Servers den Benutzer `website-astro-previews` an (ohne
   Namenssuche im Entra ID, über die Client-ID) und nimmt ihn in die Rolle `dbmanager` auf.
   Kein Benutzer auf dem Produktionsserver, keine Admin-Gruppe.
4. GitHub → Repository → **Settings → Secrets and variables → Actions → Variables**:
   `SQL_PREVIEW_CLIENT_ID` = Client-ID aus Schritt 1.

Danach bekommt der nächste Push auf einen PR seine Datenbank. Preview-Datenbanken zu PRs, die
vor der Einrichtung geschlossen wurden, gibt es nicht; vorhandene Datenbanken
`website-pr-<Nummer>` lassen sich bei Bedarf im Portal am Preview-Server unter
**SQL databases** sehen und löschen.

Bis #228 lagen die Preview-Datenbanken auf dem Produktionsserver. Dort ist danach in `master`
aufzuräumen (als Entra-Admin, Query editor der Datenbank `master` oder `sqlcmd`):

```sql
ALTER ROLE dbmanager DROP MEMBER [website-astro-previews];
DROP USER [website-astro-previews];
```

Übrig gebliebene `website-pr-*` auf dem Produktionsserver werden im Portal gelöscht.
