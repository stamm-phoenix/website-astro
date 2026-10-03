# Nikolausdienst betreiben

Stand: 2. Oktober 2026. Es ist kein bisheriger Löschlauf bekannt. Im Draft-PR ist ein täglicher automatischer Löschlauf vorbereitet. Er bleibt bis zur späteren Einrichtung deaktiviert. Nico Welles kontrolliert Ergebnisse und Fehler; die vorläufige Frist beträgt einen Kalendermonat nach dem letzten Besuch der Saison. Ein manueller Lauf mit Vorschau bleibt verfügbar.

## Verantwortung und Frist

Am 2. Oktober 2026 wurde für diesen Ablauf festgelegt: **Nico Welles** ist verantwortlich; die Daten werden **vorerst einen Kalendermonat nach dem letzten tatsächlich erfolgten Besuch der Saison** gelöscht. Nach Aktivierung berechnet der tägliche Job den Löschtermin. Nico prüft die erfassten Besuchsdaten, kontrolliert Ergebnisse und klärt Fehler sowie zurückgehaltene Daten. Bei einem verschobenen letzten Besuch verschiebt sich der Löschtermin entsprechend. Diese neue Betriebszuweisung beschreibt keinen bereits früher ausgeführten Löschlauf.

`--responsible "Nico Welles"` hält die verantwortliche Person im Ergebnis fest. `--before` wählt Besuchsdaten für die Vorschau aus; es ist **nicht der Ausführungstermin** und setzt keine automatische Monatsfrist durch. Der Stichtag liegt am Tag nach dem letzten zu bereinigenden Besuchsdatum. Nico wendet den geprüften Plan erst zum festgelegten Löschtermin an. Ohne Saison, Stichtag und Verantwortungsangabe entsteht kein Löschplan.

Ein Datum wird gelöscht, wenn es zur gewählten Saison gehört und **vor** dem Stichtag liegt. Der Lauf umfasst alle Buchungsstatus, einschließlich ausstehender, stornierter und abgelaufener Buchungen. Er berücksichtigt die zugehörigen Dispo-Zeilen, Helfendeneinteilungen und dauerhaften Planungssnapshots. Helfende mit Verfügbarkeit außerhalb der Auswahl bleiben erhalten. Solche Fälle stehen unter `retained` und müssen einzeln geprüft werden. Angaben ohne zuverlässig zuordenbares Datum lassen sich nicht allein anhand eines Jahres sicher auswählen.

## Gemeinsamen Zustand einrichten

Produktionsumgebung, Preview-Umgebungen und jede Azure-Functions-Instanz müssen für dieselbe Website dieselbe Liste verwenden. Ihre ID steht als `CONFIG.sharepoint.lists.nikolausState` in `api/lib/config.ts` und gilt damit automatisch für alle Umgebungen. Die Textspalte `OperationKey` muss indiziert sein und eindeutige Werte erzwingen. Die mehrzeilige Textspalte `State` speichert JSON. Liste und Graph-Berechtigungen müssen vor dem Deployment eingerichtet sein. Fehlende oder beschädigte gemeinsame Geocoding-Konfiguration führt zu `unavailable`; sie führt zu keiner unkoordinierten Anfrage an den Anbieter.

`NIKOLAUS_STATE_SECRET` muss mindestens 32 Zeichen lang und in allen beteiligten Umgebungen identisch sein. Es bildet HMAC-Schlüssel für Adress-Lookups. Die Liste enthält keine Klartextadressen im Geocoding-Schlüssel; die zwischengespeicherten Koordinaten sind trotzdem Standortdaten. Die Planungssnapshots enthalten die für die Planung erforderlichen Daten und gehören in dieselbe Zugriffsbeschränkung wie die Nikolauslisten.

Die Spalten dürfen nicht von Hand während laufender Requests geändert werden. Ein Wechsel der State-Liste pro Preview würde die Gesamtbegrenzung aufheben. Eine Änderung des Secrets verwirft die bisherige Zuordnung von Cache-Schlüsseln; sie hebt die gemeinsame Sperre und das gemeinsame Tempo nicht auf.

