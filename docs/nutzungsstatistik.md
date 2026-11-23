# Nutzungsstatistik des Leitendenbereichs

Wie oft die Module des Leitendenbereichs geöffnet werden und in welchen Bereichen Änderungen gespeichert werden, steht in Application Insights `website-astro-insights` (Ressourcengruppe `website-astro`). Ausgewertet wird im Workbook „Nutzung des Leitendenbereichs“. Die öffentliche Seite wird nicht gemessen.

## Was erfasst wird

Die API schreibt zwei Ereignisse in `customEvents` (`api/lib/usage-telemetry.ts`):

| Ereignis            | Auslöser                                                                               | Eigenschaften    |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| `StaffModuleOpened` | Ein Modul wird geöffnet (`StaffNav` → `POST /api/intern/haeufig`)                      | `module` (Pfad)  |
| `StaffAction`       | Eine Änderung wird gespeichert (`staffHandler`, ohne `quiet`- und `readOnly`-Anfragen) | `area`, `method` |

Jedes Ereignis trägt `environment` (`production` oder `preview`) und als `user_Id` ein Pseudonym: die ersten 32 Hexzeichen eines HMAC-SHA256 über Anmeldeanbieter und `userId` der Static Web App mit `USAGE_PSEUDONYM_SECRET`. Name, E-Mail, IDs von Einträgen und Eingaben werden nicht gesendet. Ohne das Secret zeigen die Ereignisse niemanden, „Leitende“ bleibt dann leer. Wird das Secret geändert, bekommen alle neue Pseudonyme.

Gesendet wird direkt an den Ingestion-Endpunkt, nicht über den Functions-Host. Deshalb heißt die Einstellung `USAGE_INSIGHTS_CONNECTION_STRING` und nicht `APPLICATIONINSIGHTS_CONNECTION_STRING`: Mit dem Standardnamen würde der Host alle Logzeilen senden, auch `[pflege] <E-Mail> …`. Ein fehlgeschlagener Versand wird nach zwei Sekunden aufgegeben und bricht nichts ab.

Der anonyme Zähler für „Häufige Aufgaben“ (`organisation.staff_usage`) bleibt davon unabhängig.

## Aufbewahrung und Kosten

`AppEvents` (die Tabelle hinter `customEvents`) wird 90 Tage aufbewahrt, so lange ist sie bei arbeitsbereichsbasiertem Application Insights ohne Aufpreis. Der Rest von `website-astro-logs` bleibt bei 30 Tagen. Das Tageslimit des Arbeitsbereichs von 0,1 GB gilt weiter; ein Ereignis hat etwa 1 KB.

## Einrichtung

1. Workbook und Aufbewahrung anlegen (wiederholbar):

   ```sh
   az deployment group create --resource-group website-astro \
     --template-file infrastructure/usage-workbook.bicep --output none
   ```

2. Die beiden Einstellungen in der Produktionsumgebung der Static Web App setzen. Der Connection String steht in `website-astro-insights` unter „Übersicht“; das Secret ist ein neuer Zufallswert (`openssl rand -hex 32`), der nirgends sonst verwendet wird:

   ```sh
   az staticwebapp appsettings set -n website-astro -g website-astro --setting-names \
     USAGE_INSIGHTS_CONNECTION_STRING='<Connection String>' \
     USAGE_PSEUDONYM_SECRET='<Secret>'
   ```

PR-Vorschauen bekommen die Einstellungen nicht und senden nichts. Nach dem Umzug in die Container App (#528) werden beide dort als Secrets gesetzt.

## Auswerten

Azure-Portal → `website-astro-insights` → Workbooks → „Nutzung des Leitendenbereichs“: Überblick, Aufrufe pro Modul, meistgenutzte Module, Verlauf, aktive Leitende pro Woche und gespeicherte Änderungen pro Bereich, jeweils für den gewählten Zeitraum. Die Abfragen stehen in `infrastructure/usage-workbook.json`; nach einer Änderung dort Schritt 1 wiederholen.
