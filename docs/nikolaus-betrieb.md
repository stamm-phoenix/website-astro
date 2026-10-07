# Nikolausdienst betreiben

Stand: 6. Oktober 2026. Der tägliche automatische Löschlauf ist eingerichtet und aktiv (`NIKOLAUS_RETENTION_ENABLED=true`, Environment `nikolaus-retention` mit `AZURE_CLIENT_CERT`, passender `NIKOLAUS_RETENTION_TARGET_DIGEST`). Der Lauf vom 6. Oktober 2026 meldete `idle` ohne fällige Saisons. Nico Welles kontrolliert Ergebnisse und Fehler; die Frist beträgt einen Kalendermonat nach dem letzten Besuch der Saison und steht so auch in der Datenschutzerklärung (`/datenschutz#nikolaus`). Ein manueller Lauf mit Vorschau bleibt verfügbar.

Seit #165 liegen alle Nikolaus-Daten in Azure SQL statt in SharePoint-Listen; Einrichtung, Schema und Wiederherstellung stehen in [azure-sql.md](azure-sql.md). Der Löschlauf braucht dafür einen neuen `NIKOLAUS_RETENTION_TARGET_DIGEST` (Schritt 7 dort). Die Abschnitte zur Azure-Prüfung und -Einrichtung vom 1. und 2. Oktober beschreiben den Stand davor.

## Verantwortung und Frist

Am 2. Oktober 2026 wurde für diesen Ablauf festgelegt: **Nico Welles** ist verantwortlich; die Daten werden **vorerst einen Kalendermonat nach dem letzten tatsächlich erfolgten Besuch der Saison** gelöscht. Nach Aktivierung berechnet der tägliche Job den Löschtermin. Nico prüft die erfassten Besuchsdaten, kontrolliert Ergebnisse und klärt Fehler sowie zurückgehaltene Daten. Bei einem verschobenen letzten Besuch verschiebt sich der Löschtermin entsprechend. Diese neue Betriebszuweisung beschreibt keinen bereits früher ausgeführten Löschlauf.

`--responsible "Nico Welles"` hält die verantwortliche Person im Ergebnis fest. `--before` wählt Besuchsdaten für die Vorschau aus; es ist **nicht der Ausführungstermin** und setzt keine automatische Monatsfrist durch. Der Stichtag liegt am Tag nach dem letzten zu bereinigenden Besuchsdatum. Nico führt den Lauf erst zum festgelegten Löschtermin aus. Ohne Saison, Stichtag und Verantwortungsangabe entsteht kein Löschplan.

Ein Datum wird gelöscht, wenn es zur gewählten Saison gehört und **vor** dem Stichtag liegt. Der Lauf umfasst alle Buchungsstatus, einschließlich ausstehender, stornierter und abgelaufener Buchungen. Er berücksichtigt die zugehörigen Dispo-Zeilen und Helfendeneinteilungen. Helfende mit Verfügbarkeit außerhalb der Auswahl bleiben erhalten. Solche Fälle stehen unter `retained` und müssen einzeln geprüft werden. Angaben ohne zuverlässig zuordenbares Datum lassen sich nicht allein anhand eines Jahres sicher auswählen.

## Gemeinsamer Zustand

Produktion, Previews und jede Azure-Functions-Instanz verwenden dieselbe Datenbank (`CONFIG.database` in `api/lib/config.ts`) und damit denselben Zustand in der Tabelle `nikolaus.state`: Mailquote, Tempo, Lease und Cache des Geocodings, Löschtermine und Berichte des Löschlaufs. Jedes dieser JSON-Dokumente wird unter einer Zeilensperre geändert, gleichzeitige Änderungen laufen nacheinander. Ist die Datenbank nicht erreichbar, führt Geocoding zu `unavailable`; es entsteht keine unkoordinierte Anfrage an den Anbieter.