Größere Snapshots werden ab 50.000 JSON-Zeichen komprimiert. Pro Datensatz gelten höchstens 60.000 gespeicherte Zeichen und 1 MB unkomprimiertes JSON. Übergröße wird vor dem Schreiben mit HTTP 413 abgelehnt; die gespeicherte Planung bleibt erhalten. Auch der Löschlauf verwendet dieses Speicherformat. Details zur Übernahme der Altlisten stehen in [Planungen speichern und wiederherstellen](nikolaus-planungen.md).

## Azure-Einrichtung vom 2. Oktober 2026

Nach ausdrücklicher Freigabe wurden die gemeinsamen Appsettings in `default`, `103`, `108`, `155` und `161` gesetzt und zurückgelesen. Alle verwenden die Liste `NikolausZustand` mit ID `0e1d6c9b-0d49-4428-8564-16b8ccc01929`, dasselbe Secret und die Mailgrenzen 100/Stunde sowie 500/Tag. Die erforderlichen Spalten `OperationKey` und `State` wurden über die Website-App geprüft. Ein unmittelbar wieder entfernter Datensatz mit Titel `TEST – bitte löschen` bestätigte Schreiben, ETag-Konflikte und die eindeutige Schlüsselspalte.

In der Ressourcengruppe `website-astro` wurden `website-astro-logs` und das damit verbundene Application Insights `website-astro-insights` in West Europe angelegt. Der Arbeitsbereich verwendet 30 Tage Aufbewahrung und ein tägliches Ingestionslimit von 0,1 GB. Das Limit ist keine harte Kostengarantie und kann weitere Aufzeichnungen bis zum nächsten Tag unterbrechen. [Microsoft beschreibt diese Einschränkungen](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

Die `host.json` deaktiviert automatisches Dependency-Tracking, damit Anbieter-URLs mit Adressen nicht als Dependencies erfasst werden. Sampling ist deaktiviert, damit die gezielt geschriebenen Geocoding-Ereignisse vollständig gezählt werden können. Azure Static Web Apps lehnte entsprechende Laufzeit-Overrides ab, weil deren Namen mehr als 64 Zeichen enthalten. Daher muss diese Host-Konfiguration vor der Insights-Verknüpfung ausgerollt sein. Zunächst wird nur die Vorschau #155 mit Insights verbunden; Produktion und ältere Vorschauen werden erst nach Deployment der passenden Host-Konfiguration verbunden. [Microsoft dokumentiert die Host-Konfiguration](https://learn.microsoft.com/en-us/azure/azure-functions/configure-monitoring).

Historische Anfragen und Instanzzahlen bleiben nicht verfügbar. Eine Abnahme unter tatsächlicher Geocoding-Last steht aus. Die neue Infrastruktur aktiviert keinen automatischen Löschlauf; die Repository-Aktivierungsvariable und das Lösch-Environment wurden nicht eingerichtet.

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

Alle Nikolaus-Mails reservieren vor dem Versand atomar einen Platz in `mailquota:<Hash des normalisierten Absenders>`. Eingestellt sind 100 Zulassungen pro UTC-Stunde und 500 pro UTC-Tag (`CONFIG.nikolaus.mailHourlyLimit` und `mailDailyLimit` in `api/lib/config.ts`, positive ganze Zahlen; eine Änderung braucht einen PR und ein Deployment). Diese Werte sind Anwendungsgrenzen, keine Behauptung über Azure- oder Exchange-Limits. Produktion, Previews und alle Instanzen teilen das Budget bei gemeinsamem Absender und gemeinsamer State-Liste. Die Sammelbestellung besitzt ihre eigene Quote; bei gleichem Postfach müssen die Betriebsverantwortlichen die Gesamtbudgets aufeinander abstimmen.

Die Erstellung reserviert vor dem Anlegen einer Buchung. Das Neusenden reserviert vor der Suche nach der E-Mail-Adresse, sodass eine erschöpfte Quote bei bekannten und unbekannten Adressen dieselbe Antwort liefert. Erschöpfung ergibt HTTP 429 `MAIL_QUOTA`, ein fehlender oder nicht lesbarer gemeinsamer Speicher HTTP 503 `MAIL_UNAVAILABLE`. In beiden Fällen werden weder neue Buchungen noch Link-Mails erzeugt. Weitere Buchungsänderungen bleiben bei einem Ausfall der anschließenden Informationsmail gespeichert und protokollieren den Versandfehler wie bisher.

Eine Zulassung wird bei Fehlern, Konflikten, ungewissen Graph-Antworten oder einer unbekannten Adresse nicht zurückgebucht. Das vermeidet einen unbeabsichtigten zusätzlichen Versand, kann das Budget aber früher ausschöpfen. Ein reservierter Versandplatz ist nur einmal im reservierenden Prozess verwendbar. HTTP-Antworten und Logs enthalten keine Empfängeradresse; Logs zur Erschöpfung enthalten nur Ereignis und Absenderhash.

## Geocoding messen und kontrollieren

Der bisherige Code begrenzte Anfragen nur pro Prozess. Tatsächliche Azure-Instanzzahlen und historische Anfragen lassen sich daraus nicht ableiten. Der lokale Prozess-Test mit drei getrennten Node-Prozessen bestätigt die Zusammenfassung identischer Lookups und mindestens 1.100 ms Abstand verschiedener Requests. Er ersetzt keine Azure-Messung.

Vor der produktiven Freigabe sollen die Azure-verantwortlichen Personen in Application Insights einen Zeitraum mit Buchungsbetrieb prüfen und die Ergebnisse festhalten:

| Messwert                                                       | Quelle                                                | Ergebnis                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Beobachtete Functions-Instanzen in einem festgelegten Zeitraum | `cloud_RoleInstance` in Requests/Traces               | Nach Verknüpfung und Deployment messen                              |
| Bisherige Nominatim-Anfragen, gesamt und je Instanz            | `dependencies`, falls die HTTP-Aufrufe erfasst wurden | Nicht messbar: keine historische Dependency-Telemetrie verfügbar    |
| Gemeinsame State-Liste für Produktion und alle Previews        | Azure-Appsettings, nur IDs vergleichen                | In `default`, `103`, `108`, `155`, `161` am 2. Oktober eingerichtet |
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

`api/scripts/nikolaus-testdata.ts` verwendet jetzt erfundene lokale Adressen und synthetische Koordinaten. Es führt keine Nominatim-Reverse-Abfragen mehr aus und kann das Gesamtlimit nicht umgehen. Seine Daten heißen `TEST – bitte löschen`. Der Generator wurde für diese Änderung nicht gegen produktive Listen ausgeführt.

## Automatischen Lauf später aktivieren

Der Workflow [nikolaus-retention.yml](../.github/workflows/nikolaus-retention.yml) prüft täglich um 03:39 UTC auf `main`, welche Saisons fällig sind. Ohne die Repository-Variable `NIKOLAUS_RETENTION_ENABLED=true` wird sein Schreibjob übersprungen. Auch das CLI greift bei deaktivierter Automatik ohne `--dry-run` oder `--show-target` auf keine Daten zu. Im Draft wurden keine Variablen, Secrets, GitHub-Environments, Azure-Ressourcen oder Appsettings eingerichtet und keine echten Löschungen ausgeführt.

Managed Functions der Static Web App unterstützen [nur HTTP-Trigger](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions). Deshalb übernimmt GitHub Actions den Zeitplan. [Geplante Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) können verspätet starten; in öffentlichen Repositories werden sie nach 60 Tagen ohne Aktivität deaktiviert. Nico kontrolliert deshalb auch, ob der tägliche Job weiterhin läuft. Eine exakte Ausführung um Mitternacht ist nicht zugesagt.

Die Monatsfrist wird als Kalenderdatum in `Europe/Berlin` berechnet. Aus dem 6. Dezember wird der 6. Januar; aus dem 31. Januar wird der letzte Februartag. Der späteste bekannte Buchungs-, Planungs- oder Verfügbarkeitstag bildet eine vorsichtige Untergrenze. Ein später tatsächlich erfasster Besuch verlängert die Frist. Neue Besuchsabschlüsse speichern dafür einen vollständigen Serverzeitstempel. Alte Einträge mit ausschließlich einer Uhrzeit können mehrtägige Verschiebungen nicht abbilden; Nico muss diese vor Aktivierung prüfen. Ein gespeicherter Termin unter `retention:schedule:<Jahr>` kann durch einen Teilabbruch späterer Bereinigung nicht vorgezogen werden.

Die spätere Einrichtung umfasst:

1. Dieselbe State-Liste für Produktion und sämtliche Vorschauen bereitstellen und den neuen Code überall ausrollen. Alte Vorschauen aktualisieren oder schließen.
2. Das geschützte GitHub-Environment `nikolaus-retention` einrichten und dort das Secret `AZURE_CLIENT_CERT` hinterlegen. Tenant, App-Registrierung, Site und Listen-IDs kommen aus `api/lib/config.ts`. Der Zertifikat-Appzugang benötigt Graph-Schreibzugriff auf diese Site und Azure-Reader-Zugriff auf die konkrete Static Web App.
3. Mit der Zielkonfiguration `bun scripts/nikolaus-retention-auto.ts --show-target` ausführen. Der Befehl berechnet lokal einen Hash der Site und Listen. Diesen geprüften Hash als Repository-Variable `NIKOLAUS_RETENTION_TARGET_DIGEST` hinterlegen. Ändern sich Host, Site oder eine der Nikolaus-Listen-IDs in der Config, muss auch diese Variable angepasst werden. `CONFIG.nikolaus.retention.azureResourceId` bindet die Prüfung an die vollständige ARM-ID der Static Web App. Ohne passenden Hash wird nicht einmal der Listeninhalt gelesen.
4. Zunächst auf `main` einen `workflow_dispatch` mit `dry_run=true` ausführen. Er liest nur, beansprucht keine Schreibsperre und schreibt keinen Bericht. Die Ausgabe enthält ausschließlich Saisonjahre und Anzahlen. Alternativ lokal `bun scripts/nikolaus-retention-auto.ts --dry-run` verwenden.
5. Erst nach Kontrolle aller Voraussetzungen die Repository-Variable `NIKOLAUS_RETENTION_ENABLED=true` setzen. Die tägliche Ausführung und ein ausdrücklich gewählter manueller Lauf mit `dry_run=false` dürfen dann schreiben. Zum Deaktivieren die Variable entfernen oder auf `false` setzen.

Vor jeder fälligen Löschung registriert der Job einen eindeutigen Wartungsbesitzer unter `maintenance:nikolaus:writes`. Alle Nikolaus-Schreibpfade einschließlich Geocoding und Testdatengenerator registrieren ihre gesamte Operation dort. Neue Schreibanfragen erhalten während Wartung HTTP 503 `MAINTENANCE`; Lesezugriffe bleiben möglich. Bereits laufende Schreiber verhindern die Bereinigung. Der Job gibt dann seine eigene Sperre frei, meldet `busy` mit Exit-Code 1 und versucht es beim nächsten Lauf erneut.

Unter der Sperre liest der Job Produktion und alle Preview-Hostnamen aus Azure ARM. Er prüft jeden Host mit einem leeren, ungültigen Verwaltungstoken. Nur HTTP 503 `MAINTENANCE` mit `X-Nikolaus-Write-Gate: v1` und genau seinem aktuellen `X-Nikolaus-Maintenance-Owner` bestätigt dieselbe Sperre. Eine alte Vorschau, ein Speicherausfall, eine getrennte State-Liste oder ein unvollständiges Inventar verhindert sämtliche Löschungen. Es werden dabei weder echte Buchungen gelesen noch Mails gesendet. Die Deploy- und Preview-Schließjobs teilen dieselbe GitHub-Concurrency-Gruppe mit dem Löschjob; gestartete Deployments werden nicht durch neue PR-Pushes abgebrochen. Direkte Deployments und SharePoint-Änderungen außerhalb dieser Workflows müssen während Bereinigung organisatorisch unterbleiben.

Nach der Prüfung liest der Job die Daten erneut, berücksichtigt inzwischen abgeschlossene Besuche und erstellt je fälliger Saison einen frischen Plan. Abhängige Planungen werden vor Buchungen gelöscht oder gefiltert. Vor jeder weiteren Operation wird der Fortschritt unter `retention:run:<Jahr>` in der privaten State-Liste gespeichert. Ein Speicherfehler stoppt weitere Löschungen. Pläne und Berichte enthalten IDs, ETags, Status und Fehlercodes, keine Familiennamen, Adressen, E-Mails oder Verwaltungstokens. GitHub-Ausgaben enthalten nur Anzahlen, Saisonjahre und Status. Nico kontrolliert fehlgeschlagene Actions und private Berichte. Zurückgehaltene Helfendendaten mit Verfügbarkeit für mehrere Saisons führen zu `partial` und benötigen seine Prüfung. Ein erneuter Lauf kann bereits erfolgte Löschungen fortsetzen.

## Abgebrochene Prozesse und Schreibsperre prüfen

Schreiber und Wartungsbesitzer verfallen absichtlich nicht automatisch. Ein pausierter Prozess könnte sonst nach Ablauf seiner Sperre weiterschreiben. Ein abgestürzter Prozess kann deshalb eine manuelle Wiederherstellung nötig machen.

```bash
bun scripts/nikolaus-maintenance.ts --status
```

Nico prüft anhand des Status und der laufenden Prozesse, ob der betreffende Job beziehungsweise alle genannten Schreiber wirklich beendet wurden. Alter oder fehlende Logs allein reichen nicht. Erst danach die exakt angezeigten IDs verwenden:

```bash
bun scripts/nikolaus-maintenance.ts --recover --owner <Wartungsbesitzer> --writers <Schreiber-ID,weitere-ID> --processes-stopped-confirmed
```

Bei einem abgebrochenen Löschjob ohne registrierte Schreiber `--writers` weglassen. Gibt es nur zurückgebliebene Schreiber ohne Wartungsbesitzer, einen neuen eindeutigen Besitzer angeben; das Werkzeug beansprucht die Sperre vor der Bereinigung. Ein fremder Besitzer wird nie ersetzt. Solange weitere Schreiber registriert sind, wird die Wartung nicht freigegeben. Danach den automatischen Job erneut starten und den Abschluss kontrollieren. Im Draft wurde dieser Wiederherstellungsbefehl nicht gegen echte Daten ausgeführt.

## Löschvorschau erstellen

Für die aktuell konfigurierten Besuchstage 5. und 6. Dezember 2026 gilt: Findet der letzte Besuch tatsächlich am **6. Dezember 2026** statt, übernimmt Nico Welles die Löschung am **6. Januar 2027**. Der Auswahlstichtag ist dann **7. Dezember 2026**, damit auch der letzte Besuchstag erfasst wird. Vor einem echten Lauf die tatsächlichen Besuchsdaten prüfen und die Beispielwerte gegebenenfalls anpassen. Ausführung erfolgt in `api/` mit den passenden Umgebungsvariablen oder einer lokalen `local.settings.json`.

```bash
bun scripts/nikolaus-retention.ts --season 2026 --before 2026-12-07 --responsible "Nico Welles" --plan /sicherer/pfad/nikolaus-2026-plan.json
```

Ohne `--apply` liest der Befehl nur SharePoint und speichert die Vorschau lokal. Die Vorschau enthält Listen-IDs der einzelnen Datensätze, ETags und die betroffenen Zustandsoperationen, aber keine Familiennamen, Adressen oder E-Mails. Dateien sind nur für den ausführenden Benutzer lesbar. Sie sollen außerhalb des Repositories liegen. Ein Hash bindet den Plan an die Ziel-Site und die konkreten Listen. Ein weiterer Hash erkennt versehentliche Änderungen am Plan.

Die Vorschau prüfen: Stimmen Saison und Stichtag? Sind alle gewünschten Buchungen erfasst? Sind ältere Dispo-Snapshots und Einteilungen enthalten? Werden Daten einer kommenden Saison erhalten? Gibt es `retained`-Einträge mit Verfügbarkeit oder Abhängigkeiten außerhalb des Stichtags? Die Rolle muss diese Fälle vor Abschluss des Saisonwechsels klären.

Das Laden folgt allen SharePoint-Folgeseiten. Fehlende ETags, ungültige Datumswerte oder beschädigte Planungssnapshots stoppen den Lauf. Eine laufende Geocoding-Lease verhindert auch das Erstellen einer Vorschau, die den Standortcache bereinigt.

## Geprüften Plan anwenden

Auch der manuelle Lauf beansprucht die gemeinsame Schreibsperre und bricht bei registrierten Schreibern ab. Vor dem Anwenden ein Wartungsfenster herstellen: öffentliche Buchungen und Änderungen aus dem Leitendenbereich stoppen und sicherstellen, dass keine bereits laufenden Requests mehr schreiben. Alle Preview-Umgebungen einbeziehen. `--maintenance-confirmed` bestätigt diese vom Betreiber hergestellte Voraussetzung; der Schalter richtet selbst keine Azure-Sperre ein. Mindestens 60 Sekunden nach dem letzten möglichen Geocoding-Aufruf warten. Das verhindert auch eine Übernahme alter Lookups während der Cache-Bereinigung.

```bash
bun scripts/nikolaus-retention.ts --apply --maintenance-confirmed --plan /sicherer/pfad/nikolaus-2026-plan.json --report /sicherer/pfad/nikolaus-2026-ergebnis.json
```

Der Befehl verwendet ausschließlich den gespeicherten Plan. Er prüft die aktuellen Datensätze erneut. Neue zu löschende Zeilen oder geänderte ETags erfordern eine neue Vorschau. Ein Stichtag in der Zukunft kann nicht angewendet werden. Dispo, Einteilung und ihre Snapshots werden zuerst gelöscht beziehungsweise gefiltert. Vor jeder Elternlöschung werden Abhängigkeiten erneut gelesen. Die verbleibenden Einteilungsdaten anderer Saisons bleiben erhalten. Der Geocoding-Cache wird geleert; seine Begrenzung und der letzte Mindestabstand bleiben bestehen.

Jede Änderung und Löschung verwendet das ETag aus der Vorschau. Ein Konflikt mit HTTP 412 stoppt den Lauf und erhält noch nicht gelöschte Eltern. Nach einem Fehler werden weitere Operationen übersprungen. Bereits fehlende Datensätze gelten als gelöscht; bereits bereinigte Snapshots werden erkannt. Derselbe Plan kann deshalb einen abgebrochenen Lauf fortsetzen, solange die verbleibenden Daten weiterhin der Vorschau entsprechen. Temporäre Fehler 429, 503 und 504 werden höchstens dreimal versucht.

Der Bericht wird nach jeder Operation gespeichert und enthält Status, Anzahl der Versuche und einen Fehlercode. Er enthält weder Graph-Fehlertexte noch Buchungsdaten. Am Ende prüft ein erneutes Lesen, ob noch ausgewählte Operationen oder ausdrücklich zurückgehaltene Datensätze übrig sind. Nur dann ist `complete=true`; ein unvollständiger Lauf endet mit Exit-Code 1. Vor dem nächsten Saisonwechsel den Bericht kontrollieren und den Abschluss durch die beauftragte Rolle festhalten.

Die Graph-Löschung entfernt Daten aus den aktiven Listen. Sie ist keine Zusage einer sofortigen endgültigen Löschung aus SharePoint-Papierkörben, Versionsverläufen, Backups, bereits versandten E-Mails oder lokalen Exporten. Deren Aufbewahrung und Bereinigung muss der Betreiber zusätzlich festlegen. Kopien oder Exporte, die nach dem Besuch nicht mehr gebraucht werden, gehören in denselben Betriebsbeschluss.

## Saison wechseln

1. Nico Welles prüft das letzte Besuchsdatum und kontrolliert den automatischen Lauf einen Kalendermonat danach. Bis zur Aktivierung übernimmt er den manuellen Lauf mit Vorschau. Bei einer Änderung der vorläufigen Regel den Beschluss hier aktualisieren.
2. Ausdrücklich erhaltene Daten anderer Saisons und `retained`-Fälle prüfen. Keine alten Teamzuordnungen durch eine neue Konfiguration versehentlich wieder aktivieren.
3. `days`, Teamzahlen, Uhrzeiten sowie `staffActive` und `publicActive` in `api/lib/nikolaus-config.ts` für die kommende Saison festlegen.
4. Kapazitäten, Bestätigung, Änderung, Storno, Dispo und Fahrtansicht mit lokalen Mock-Daten prüfen. Für reale Listen Tests ausschließlich als `TEST – bitte löschen` anlegen und sofort wieder entfernen.
5. Nach Deployment gemeinsame State-Konfiguration, Mailversand und Geocoding-Messung prüfen, dann die öffentliche Buchung freigeben.
