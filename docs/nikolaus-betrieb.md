# Nikolausdienst betreiben

Stand: 1. Oktober 2026. Es ist kein bisheriger Löschlauf bekannt. Der neue Ablauf ist ein manuell gestarteter Löschlauf mit Vorschau. Er läuft weder automatisch nach einem Besuch noch nach einer angenommenen gesetzlichen Frist. Die öffentliche Besuchsseite nennt deshalb keine unbestätigte Anzahl von Tagen.

## Verantwortung und Frist festlegen

Für die Einführung dieses Ablaufs wird die Rolle **Nikolauskoordination** vorgeschlagen. Vor dem ersten Lauf muss der Stamm diese Rolle einer Person zuweisen und den Löschtermin für die jeweilige Saison festlegen. Das ist eine neue Betriebszuweisung, keine Aussage über eine bereits bestehende Zuständigkeit. `--responsible` hält die beauftragte Rolle im Ergebnis fest. `--before` setzt den ausdrücklich gewählten Stichtag. Ohne diese Werte entsteht kein Löschplan.

Ein Datum wird gelöscht, wenn es zur gewählten Saison gehört und **vor** dem Stichtag liegt. Der Lauf umfasst alle Buchungsstatus, einschließlich ausstehender, stornierter und abgelaufener Buchungen. Er berücksichtigt die zugehörigen Dispo-Zeilen, Helfendeneinteilungen und dauerhaften Planungssnapshots. Helfende mit Verfügbarkeit außerhalb der Auswahl bleiben erhalten. Solche Fälle stehen unter `retained` und müssen einzeln geprüft werden. Angaben ohne zuverlässig zuordenbares Datum lassen sich nicht allein anhand eines Jahres sicher auswählen.

## Gemeinsamen Zustand einrichten

Produktionsumgebung, Preview-Umgebungen und jede Azure-Functions-Instanz müssen für dieselbe Website dieselbe Liste aus `SHAREPOINT_NIKOLAUS_STATE_LIST_ID` verwenden. Die Textspalte `OperationKey` muss indiziert sein und eindeutige Werte erzwingen. Die mehrzeilige Textspalte `State` speichert JSON. Liste und Graph-Berechtigungen müssen vor dem Deployment eingerichtet sein. Fehlende oder beschädigte gemeinsame Geocoding-Konfiguration führt zu `unavailable`; sie führt zu keiner unkoordinierten Anfrage an den Anbieter.

`NIKOLAUS_STATE_SECRET` muss mindestens 32 Zeichen lang und in allen beteiligten Umgebungen identisch sein. Es bildet HMAC-Schlüssel für Adress-Lookups. Die Liste enthält keine Klartextadressen im Geocoding-Schlüssel; die zwischengespeicherten Koordinaten sind trotzdem Standortdaten. Die Planungssnapshots enthalten die für die Planung erforderlichen Daten und gehören in dieselbe Zugriffsbeschränkung wie die Nikolauslisten.

Die Spalten dürfen nicht von Hand während laufender Requests geändert werden. Ein Wechsel der State-Liste pro Preview würde die Gesamtbegrenzung aufheben. Eine Änderung des Secrets verwirft die bisherige Zuordnung von Cache-Schlüsseln; sie hebt die gemeinsame Sperre und das gemeinsame Tempo nicht auf.

Größere Snapshots werden ab 50.000 JSON-Zeichen komprimiert. Pro Datensatz gelten höchstens 60.000 gespeicherte Zeichen und 1 MB unkomprimiertes JSON. Übergröße wird vor dem Schreiben mit HTTP 413 abgelehnt; die gespeicherte Planung bleibt erhalten. Auch der Löschlauf verwendet dieses Speicherformat. Details zur Übernahme der Altlisten stehen in [Planungen speichern und wiederherstellen](nikolaus-planungen.md).

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

