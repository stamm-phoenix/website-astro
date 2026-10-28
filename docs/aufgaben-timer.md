# Aufgaben-Erinnerungen in Azure

Der Timer läuft unabhängig von GitHub Actions. Die Website bleibt eine Static Web App mit
verwalteter HTTP-API; die separate Function App registriert nur `taskReminders`, `leitendenrundeReminders` und `essensplanungAufbewahrung`. GitHub darf
deren Code nach einem `main`-Deployment aktualisieren, führt den Versand aber niemals aus.

## Bestehende Einrichtung

Am 13.10.2026 wurde `website-astro-task-reminders` in `website-astro` (West Europe) angelegt
und der Timer-Code erfolgreich deployt. Azure registriert ausschließlich `taskReminders`;
`TASK_REMINDERS_ENABLED=false` wurde geprüft. Die Aktivierung erfolgt erst nach Merge und
Produktionsmigrationen. Die folgenden Bereitstellungsbefehle sind für eine neue Installation;
für die bestehende App genügt nach den Migrationen die Aktivierung und später das Code-Deployment.

## Einmalige Bereitstellung

Für den Vault muss `Microsoft.KeyVault` einmal auf Subscription-Ebene registriert sein
(Azure-Portal → Abonnements → Ressourcenanbieter → Microsoft.KeyVault → Registrieren).
Contributor nur auf der Ressourcengruppe darf diese Subscription-Einstellung nicht ändern.

In Azure Cloud Shell oder mit Azure CLI als berechtigte Verwaltungsidentität:

```sh
az deployment group create --resource-group website-astro \
  --template-file infrastructure/task-reminder-worker.bicep --output none
```

Die Vorlage erstellt eine Linux Consumption Function App, einen Timer-Speicher sowie
Application Insights mit Log-Analytics-Workspace (30 Tage Aufbewahrung) und einen Key Vault. Es entstehen Azure-
Verbrauchskosten für Ausführungen, Speicher und Logs. `TASK_REMINDERS_ENABLED=false` ist der
sichere Erstzustand. Das Website-Zertifikat liegt im Key Vault. Die Function App speichert ausschließlich eine
Key-Vault-Referenz und löst sie über ihre systemseitige Managed Identity auf (nur Secret-Get im
eigenen Vault). Das Zertifikat wird nicht als Ausgabe zurückgegeben. Die Vorlage dient ausschließlich der Erstbereitstellung.
Bei einem bereits deployten Worker würde ihre App-Settings-Liste auch deploymentverwaltete
Werte wie `WEBSITE_RUN_FROM_PACKAGE` ersetzen. Für Zertifikatsrotation stattdessen ausschließlich
folgendes Skript verwenden; es rotiert ausschließlich das Secret im Vault und aktualisiert die Referenzauflösung.
Paketadresse und Aktivierungszustand bleiben erhalten:

```sh
bash scripts/rotate-task-worker-certificate.sh
```

Währenddessen kein paralleles Code-Deployment starten.

Für automatische **Code-Deployments** folgende Repository-Variablen setzen:

- `TASK_REMINDER_FUNCTION_APP`: `website-astro-task-reminders`
- `TASK_REMINDER_DEPLOY_CLIENT_ID`: Entra-App mit GitHub-OIDC-Vertrauen für dieses Repository
  und `main`, sowie Schreibrechten auf genau diese Function App (z. B. Website Contributor).
- `AZURE_SUBSCRIPTION_ID`: Subscription der Function App.
- `ENTRA_TENANT_ID`: bestehender Tenant.

Der Deployment-Job hängt vom erfolgreichen Website-Deployment inklusive SQL-Migrationen ab.
Ohne `TASK_REMINDER_FUNCTION_APP` wird er übersprungen. Die Ressourcen müssen vorher existieren;
der Job erstellt keine Infrastruktur und aktiviert den Versand nicht.

Alternativ nach den Produktionsmigrationen aus einem geprüften Checkout von `main` deployen:

```sh
bash scripts/package-task-worker.sh /tmp/phoenix-task-worker
az functionapp deployment source config-zip --resource-group website-astro \
  --name website-astro-task-reminders --src /tmp/phoenix-task-worker.zip \
  --build-remote false --output none
```

Das interne Deployment-Archiv enthält keine Secrets und nur den Timer-Einstiegspunkt; die
Website-HTTP-Endpunkte werden nicht registriert. Die Produktionsabhängigkeiten stammen
unverändert aus `api/bun.lock` (`--production --frozen-lockfile --ignore-scripts`). Das Archiv
enthält die fertigen `node_modules`; Azure führt weder einen Remote-Build noch Install-Skripte aus.

## Aktivierung und Betrieb

1. #257 mergen und die Produktionsmigrationen erfolgreich deployen.
2. Timer-Code deployen. In Azure Functions müssen genau `taskReminders` und `leitendenrundeReminders` erscheinen.
3. In der Key-Vault-Referenzverwaltung muss `AZURE_CLIENT_CERT` den Status `Resolved` haben.
   In der Function App `TASK_REMINDERS_ENABLED=true` setzen. Vorher verschickt sie nichts.
4. Der Timer läuft stündlich zur Minute 17 in UTC. Die Anwendung prüft das Berliner Datum und
   die Berliner Stunde; damit beginnt der Versand ganzjährig normalerweise um 9:17 Uhr.
5. In Application Insights fehlgeschlagene Funktionsausführungen überwachen und einen Azure-
   Alarm für Fehler einrichten. Logs enthalten Ergebniszähler, keine Empfänger oder Aufgaben.

Zum Pausieren `TASK_REMINDERS_ENABLED=false` setzen. Dies stoppt neue Ausführungen; bereits
begonnene Transporte können noch abschließen. SQL-Reservierungen schützen auch bei mehreren
Instanzen und verspäteten Läufen vor Doppelversand. Der Timer startet nicht beim Host-Start
(`runOnStartup=false`) und hat keinen automatischen Retry nach einer unklaren Mailannahme.
429 wird durch die vorhandene SQL-Retryregel frühestens im nächsten stündlichen Lauf wieder
versucht. Andere unklare Ergebnisse müssen im Absenderpostfach geprüft werden.

Der Worker verwendet dieselbe Produktionsdatenbank und dieselbe Entra-App wie die Website.
Azure SQL muss wie bisher Azure-Dienste zulassen; die Datenbankanmeldung erfolgt mit dem
Website-Zertifikat. Keine Datenbankkopie, neue Graph-Berechtigung oder öffentliche Versandroute
ist erforderlich. Vorschau-Datenbank und Vorschau-Server bleiben zusätzlich im Transport gesperrt.

## Berechtigungen für die Bereitstellung

Die Vorlage kompiliert lokal und wurde mit Azure ARM erfolgreich validiert. Für die einmalige
Bereitstellung wird eine Identität mit Deployment- und Erstellrechten auf der Ressourcengruppe
`website-astro` benötigt (z. B. Contributor); Contributor nur auf der vorhandenen Static Web App
reicht dafür nicht. Der spätere Code-Deploy benötigt nur Rechte auf der Function App.

## Erinnerungen an die Leitendenrunde