`NIKOLAUS_STATE_SECRET` muss mindestens 32 Zeichen lang und in allen beteiligten Umgebungen identisch sein. Es bildet HMAC-Schlüssel für Adress-Lookups. Der Zustand enthält keine Klartextadressen im Geocoding-Schlüssel; die zwischengespeicherten Koordinaten sind trotzdem Standortdaten. Eine Änderung des Secrets verwirft die bisherige Zuordnung von Cache-Schlüsseln; sie hebt die gemeinsame Sperre und das gemeinsame Tempo nicht auf. Wie Dispo und Einteilung gespeichert werden, steht in [Planungen speichern](nikolaus-planungen.md).

## Azure-Einrichtung vom 2. Oktober 2026

Nach ausdrücklicher Freigabe wurden die gemeinsamen Appsettings in `default`, `103`, `108`, `155` und `161` gesetzt und zurückgelesen. Alle verwenden die Liste `NikolausZustand` mit ID `0e1d6c9b-0d49-4428-8564-16b8ccc01929`, dasselbe Secret und die Mailgrenzen 100/Stunde sowie 500/Tag. Die erforderlichen Spalten `OperationKey` und `State` wurden über die Website-App geprüft. Ein unmittelbar wieder entfernter Datensatz mit Titel `TEST – bitte löschen` bestätigte Schreiben, ETag-Konflikte und die eindeutige Schlüsselspalte.