**Vor dem Merge einrichten:** In allen drei Umgebungen fehlen `SHAREPOINT_NIKOLAUS_STATE_LIST_ID`, `NIKOLAUS_STATE_SECRET`, `NIKOLAUS_MAIL_HOURLY_LIMIT` und `NIKOLAUS_MAIL_DAILY_LIMIT`. Die Liste mit eindeutiger indizierter Spalte muss vorhanden sein und alle Umgebungen müssen dieselbe Liste und dasselbe Secret verwenden. Die beiden Maillimits sind optional; ohne Werte gelten die unten dokumentierten Defaults. Für die Betriebsabnahme Application Insights nach der [Microsoft-Anleitung](https://learn.microsoft.com/en-us/azure/static-web-apps/monitor) einrichten, anschließend die neuen Ereignisse unter realer Last prüfen. Diese Änderung hat keine Azure-Ressourcen, Appsettings oder produktiven Listen geändert.

## Gemeinsame Mailquote

Alle Nikolaus-Mails reservieren vor dem Versand atomar einen Platz in `mailquota:<Hash des normalisierten Absenders>`. Standard sind 100 Zulassungen pro UTC-Stunde und 500 pro UTC-Tag, einstellbar mit `NIKOLAUS_MAIL_HOURLY_LIMIT` und `NIKOLAUS_MAIL_DAILY_LIMIT` (positive ganze Zahlen). Diese Werte sind Anwendungsgrenzen, keine Behauptung über Azure- oder Exchange-Limits. Produktion, Previews und alle Instanzen teilen das Budget bei gemeinsamem Absender und gemeinsamer State-Liste. Für alle Umgebungen dieselben Grenzwerte einstellen. Die Sammelbestellung besitzt ihre eigene Quote; bei gleichem Postfach müssen die Betriebsverantwortlichen die Gesamtbudgets aufeinander abstimmen.

Die Erstellung reserviert vor dem Anlegen einer Buchung. Das Neusenden reserviert vor der Suche nach der E-Mail-Adresse, sodass eine erschöpfte Quote bei bekannten und unbekannten Adressen dieselbe Antwort liefert. Erschöpfung ergibt HTTP 429 `MAIL_QUOTA`, ein fehlender oder nicht lesbarer gemeinsamer Speicher HTTP 503 `MAIL_UNAVAILABLE`. In beiden Fällen werden weder neue Buchungen noch Link-Mails erzeugt. Weitere Buchungsänderungen bleiben bei einem Ausfall der anschließenden Informationsmail gespeichert und protokollieren den Versandfehler wie bisher.

Eine Zulassung wird bei Fehlern, Konflikten, ungewissen Graph-Antworten oder einer unbekannten Adresse nicht zurückgebucht. Das vermeidet einen unbeabsichtigten zusätzlichen Versand, kann das Budget aber früher ausschöpfen. Ein reservierter Versandplatz ist nur einmal im reservierenden Prozess verwendbar. HTTP-Antworten und Logs enthalten keine Empfängeradresse; Logs zur Erschöpfung enthalten nur Ereignis und Absenderhash.

## Geocoding messen und kontrollieren

Der bisherige Code begrenzte Anfragen nur pro Prozess. Tatsächliche Azure-Instanzzahlen und historische Anfragen lassen sich daraus nicht ableiten. Der lokale Prozess-Test mit drei getrennten Node-Prozessen bestätigt die Zusammenfassung identischer Lookups und mindestens 1.100 ms Abstand verschiedener Requests. Er ersetzt keine Azure-Messung.

Vor der produktiven Freigabe sollen die Azure-verantwortlichen Personen in Application Insights einen Zeitraum mit Buchungsbetrieb prüfen und die Ergebnisse festhalten:

| Messwert                                                       | Quelle                                                | Ergebnis                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Beobachtete Functions-Instanzen in einem festgelegten Zeitraum | `cloud_RoleInstance` in Requests/Dependencies/Traces  | Nicht messbar: kein Application Insights / Log Analytics vorhanden         |
| Bisherige Nominatim-Anfragen, gesamt und je Instanz            | `dependencies`, falls die HTTP-Aufrufe erfasst wurden | Nicht messbar: keine historische Dependency-Telemetrie verfügbar           |
| Gemeinsame State-Liste für Produktion und alle Previews        | Azure-Appsettings, nur IDs vergleichen                | In `default`, `103`, `108` noch nicht eingerichtet; vor Merge erforderlich |
| Abstände nach Einführung der Koordination                      | `nikolaus_geocoding`-Trace-Ereignisse                 | Nach Deployment prüfen                                                     |

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

Bei Sampling können Requests fehlen. Für die Abnahme muss deshalb die Aufzeichnung dieser Ereignisse vollständig sein oder Sampling muss für den Messzeitraum deaktiviert werden. Unterschiedliche Host-Uhren beeinflussen eine Auswertung anhand der Startzeit; Azure-Zeitsynchronisation muss funktionieren. Jede Anfrage wartet auch nach dem Erwerb der gemeinsamen Sperre ein vollständiges lokales Intervall. Nach einem abgestürzten Worker wartet die Übernahme über das Ende seiner 45-sekündigen Lease hinaus auf das Ende eines möglichen letzten Requests und den Mindestabstand.

Die Anwendung serialisiert vollständige Lookups über `geocoding:nominatim`. Erfolgreiche Ergebnisse bleiben für höchstens 24 Stunden verwendbar, höchstens 100 Ergebnisse gleichzeitig. Identische wartende Aufrufe lesen anschließend dasselbe Ergebnis. Fehler bleiben fünf Sekunden gemeinsam sichtbar, damit eine Anbieter-Störung keine unmittelbare zweite identische Anfrage auslöst. Wartende Aufrufe haben 30 Sekunden Wartebudget; pro Prozess warten höchstens sechs unterschiedliche Lookups. Bei State-Ausfällen, verlorenen Sperren oder voller Warteschlange kann die Buchung mit `nicht ermittelt` statt automatisch bestimmten Koordinaten weitergehen.

## Geocoding-Anbieter und Nutzungsregeln

Die [offizielle Nominatim-Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/nominatim/) begrenzt die gesamte Anwendung auf höchstens einen Request pro Sekunde. Sie verlangt einen identifizierenden User-Agent, Attribution und Caching, untersagt unter anderem Autocomplete und systematische Reverse-Abfragen und fordert, keine persönlichen oder vertraulichen Informationen zu übermitteln. Die verantwortlichen Personen müssen die übermittelten Angaben und den gewählten Anbieter prüfen. Die bestehende Anwendung übermittelt eine Anschrift als Suchanfrage; Namen, Telefonnummern, E-Mails und Angaben über Kinder gehen nicht an den Geocoding-Anbieter.

`NIKOLAUS_GEOCODING_URL` ermöglicht einen Anbieterwechsel ohne Code-Deployment. Ohne Wert bleibt der vorhandene Nominatim-Endpunkt eingestellt. Der konfigurierte Anbieter muss die Nominatim-Suchparameter und das JSON-Antwortformat unterstützen und über HTTPS erreichbar sein. Die gemeinsame Begrenzung bleibt auch bei einem Wechsel bestehen. Die Karte muss ihre bestehende OpenStreetMap-Attribution behalten. Automatische Dependency-Telemetrie darf Such-URLs mit Adressparametern nicht als frei einsehbare Logs speichern; die oben beschriebenen Zählereignisse reichen für die Abnahme.

`api/scripts/nikolaus-testdata.ts` verwendet jetzt erfundene lokale Adressen und synthetische Koordinaten. Es führt keine Nominatim-Reverse-Abfragen mehr aus und kann das Gesamtlimit nicht umgehen. Seine Daten heißen `TEST – bitte löschen`. Der Generator wurde für diese Änderung nicht gegen produktive Listen ausgeführt.

## Löschvorschau erstellen

Die folgenden Beispielwerte sind keine beschlossene Frist. Saison, Stichtag und Rolle müssen vor einem echten Lauf entsprechend dem Beschluss des Stammes ersetzt werden. Ausführung erfolgt in `api/` mit den passenden Umgebungsvariablen oder einer lokalen `local.settings.json`.

```bash
bun scripts/nikolaus-retention.ts --season 2026 --before 2027-01-01 --responsible Nikolauskoordination --plan /sicherer/pfad/nikolaus-2026-plan.json
```

Ohne `--apply` liest der Befehl nur SharePoint und speichert die Vorschau lokal. Die Vorschau enthält Listen-IDs der einzelnen Datensätze, ETags und die betroffenen Zustandsoperationen, aber keine Familiennamen, Adressen oder E-Mails. Dateien sind nur für den ausführenden Benutzer lesbar. Sie sollen außerhalb des Repositories liegen. Ein Hash bindet den Plan an die Ziel-Site und die konkreten Listen. Ein weiterer Hash erkennt versehentliche Änderungen am Plan.

Die Vorschau prüfen: Stimmen Saison und Stichtag? Sind alle gewünschten Buchungen erfasst? Sind ältere Dispo-Snapshots und Einteilungen enthalten? Werden Daten einer kommenden Saison erhalten? Gibt es `retained`-Einträge mit Verfügbarkeit oder Abhängigkeiten außerhalb des Stichtags? Die Rolle muss diese Fälle vor Abschluss des Saisonwechsels klären.

Das Laden folgt allen SharePoint-Folgeseiten. Fehlende ETags, ungültige Datumswerte oder beschädigte Planungssnapshots stoppen den Lauf. Eine laufende Geocoding-Lease verhindert auch das Erstellen einer Vorschau, die den Standortcache bereinigt.

## Geprüften Plan anwenden

Vor dem Anwenden ein Wartungsfenster herstellen: öffentliche Buchungen und Änderungen aus dem Leitendenbereich stoppen und sicherstellen, dass keine bereits laufenden Requests mehr schreiben. Alle Preview-Umgebungen einbeziehen. `--maintenance-confirmed` bestätigt diese vom Betreiber hergestellte Voraussetzung; der Schalter richtet selbst keine Azure-Sperre ein. Mindestens 60 Sekunden nach dem letzten möglichen Geocoding-Aufruf warten. Das verhindert auch eine Übernahme alter Lookups während der Cache-Bereinigung.

```bash
bun scripts/nikolaus-retention.ts --apply --maintenance-confirmed --plan /sicherer/pfad/nikolaus-2026-plan.json --report /sicherer/pfad/nikolaus-2026-ergebnis.json
```

Der Befehl verwendet ausschließlich den gespeicherten Plan. Er prüft die aktuellen Datensätze erneut. Neue zu löschende Zeilen oder geänderte ETags erfordern eine neue Vorschau. Ein Stichtag in der Zukunft kann nicht angewendet werden. Dispo, Einteilung und ihre Snapshots werden zuerst gelöscht beziehungsweise gefiltert. Vor jeder Elternlöschung werden Abhängigkeiten erneut gelesen. Die verbleibenden Einteilungsdaten anderer Saisons bleiben erhalten. Der Geocoding-Cache wird geleert; seine Begrenzung und der letzte Mindestabstand bleiben bestehen.

Jede Änderung und Löschung verwendet das ETag aus der Vorschau. Ein Konflikt mit HTTP 412 stoppt den Lauf und erhält noch nicht gelöschte Eltern. Nach einem Fehler werden weitere Operationen übersprungen. Bereits fehlende Datensätze gelten als gelöscht; bereits bereinigte Snapshots werden erkannt. Derselbe Plan kann deshalb einen abgebrochenen Lauf fortsetzen, solange die verbleibenden Daten weiterhin der Vorschau entsprechen. Temporäre Fehler 429, 503 und 504 werden höchstens dreimal versucht.

Der Bericht wird nach jeder Operation gespeichert und enthält Status, Anzahl der Versuche und einen Fehlercode. Er enthält weder Graph-Fehlertexte noch Buchungsdaten. Am Ende prüft ein erneutes Lesen, ob noch ausgewählte Operationen oder ausdrücklich zurückgehaltene Datensätze übrig sind. Nur dann ist `complete=true`; ein unvollständiger Lauf endet mit Exit-Code 1. Vor dem nächsten Saisonwechsel den Bericht kontrollieren und den Abschluss durch die beauftragte Rolle festhalten.

Die Graph-Löschung entfernt Daten aus den aktiven Listen. Sie ist keine Zusage einer sofortigen endgültigen Löschung aus SharePoint-Papierkörben, Versionsverläufen, Backups, bereits versandten E-Mails oder lokalen Exporten. Deren Aufbewahrung und Bereinigung muss der Betreiber zusätzlich festlegen. Kopien oder Exporte, die nach dem Besuch nicht mehr gebraucht werden, gehören in denselben Betriebsbeschluss.

## Saison wechseln

1. Löschfrist und Verantwortungsrolle beschließen, geprüften Plan anwenden und Bericht kontrollieren.
2. Ausdrücklich erhaltene Daten anderer Saisons und `retained`-Fälle prüfen. Keine alten Teamzuordnungen durch eine neue Konfiguration versehentlich wieder aktivieren.
3. `days`, Teamzahlen, Uhrzeiten sowie `staffActive` und `publicActive` in `api/lib/nikolaus-config.ts` für die kommende Saison festlegen.
4. Kapazitäten, Bestätigung, Änderung, Storno, Dispo und Fahrtansicht mit lokalen Mock-Daten prüfen. Für reale Listen Tests ausschließlich als `TEST – bitte löschen` anlegen und sofort wieder entfernen.
5. Nach Deployment gemeinsame State-Konfiguration, Mailversand und Geocoding-Messung prüfen, dann die öffentliche Buchung freigeben.