Die Leitenden werden per Mail an die nächste Leitendenrunde erinnert (#184). Dafür läuft in
derselben Function App ein zweiter Timer, `leitendenrundeReminders` (`api/timers/leitendenrunde-reminders.ts`),
stündlich zur Minute 47 in UTC. Er hat seinen eigenen Not-Aus `LEITENDENRUNDE_REMINDERS_ENABLED`
(Standard `false`), unabhängig von `TASK_REMINDERS_ENABLED`. Das Paket verwendet `dist/timers/index.js`
(`api/timers/index.ts`, lädt alle Timer) als Einstiegspunkt; alle Timer teilen sich Datenbank, Entra-App und Graph-Zugang.

**Welcher Termin zählt.** Maßgeblich ist das neueste freigegebene Protokoll der Leitendenrunde
(`api/lib/leitendenrunde-termin.ts`):

- Editor-Protokoll: das Feld „Nächste Leitendenrunde“ (Datum, Uhrzeit, Ort), sobald das Protokoll
  freigegeben oder verschickt ist.
- Word-Protokoll: nur ein von Reviewenden **bestätigter** Termin der freigegebenen Fassung, nie
  ein Vorschlag. Das gilt, solange der Word-Weg besteht (#284). Vor dem Versand prüft der Timer in
  SharePoint, ob die Datei noch existiert; gelöschte Protokolle zählen nicht (aus dem Papierkorb
  wiederhergestellte wieder). Schlägt die Prüfung fehl, bricht der Lauf ab.
- Entwürfe und Protokolle im Review erzeugen nichts. Hat das neueste freigegebene Protokoll
  keinen Termin (leer, abgelehnt, nur vorgeschlagen), gibt es keine Erinnerung; ein Termin aus
  einem älteren Protokoll kehrt nicht zurück.

**Wann erinnert wird.** Sieben Tage und einen Tag vor dem Termin, jeweils ab 9:00 Uhr Berliner
Zeit (`CONFIG.leitendenrundeReminders`); die Zeitumstellung ist berücksichtigt, weil die Zeitpunkte
aus Berliner Datum und Uhrzeit berechnet werden. Es gilt immer genau die Stufe, deren Zeit zuletzt
gekommen ist: Wird ein Termin spät bestätigt (z. B. drei Tage vorher), geht einmal sofort die
Erinnerung der gerade gültigen Stufe hinaus, nie mehrere auf einmal. Ab dem Beginn des Termins
(ohne Uhrzeit ab dem Ende des Tages) wird nichts mehr versendet.

**Termin geändert oder abgesagt.** Der Plan wird bei jedem Lauf aus dem aktuellen Protokoll
abgeleitet und vor jeder einzelnen Mail mit der aktuellen Uhrzeit erneut geprüft; ein Termin, der
während des Laufs beginnt, bekommt keine weiteren Mails. Ein anderes Datum oder eine andere Uhrzeit
ist ein anderer Termin mit eigenen Erinnerungen: Die Leitenden bekommen für den neuen Termin die
Erinnerung, die gerade gilt (das ist zugleich die Nachricht über die Änderung). Wird der Termin
gelöscht oder das Protokoll nicht mehr freigegeben, entfallen alle offenen Erinnerungen; bereits
reservierte, aber noch nicht gesendete Mails werden verworfen. Eine eigene Absage-Mail gibt es nicht.

**Empfänger.** Vor jedem Lauf werden die aktuellen Leitenden wie beim Protokollversand frisch aus
CampFlow geladen (`CONFIG.protokolle.campflowGroups`, Ein- und Austrittsdatum, geprüfte und
doppelfreie Adressen, aber ohne das Label „Protokollempfang“). Fällt CampFlow aus, bricht der Lauf ab; es
wird keine alte Liste verwendet. Leitende ohne brauchbare Adresse bekommen keine Mail und lassen die
Ausführung als Fehler enden (Zähler `missingAddress`), damit sie in den Alarmen auftauchen. Jede
Person bekommt eine eigene Mail, die Adressen sind für andere nicht sichtbar. Die Mail enthält Tag,
Uhrzeit und Ort und einen geschützten Link auf das Protokoll (bei Word-Protokollen auf die Liste).

**Zuverlässigkeit.** Pro Termin, Stufe und Person gibt es höchstens eine Zeile in
`protokoll.erinnerung` (Migration 0047, eindeutiger Schlüssel), die vor dem Versand reserviert
wird; parallele Läufe senden deshalb nicht doppelt. Gespeichert wird nur der Hash der Adresse.
Ein Timeout oder ein anderer unklarer Fehler setzt `uncertain` und wird nie automatisch wiederholt
(Graph `202` bestätigt Annahme, nicht Zustellung); das Ergebnis lässt sich im Postfach
`kontakt@stamm-phoenix.de` unter „Gesendete Elemente“ klären. Nur 429 wird nach 45 Minuten erneut versucht, andere
4xx-Fehler gelten als endgültig (`failed`). Verpasste Läufe holt der nächste stündliche Lauf nach, solange die
Stufe gilt. Eine Mailquote ergibt sich aus dem eindeutigen Schlüssel plus `maxMailsPerRun`; der Rest
bleibt für den nächsten Lauf. Reservierungen ohne Ergebnis nach fünf Minuten zählen als `uncertain`. Zeilen
werden 120 Tage nach dem Termin gelöscht. Die Logs enthalten nur Ergebniszähler.

**Previews und Tests** senden nie echte Mails (`taskReminderMailAllowed()`), und kein Timer läuft
in einer Preview-Umgebung.

### Einrichtung des Workers (Stand: nicht aktiviert)

Nach dem Deployment bleibt der Timer ausgeschaltet (`LEITENDENRUNDE_REMINDERS_ENABLED` ist nicht
gesetzt, er protokolliert nur „disabled“). Die Function App hat nur eigene App Settings; das
CampFlow-Token der Website steht dort nicht. Vor einer Aktivierung kommt es wie das Zertifikat als
Key-Vault-Referenz in die Function App:

1. Das Token in den Vault übernehmen (legt `campflow-api-token` aus den App Settings der Website an,
   ohne die Einstellungen der Function App zu ändern):
   `bash scripts/rotate-task-worker-certificate.sh`
2. In der Function App die Einstellungen setzen (neue Installationen erhalten sie über die Bicep-Vorlage):

   ```sh
   az functionapp config appsettings set --resource-group website-astro \
     --name website-astro-task-reminders --output none --settings \
     'CAMPFLOW_API_TOKEN=@Microsoft.KeyVault(SecretUri=https://<Vault>.vault.azure.net/secrets/campflow-api-token)' \
     LEITENDENRUNDE_REMINDERS_ENABLED=false
   ```

3. Migration 0047 und Timer-Code deployen, den Status der Referenz `CAMPFLOW_API_TOKEN` auf `Resolved`
   prüfen, dann `LEITENDENRUNDE_REMINDERS_ENABLED=true` setzen. Zum Pausieren wieder `false`.

Bei einer fehlgeschlagenen Ausführung (Alarm in Application Insights) nennt die Fehlermeldung nur
Zähler. `failed` und `uncertain` im Postfach prüfen, `missingAddress` in CampFlow beheben; nach
`uncertain` entscheiden Menschen, ob nachgesendet wird. Einen Termin korrigiert man im Protokoll
(Editor-Feld bzw. Termin bestätigen), nicht in der Datenbank.

## Aufbewahrung der Essensplanung

Der dritte Timer, `essensplanungAufbewahrung` (`api/timers/essensplanung-aufbewahrung.ts`), läuft
täglich um 03:23 UTC und räumt die [Essensplanung](essensplanung.md) auf: Er löscht alte
Anlage-Anfragen, schickt den Besitzer:innen 14 Tage vor dem Löschdatum einer Planung eine Warnmail
von `kontakt@stamm-phoenix.de` und löscht abgelaufene Planungen mit allen Daten. Not-Aus ist
`ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED` (Standard `false`, Bicep-Parameter
`essensplanungAufbewahrungEnabled`); ausgeschaltet protokolliert er nur „disabled“.

Aktivieren erst, wenn die Migrationen 0049, 0050, 0053 und 0054 in Produktion sind und der Timer-Code deployt
ist; dann prüfen, dass die Entra-App von dort aus Mails als `kontakt@stamm-phoenix.de` senden darf,
und `ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED=true` setzen. Das Protokoll nennt nur Zähler.