In der Ressourcengruppe `website-astro` wurden `website-astro-logs` und das damit verbundene Application Insights `website-astro-insights` in West Europe angelegt. Der Arbeitsbereich verwendet 30 Tage Aufbewahrung und ein tägliches Ingestionslimit von 0,1 GB. Das Limit ist keine harte Kostengarantie und kann weitere Aufzeichnungen bis zum nächsten Tag unterbrechen. [Microsoft beschreibt diese Einschränkungen](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

Die `host.json` deaktiviert automatisches Dependency-Tracking, damit Anbieter-URLs mit Adressen nicht als Dependencies erfasst werden. Sampling ist deaktiviert, damit die gezielt geschriebenen Geocoding-Ereignisse vollständig gezählt werden können. Azure Static Web Apps lehnte entsprechende Laufzeit-Overrides ab, weil deren Namen mehr als 64 Zeichen enthalten. Daher muss diese Host-Konfiguration vor der Insights-Verknüpfung ausgerollt sein. Zunächst wird nur die Vorschau #155 mit Insights verbunden; Produktion und ältere Vorschauen werden erst nach Deployment der passenden Host-Konfiguration verbunden. [Microsoft dokumentiert die Host-Konfiguration](https://learn.microsoft.com/en-us/azure/azure-functions/configure-monitoring).

Historische Anfragen und Instanzzahlen bleiben nicht verfügbar. Eine Abnahme unter tatsächlicher Geocoding-Last steht aus. Der automatische Löschlauf ist inzwischen über die Repository-Variable und das Lösch-Environment aktiviert (siehe oben).

## Azure-Prüfung vom 1. Oktober 2026

Die lesende Prüfung erfolgte nach Gerätecode-Anmeldung in der Subscription „Nico Welles (Subscription)“, Ressourcengruppe `website-astro`, Static Web App `website-astro` (Standard, West Europe). Die Ressourcengruppe enthält ausschließlich diese SWA. Es ist kein separates Backend angebunden; Enterprise Grade CDN ist deaktiviert. Die vorhandenen Umgebungen `default`, `103` und `108` sind `Ready`.

In der sichtbaren Subscription wurden keine Application-Insights-, Log-Analytics-, Front-Door-, CDN-Profil- oder Front-Door-WAF-Ressourcen gefunden. In Produktion und den beiden Previews fehlt `APPLICATIONINSIGHTS_CONNECTION_STRING`. In Produktion fehlt außerdem `APPINSIGHTS_INSTRUMENTATIONKEY`. Historische Dependencies, Geocoding-Anfragen und Functions-Instanzzahlen sind deshalb nicht verfügbar. Eine vorhandene zentrale Begrenzung für Geocoding oder den Nikolaus-Mailversand ist nicht belegt.

Die SWA-Metriken lieferten für **1. September 2026 00:00 UTC bis 1. Oktober 2026 00:00 UTC**, Aggregation `Total`, Tagesintervall:

| Metrik           | Summe der aufgezeichneten Werte | Tage mit Werten / zurückgegebene Tage |
| ---------------- | ------------------------------: | ------------------------------------: |
| `SiteHits`       |                          78.790 |                               30 / 30 |
| `FunctionHits`   |                           3.409 |                               30 / 30 |
| `FunctionErrors` |                           4.299 |                               26 / 30 |
| `SiteErrors`     |                     Keine Werte |                                0 / 30 |

Die Metriken haben keine Instanz- oder Endpoint-Dimension. `FunctionErrors` übersteigt in diesem Ergebnis `FunctionHits`; daraus lässt sich ohne weitere Telemetrie keine Fehlerquote einzelner Requests ableiten. Fehlende Werte sind keine gemessenen Nullen. Diese Summen betreffen die Website insgesamt und sind keine Geocoding- oder Mailzählung. [Microsoft beschreibt die verfügbaren SWA-Metriken](https://learn.microsoft.com/en-us/azure/static-web-apps/metrics).

Die aktuelle Repository-Konfiguration enthält weder `networking.allowedIpRanges` noch `forwardingGateway` und keine zentrale Rate-Limit-Regel. Die ARM-Abfragen für `/config` und `/config/networking` lieferten `Not Found`; das ist kein Nachweis der tatsächlich ausgerollten Netzwerkkonfiguration. Zusammen mit dem Ressourceninventar ist keine zusätzliche Ingress-Begrenzung nachgewiesen. Providerinterne Schutzmaßnahmen und externe Dienste außerhalb dieser Subscription bleiben unbewertet.

**Offen zum damaligen Prüfzeitpunkt:** In allen drei Umgebungen fehlten `SHAREPOINT_NIKOLAUS_STATE_LIST_ID`, `NIKOLAUS_STATE_SECRET`, `NIKOLAUS_MAIL_HOURLY_LIMIT` und `NIKOLAUS_MAIL_DAILY_LIMIT`. Die nachträgliche Einrichtung steht im Abschnitt vom 2. Oktober. Die lesende Prüfung vom 1. Oktober änderte keine Azure-Ressourcen, Appsettings oder produktiven Listen.

## Gemeinsame Mailquote

Alle Nikolaus-Mails reservieren vor dem Versand atomar einen Platz in `mailquota:<Hash des normalisierten Absenders>`. Eingestellt sind 100 Zulassungen pro UTC-Stunde und 500 pro UTC-Tag (`CONFIG.nikolaus.mailHourlyLimit` und `mailDailyLimit` in `api/lib/config.ts`, positive ganze Zahlen; eine Änderung braucht einen PR und ein Deployment). Diese Werte sind Anwendungsgrenzen, keine Behauptung über Azure- oder Exchange-Limits. Produktion, Previews und alle Instanzen teilen das Budget bei gemeinsamem Absender und gemeinsamer Datenbank. Die Sammelbestellung besitzt ihre eigene Quote; bei gleichem Postfach müssen die Betriebsverantwortlichen die Gesamtbudgets aufeinander abstimmen.

Die Erstellung reserviert vor dem Anlegen einer Buchung. Das Neusenden reserviert vor der Suche nach der E-Mail-Adresse, sodass eine erschöpfte Quote bei bekannten und unbekannten Adressen dieselbe Antwort liefert. Erschöpfung ergibt HTTP 429 `MAIL_QUOTA`, ein fehlender oder nicht lesbarer gemeinsamer Speicher HTTP 503 `MAIL_UNAVAILABLE`. In beiden Fällen werden weder neue Buchungen noch Link-Mails erzeugt. Weitere Buchungsänderungen bleiben bei einem Ausfall der anschließenden Informationsmail gespeichert und protokollieren den Versandfehler wie bisher.

Eine Zulassung wird bei Fehlern, Konflikten, ungewissen Graph-Antworten oder einer unbekannten Adresse nicht zurückgebucht. Das vermeidet einen unbeabsichtigten zusätzlichen Versand, kann das Budget aber früher ausschöpfen. Ein reservierter Versandplatz ist nur einmal im reservierenden Prozess verwendbar. HTTP-Antworten und Logs enthalten keine Empfängeradresse; Logs zur Erschöpfung enthalten nur Ereignis und Absenderhash.

## Geocoding messen und kontrollieren

Der bisherige Code begrenzte Anfragen nur pro Prozess. Tatsächliche Azure-Instanzzahlen und historische Anfragen lassen sich daraus nicht ableiten. Der lokale Prozess-Test mit drei getrennten Node-Prozessen bestätigt die Zusammenfassung identischer Lookups und mindestens 1.100 ms Abstand verschiedener Requests. Er ersetzt keine Azure-Messung.

Vor der produktiven Freigabe sollen die Azure-verantwortlichen Personen in Application Insights einen Zeitraum mit Buchungsbetrieb prüfen und die Ergebnisse festhalten:

| Messwert                                                       | Quelle                                                | Ergebnis                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Beobachtete Functions-Instanzen in einem festgelegten Zeitraum | `cloud_RoleInstance` in Requests/Traces               | Nach Verknüpfung und Deployment messen                              |
| Bisherige Nominatim-Anfragen, gesamt und je Instanz            | `dependencies`, falls die HTTP-Aufrufe erfasst wurden | Nicht messbar: keine historische Dependency-Telemetrie verfügbar    |
| Gemeinsamer Zustand für Produktion und alle Previews           | `CONFIG.database`, für alle Umgebungen gleich         | Seit #165 durch die gemeinsame Datenbank erfüllt                    |
| Abstände nach Einführung der Koordination                      | `nikolaus_geocoding`-Trace-Ereignisse                 | Nach Deployment prüfen                                              |

Beispiel für die bisherige Last. Die Abfrage gibt weder URLs mit Adressen noch Anfrageinhalte aus. Sie funktioniert nur, wenn HTTP-Dependencies bisher aufgezeichnet wurden. Ein leeres Ergebnis beweist keine Last von null.

```kusto
dependencies
| where timestamp > ago(30d)
| where target has "nominatim.openstreetmap.org"
| summarize recordedRequests=count(), estimatedRequests=sum(itemCount),
            observedInstances=dcount(cloud_RoleInstance)
            by bin(timestamp, 1h)
| order by timestamp asc
```

Der neue Code schreibt JSON-Ereignisse mit `scope=nikolaus_geocoding`, `event`, einem Zeitstempel in Millisekunden und bei Abschlüssen Dauer sowie Erfolg. Er protokolliert keine Adresse, Koordinate, E-Mail, HMAC-Adresse oder Management-Tokens. Die Instanzkennung kommt aus Application Insights. Diese Abfrage zählt die tatsächlich aufgezeichneten Ereignisse:

```kusto
traces
| where timestamp > ago(24h)
| extend geo=parse_json(message)
| where tostring(geo.scope) == "nikolaus_geocoding"
| summarize recordedEvents=count(), estimatedEvents=sum(itemCount),
            observedInstances=dcount(cloud_RoleInstance)
            by event=tostring(geo.event), bin(timestamp, 1h)
```

Die folgende Abfrage sucht unterschrittene Abstände über **alle** Instanzen hinweg:

```kusto
traces
| where timestamp > ago(24h)
| extend geo=parse_json(message)
| where tostring(geo.scope) == "nikolaus_geocoding"
    and tostring(geo.event) == "request_start"
| extend startedAt=unixtime_milliseconds_todatetime(tolong(geo.at))
| order by startedAt asc
| serialize
| extend gapMs=datetime_diff("millisecond", startedAt, prev(startedAt))
| where isnotnull(gapMs) and gapMs < 1000
| project startedAt, gapMs, cloud_RoleInstance
```

Bei Sampling können Requests fehlen. Für die Abnahme muss deshalb die Aufzeichnung dieser Ereignisse vollständig sein oder Sampling muss für den Messzeitraum deaktiviert werden. Unterschiedliche Host-Uhren beeinflussen eine Auswertung anhand der Startzeit; Azure-Zeitsynchronisation muss funktionieren. Jede Anfrage wartet auch nach dem Erwerb der gemeinsamen Sperre ein vollständiges lokales Intervall.

Die Anwendung serialisiert vollständige Lookups über `geocoding:nominatim`. Erfolgreiche Ergebnisse bleiben für höchstens 24 Stunden verwendbar, höchstens 100 Ergebnisse gleichzeitig. Identische wartende Aufrufe lesen anschließend dasselbe Ergebnis. Fehler bleiben fünf Sekunden gemeinsam sichtbar, damit eine Anbieter-Störung keine unmittelbare zweite identische Anfrage auslöst. Wartende Aufrufe haben 30 Sekunden Wartebudget; pro Prozess warten höchstens sechs unterschiedliche Lookups. Bei State-Ausfällen, verlorenen Sperren oder voller Warteschlange kann die Buchung mit `nicht ermittelt` statt automatisch bestimmten Koordinaten weitergehen.

## Geocoding-Anbieter und Nutzungsregeln

Die [offizielle Nominatim-Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/nominatim/) begrenzt die gesamte Anwendung auf höchstens einen Request pro Sekunde. Sie verlangt einen identifizierenden User-Agent, Attribution und Caching, untersagt unter anderem Autocomplete und systematische Reverse-Abfragen und fordert, keine persönlichen oder vertraulichen Informationen zu übermitteln. Die verantwortlichen Personen müssen die übermittelten Angaben und den gewählten Anbieter prüfen. Die bestehende Anwendung übermittelt eine Anschrift als Suchanfrage; Namen, Telefonnummern, E-Mails und Angaben über Kinder gehen nicht an den Geocoding-Anbieter.

Der Anbieter steht als `CONFIG.nikolaus.geocodingUrl` in `api/lib/config.ts`; eingestellt ist Nominatim. Ein Wechsel braucht einen PR und ein Deployment. Der konfigurierte Anbieter muss die Nominatim-Suchparameter und das JSON-Antwortformat unterstützen und über HTTPS erreichbar sein. Die gemeinsame Begrenzung bleibt auch bei einem Wechsel bestehen. Die Karte muss ihre bestehende OpenStreetMap-Attribution behalten. Automatische Dependency-Telemetrie darf Such-URLs mit Adressparametern nicht als frei einsehbare Logs speichern; die oben beschriebenen Zählereignisse reichen für die Abnahme.

`api/scripts/nikolaus-testdata.ts` verwendet jetzt erfundene lokale Adressen und synthetische Koordinaten. Es führt keine Nominatim-Reverse-Abfragen mehr aus und kann das Gesamtlimit nicht umgehen. Seine Daten heißen `TEST – bitte löschen`. Er schreibt direkt in die Datenbank aus `CONFIG.database`; `--delete` entfernt seine Daten wieder.

## Automatischen Lauf einrichten

Der Workflow [nikolaus-retention.yml](../.github/workflows/nikolaus-retention.yml) prüft täglich um 03:39 UTC auf `main`, welche Saisons fällig sind. Ohne die Repository-Variable `NIKOLAUS_RETENTION_ENABLED=true` wird sein Schreibjob übersprungen. Auch das CLI greift bei deaktivierter Automatik ohne `--dry-run` oder `--show-target` auf keine Daten zu.

Managed Functions der Static Web App unterstützen [nur HTTP-Trigger](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions). Deshalb übernimmt GitHub Actions den Zeitplan. [Geplante Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) können verspätet starten; in öffentlichen Repositories werden sie nach 60 Tagen ohne Aktivität deaktiviert. Nico kontrolliert deshalb auch, ob der tägliche Job weiterhin läuft. Eine exakte Ausführung um Mitternacht ist nicht zugesagt.

Die Monatsfrist wird als Kalenderdatum in `Europe/Berlin` berechnet. Aus dem 6. Dezember wird der 6. Januar; aus dem 31. Januar wird der letzte Februartag. Der späteste bekannte Buchungs-, Planungs- oder Verfügbarkeitstag bildet eine vorsichtige Untergrenze. Ein später tatsächlich erfasster Besuch verlängert die Frist; Besuchsabschlüsse speichern dafür einen vollständigen Serverzeitstempel. Ein gespeicherter Termin unter `retention:schedule:<Jahr>` kann durch eine spätere Teilbereinigung nicht vorgezogen werden.

Einrichtung:

1. Das geschützte GitHub-Environment `nikolaus-retention` mit dem Secret `AZURE_CLIENT_CERT` (erledigt). Tenant, App-Registrierung und Datenbank kommen aus `api/lib/config.ts`. Die App-Registrierung braucht Lese- und Schreibrechte in der Datenbank ([azure-sql.md](azure-sql.md), Schritt 4).
2. `bun scripts/nikolaus-retention-auto.ts --show-target` ausführen. Der Befehl berechnet lokal einen Hash aus Server und Datenbankname. Diesen Hash als Repository-Variable `NIKOLAUS_RETENTION_TARGET_DIGEST` hinterlegen. Ändert sich `CONFIG.database`, muss auch diese Variable angepasst werden. Ohne passenden Hash wird nicht einmal gelesen.
3. Zunächst auf `main` einen `workflow_dispatch` mit `dry_run=true` ausführen. Er liest nur und schreibt nichts. Die Ausgabe enthält ausschließlich Saisonjahre und Anzahlen. Alternativ lokal `bun scripts/nikolaus-retention-auto.ts --dry-run` verwenden.
4. Erst nach Kontrolle die Repository-Variable `NIKOLAUS_RETENTION_ENABLED=true` setzen (erledigt). Die tägliche Ausführung und ein ausdrücklich gewählter manueller Lauf mit `dry_run=false` dürfen dann löschen. Zum Deaktivieren die Variable entfernen oder auf `false` setzen.

Der Job speichert zuerst die Löschtermine aller Saisons. Für jede fällige Saison löscht er dann in **einer Transaktion**: Er sperrt die Nikolaus-Tabellen, berechnet die Auswahl neu und löscht Dispo- und Einteilungszeilen der ausgewählten Tage, die Buchungen und die Helfenden samt Verfügbarkeit sowie den Geocoding-Cache (Tempo und eine laufende Reservierung bleiben). Schlägt etwas fehl, bleibt alles unverändert. Anfragen, die während des Laufs schreiben wollen, warten die wenigen Sekunden; wer eine gelöschte Buchung vorher geladen hat, bekommt beim Speichern einen Versionskonflikt. Eine Wartungssperre für die Website ist deshalb nicht nötig.

Der Bericht jeder Saison steht unter `retention:run:<Jahr>` in `nikolaus.state`. Er enthält Anzahlen, IDs zurückgehaltener Datensätze und Gründe, keine Namen, Adressen, E-Mails oder Tokens. GitHub-Ausgaben enthalten nur Anzahlen, Saisonjahre und Status. Zurückgehaltene Datensätze (`retained`) führen zu `partial` mit Exit-Code 1 und brauchen Nicos Prüfung:

- `dependent_dispo_outside_cutoff`: eine Buchung ist noch an einem Tag nach dem Stichtag eingeplant.
- `availability_outside_cutoff`: eine Person hat sich auch für einen Tag nach dem Stichtag gemeldet.
- `dependent_einteilung_outside_cutoff`: eine Person ist nach dem Stichtag eingeteilt.
- `unclassified_availability`: eine Person ohne Verfügbarkeit, also ohne Datum.

Die Löschung entfernt die Daten aus der Datenbank. In den automatischen Sicherungen von Azure SQL bleiben sie noch bis zu 7 Tage ([azure-sql.md](azure-sql.md#wiederherstellen)), danach sind sie endgültig weg. Bereits versandte E-Mails und lokale Exporte erfasst der Lauf nicht; deren Aufbewahrung muss der Betreiber zusätzlich festlegen.

## Hängende Geocoding-Reservierung

Eine Geocoding-Reservierung verfällt absichtlich nicht automatisch: Ein pausierter Prozess könnte sonst nach Ablauf weiter Anfragen an den Anbieter schicken. Stürzt ein Prozess mitten in einer Anfrage ab, bleibt die Reservierung stehen und Adressen werden bis zur Wiederherstellung nicht mehr verortet (Buchungen gehen mit `nicht ermittelt` weiter).

```bash
bun scripts/nikolaus-maintenance.ts --status
```

Nico prüft anhand des Status, ob der angezeigte Prozess wirklich beendet ist; Alter oder fehlende Logs allein reichen nicht. Erst danach mit genau dem angezeigten Besitzer:

```bash
bun scripts/nikolaus-maintenance.ts --recover --geocoding-owner <Besitzer> --processes-stopped-confirmed
```

Cache und Tempo bleiben dabei erhalten; ein fremder Besitzer wird nie entfernt.

## Löschlauf von Hand

Für die aktuell konfigurierten Besuchstage 5. und 6. Dezember 2026 gilt: Findet der letzte Besuch tatsächlich am **6. Dezember 2026** statt, übernimmt Nico Welles die Löschung am **6. Januar 2027**. Der Auswahlstichtag ist dann **7. Dezember 2026**, damit auch der letzte Besuchstag erfasst wird. Vor einem echten Lauf die tatsächlichen Besuchsdaten prüfen und die Beispielwerte gegebenenfalls anpassen. Ausführung in `api/` mit den passenden Umgebungsvariablen oder einer lokalen `local.settings.json`.

Vorschau, ohne etwas zu löschen:

```bash
bun scripts/nikolaus-retention.ts --season 2026 --before 2026-12-07 --responsible "Nico Welles" --output /sicherer/pfad/nikolaus-2026-vorschau.json
```

Die Vorschau enthält die IDs der Buchungen und Helfenden, die betroffenen Tage, Anzahlen und die zurückgehaltenen Datensätze, aber keine Familiennamen, Adressen oder E-Mails. Die Datei ist nur für den ausführenden Benutzer lesbar und gehört nicht ins Repository. Prüfen: Stimmen Saison und Stichtag? Sind alle gewünschten Buchungen erfasst? Bleiben Daten einer kommenden Saison erhalten? Gibt es `retained`-Einträge?

Löschen mit denselben Angaben und `--apply`:

```bash
bun scripts/nikolaus-retention.ts --season 2026 --before 2026-12-07 --responsible "Nico Welles" --apply --output /sicherer/pfad/nikolaus-2026-bericht.json
```

Der Lauf berechnet die Auswahl in der Transaktion neu und löscht wie der automatische Lauf. Ein Stichtag in der Zukunft wird abgelehnt. `complete=true` steht im Bericht nur, wenn danach nichts Ausgewähltes und nichts Zurückgehaltenes übrig ist; sonst endet der Befehl mit Exit-Code 1.

## Saison wechseln

1. Nico Welles prüft das letzte Besuchsdatum und kontrolliert den automatischen Lauf einen Kalendermonat danach. Bis zur Aktivierung übernimmt er den manuellen Lauf mit Vorschau. Bei einer Änderung der vorläufigen Regel den Beschluss hier aktualisieren.
2. Ausdrücklich erhaltene Daten anderer Saisons und `retained`-Fälle prüfen. Keine alten Teamzuordnungen durch eine neue Konfiguration versehentlich wieder aktivieren.
3. `days`, Teamzahlen, Uhrzeiten sowie `staffActive` und `publicActive` in `api/lib/nikolaus-config.ts` für die kommende Saison festlegen.
4. Kapazitäten, Bestätigung, Änderung, Storno, Dispo und Fahrtansicht mit lokalen Mock-Daten prüfen. In der echten Datenbank Tests ausschließlich als `TEST – bitte löschen` oder mit `scripts/nikolaus-testdata.ts` anlegen und sofort wieder entfernen.
5. Nach Deployment Datenbankzugriff, Mailversand und Geocoding-Messung prüfen, dann die öffentliche Buchung freigeben.

## Fahrtansicht bei Funklöchern

Die lokale Teamroute, ausstehende Besuchsmarkierungen und deren Löschung sind in
[nikolaus-offline.md](nikolaus-offline.md) beschrieben.
