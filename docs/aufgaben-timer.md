# Aufgaben-Erinnerungen in Azure

Der Timer läuft unabhängig von GitHub Actions. Die Website bleibt eine Static Web App mit
verwalteter HTTP-API; die separate Function App registriert nur `taskReminders`. GitHub darf
deren Code nach einem `main`-Deployment aktualisieren, führt den Versand aber niemals aus.

## Einmalige Bereitstellung

In Azure Cloud Shell oder mit Azure CLI als berechtigte Verwaltungsidentität:

```sh
az deployment group create --resource-group website-astro \
  --template-file infrastructure/task-reminder-worker.bicep --output none
```

Die Vorlage erstellt eine Linux Consumption Function App, einen Timer-Speicher sowie
Application Insights mit Log-Analytics-Workspace (30 Tage Aufbewahrung). Es entstehen Azure-
Verbrauchskosten für Ausführungen, Speicher und Logs. `TASK_REMINDERS_ENABLED=false` ist der
sichere Erstzustand. Das vorhandene Website-Zertifikat wird serverseitig übernommen und nicht
als Ausgabe zurückgegeben. Bei Zertifikatsrotation die Vorlage erneut anwenden; dabei den
gewünschten Aktivierungszustand ausdrücklich mit `--parameters enabled=true` erhalten.

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
  --build-remote true --output none
```

Das interne Deployment-Archiv enthält keine Secrets und nur den Timer-Einstiegspunkt; die
Website-HTTP-Endpunkte werden nicht registriert. 

## Aktivierung und Betrieb

1. #257 mergen und die Produktionsmigrationen erfolgreich deployen.
2. Timer-Code deployen. In Azure Functions muss genau `taskReminders` erscheinen.
3. In der Function App `TASK_REMINDERS_ENABLED=true` setzen. Vorher verschickt sie nichts.
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

## Prüfstand der Bereitstellung

Die Bicep-Vorlage kompiliert lokal. Die vorhandene Verwaltungsidentität kann die Ressourcengruppe
lesen, erhält bei `Microsoft.Resources/deployments/validate/action` aber HTTP 403. Es wurden
keine neuen Azure-Ressourcen angelegt. Für die einmalige Bereitstellung wird ein Konto mit
Deployment- und Erstellrechten in `website-astro` benötigt (z. B. Contributor auf der
Ressourcengruppe); der spätere Code-Deploy benötigt nur Rechte auf der Function App.
