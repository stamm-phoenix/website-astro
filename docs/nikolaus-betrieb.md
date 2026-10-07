# Nikolausdienst betreiben

Der Nikolausdienst wird im Leitendenbereich unter **Nikolausdienst → Steuerung** (`/leitendenbereich/nikolaus-steuerung`) eingerichtet und nach der Aktion bereinigt. Was dort steht, galt bis Oktober 2026 als Konfiguration in `api/lib/nikolaus-config.ts`, als App Setting `NIKOLAUS_WRITES_ENABLED` und als täglicher Löschlauf in GitHub Actions; diese gibt es nicht mehr.

Seit #165 liegen alle Nikolaus-Daten in Azure SQL statt in SharePoint-Listen; Einrichtung, Schema und Wiederherstellung stehen in [azure-sql.md](azure-sql.md). Die Abschnitte zur Azure-Prüfung und -Einrichtung vom 1. und 2. Oktober beschreiben den Stand davor.

## Die Steuerung

Alle angemeldeten Leitenden können die Steuerung öffnen und ändern. Jede Änderung und jede Löschung steht mit Person und Zeitpunkt im Protokoll unten auf der Seite (Tabelle `nikolaus.audit_log`).

| Einstellung | Wirkung |
| --- | --- |
| Online-Anmeldung aktiv | Menüeintrag „Nikolaus“, Banner auf der Startseite, Formular und FAQ auf `/nikolaus`; Familien können buchen und umbuchen. Aus: Die API lehnt neue Buchungen und Umbuchungen ab; bestehende Termine lassen sich weiter bestätigen, ändern und absagen. |
| Nikolausverwaltung aktiv | Module Anmeldungen, Dispo, Fahrt und Helfende im Leitendenbereich. Aus: Sie verschwinden von der Startseite, und ihre Endpunkte antworten mit 403 `NIKOLAUS_INACTIVE`. Die Steuerung bleibt immer erreichbar. |
| Wartungsmodus | Notschalter: alle Schreibzugriffe auf Nikolaus-Daten außer der Steuerung werden sofort mit 503 `MAINTENANCE` abgelehnt, von Familien wie im Leitendenbereich. Lesen bleibt möglich. |
| Besuchstage | Datum, Beginn des ersten und Ende des letzten Termins (Termine zu 30 Minuten) und Zahl der Teams (1 bis 4 = Buchungen pro Termin). |
| Reservierungsdauer, Änderungsfrist | Wie lange eine unbestätigte Anmeldung ihren Termin hält; bis wie viele Stunden vorher Familien selbst ändern, umbuchen und absagen. |
| Einsatzgebiet | Startpunkt der Teams (Karte, Entfernung, Routen), Postleitzahlen ohne Hinweis und die Entfernung, ab der Familien „später und kürzer“ lesen. |

Die API liest die Einstellungen bei jeder Anfrage aus der Datenbank; Schalter wirken also sofort. Menü, Banner und `/nikolaus` sind dagegen beim Build eingebacken (Quelle `nikolaus`, [eingebackene-inhalte.md](eingebackene-inhalte.md)): Ändert sich etwas Öffentliches, startet das Speichern den Neubau, und die Seiten zeigen es nach etwa 5 bis 10 Minuten.

Tage, Zeiten und Teams lassen sich nicht so ändern, dass Anmeldungen ab heute ihren Termin verlieren, ein Termin mehr Anmeldungen als Teams hätte oder Dispo und Einteilung ein Team nutzen, das es nicht mehr gibt. Die Steuerung nennt dann die betroffenen Termine; erst verlegen oder umplanen, dann speichern. Vergangene Saisons blockieren nichts. Eine neue Buchung prüft die Kapazität unter derselben Sperre wie das Speichern der Steuerung.

## Verantwortung und Frist

Am 2. Oktober 2026 wurde festgelegt: **Nico Welles** ist verantwortlich; die Daten werden **einen Kalendermonat nach dem letzten tatsächlich erfolgten Besuch der Saison** gelöscht. So steht es auch in der Datenschutzerklärung (`/datenschutz#nikolaus`).

Die Steuerung zeigt den letzten Besuch und das Datum, bis zu dem gelöscht sein muss. Als letzter Besuch gilt der späteste abgehakte Besuch der Fahrtansicht (Datum in Europe/Berlin) oder, wenn später, der späteste Tag einer bestätigten Anmeldung. Die Monatsfrist ist ein Kalenderdatum: Aus dem 6. Dezember wird der 6. Januar, aus dem 31. Januar der letzte Februartag. Ist die Frist erreicht und sind noch Daten da, zeigt die Startseite des Leitendenbereichs einen roten Hinweis, bis gelöscht ist. Eine automatische Löschung oder Mail gibt es nicht.

## Daten löschen

Unter **Daten löschen** gibt es zwei getrennte Knöpfe. Beide verlangen, dass der angezeigte Text („ANMELDUNGEN LÖSCHEN“ bzw. „HELFENDE LÖSCHEN“) eingetippt wird, und warnen, wenn die Frist noch nicht erreicht ist.

- **Anmeldungen:** alle Buchungen jeden Status mit Adressen, die Dispo und die zwischengespeicherten Orte der Adresssuche. Mailquote, Tempo und eine laufende Reservierung der Adresssuche bleiben.
- **Helfende:** alle Helfenden mit Verfügbarkeiten und Tags und die Einteilung.

Jede Löschung läuft in einer Transaktion: Schlägt etwas fehl, bleibt alles unverändert. Neue Buchungen warten währenddessen auf die Kapazitätssperre; wer eine gelöschte Buchung vorher geladen hat, bekommt beim Speichern einen Versionskonflikt. IDs werden nicht wiederverwendet, damit eine alte Offline-Warteschlange der Fahrtansicht nie eine Buchung der nächsten Saison trifft.

Die Löschung entfernt die Daten aus der Datenbank. In den automatischen Sicherungen von Azure SQL bleiben sie noch bis zu 7 Tage ([azure-sql.md](azure-sql.md#wiederherstellen)), danach sind sie endgültig weg. Bereits versandte E-Mails und lokale Exporte erfasst die Löschung nicht; deren Aufbewahrung muss der Betreiber zusätzlich festlegen.

## Gemeinsamer Zustand

Die Produktion und jede ihrer Azure-Functions-Instanzen verwenden dieselbe Datenbank (`CONFIG.database` in `api/lib/config.ts`) und damit denselben Zustand in der Tabelle `nikolaus.state`: Mailquote sowie Tempo, Lease und Cache des Geocodings. Die Einstellungen der Steuerung stehen in `nikolaus.settings` und `nikolaus.day`. Jedes dieser JSON-Dokumente wird unter einer Zeilensperre geändert, gleichzeitige Änderungen laufen nacheinander. Ist die Datenbank nicht erreichbar, führt Geocoding zu `unavailable`; es entsteht keine unkoordinierte Anfrage an den Anbieter. PR-Previews haben je eine eigene Datenbank mit Testdaten und damit auch eigene Einstellungen, eine eigene Mailquote und ein eigenes Tempo für die Adresssuche ([azure-sql.md](azure-sql.md#previews)).

`NIKOLAUS_STATE_SECRET` muss mindestens 32 Zeichen lang und in allen beteiligten Umgebungen identisch sein. Es bildet HMAC-Schlüssel für Adress-Lookups. Der Zustand enthält keine Klartextadressen im Geocoding-Schlüssel; die zwischengespeicherten Koordinaten sind trotzdem Standortdaten. Eine Änderung des Secrets verwirft die bisherige Zuordnung von Cache-Schlüsseln; sie hebt die gemeinsame Sperre und das gemeinsame Tempo nicht auf. Wie Dispo und Einteilung gespeichert werden, steht in [Planungen speichern](nikolaus-planungen.md).

## Azure-Einrichtung vom 2. Oktober 2026

Nach ausdrücklicher Freigabe wurden die gemeinsamen Appsettings in `default`, `103`, `108`, `155` und `161` gesetzt und zurückgelesen. Alle verwenden die Liste `NikolausZustand` mit ID `0e1d6c9b-0d49-4428-8564-16b8ccc01929`, dasselbe Secret und die Mailgrenzen 100/Stunde sowie 500/Tag. Die erforderlichen Spalten `OperationKey` und `State` wurden über die Website-App geprüft. Ein unmittelbar wieder entfernter Datensatz mit Titel `TEST – bitte löschen` bestätigte Schreiben, ETag-Konflikte und die eindeutige Schlüsselspalte.

In der Ressourcengruppe `website-astro` wurden `website-astro-logs` und das damit verbundene Application Insights `website-astro-insights` in West Europe angelegt. Der Arbeitsbereich verwendet 30 Tage Aufbewahrung und ein tägliches Ingestionslimit von 0,1 GB. Das Limit ist keine harte Kostengarantie und kann weitere Aufzeichnungen bis zum nächsten Tag unterbrechen. [Microsoft beschreibt diese Einschränkungen](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

Die `host.json` deaktiviert automatisches Dependency-Tracking, damit Anbieter-URLs mit Adressen nicht als Dependencies erfasst werden. Sampling ist deaktiviert, damit die gezielt geschriebenen Geocoding-Ereignisse vollständig gezählt werden können. Azure Static Web Apps lehnte entsprechende Laufzeit-Overrides ab, weil deren Namen mehr als 64 Zeichen enthalten. Daher muss diese Host-Konfiguration vor der Insights-Verknüpfung ausgerollt sein. Zunächst wird nur die Vorschau #155 mit Insights verbunden; Produktion und ältere Vorschauen werden erst nach Deployment der passenden Host-Konfiguration verbunden. [Microsoft dokumentiert die Host-Konfiguration](https://learn.microsoft.com/en-us/azure/azure-functions/configure-monitoring).

Historische Anfragen und Instanzzahlen bleiben nicht verfügbar. Eine Abnahme unter tatsächlicher Geocoding-Last steht aus.

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

Alle Nikolaus-Mails reservieren vor dem Versand atomar einen Platz in `mailquota:<Hash des normalisierten Absenders>`. Eingestellt sind 100 Zulassungen pro UTC-Stunde und 500 pro UTC-Tag (`CONFIG.nikolaus.mailHourlyLimit` und `mailDailyLimit` in `api/lib/config.ts`, positive ganze Zahlen; eine Änderung braucht einen PR und ein Deployment). Diese Werte sind Anwendungsgrenzen, keine Behauptung über Azure- oder Exchange-Limits. Alle Instanzen einer Umgebung teilen das Budget. Jede PR-Preview hat eine eigene Datenbank und damit ein eigenes Budget; bei gemeinsamem Absender zählen ihre wenigen Testmails also zusätzlich zur Produktion. Die Sammelbestellung besitzt ihre eigene Quote; bei gleichem Postfach müssen die Betriebsverantwortlichen die Gesamtbudgets aufeinander abstimmen.

Die Erstellung reserviert vor dem Anlegen einer Buchung. Das Neusenden reserviert vor der Suche nach der E-Mail-Adresse, sodass eine erschöpfte Quote bei bekannten und unbekannten Adressen dieselbe Antwort liefert. Erschöpfung ergibt HTTP 429 `MAIL_QUOTA`, ein fehlender oder nicht lesbarer gemeinsamer Speicher HTTP 503 `MAIL_UNAVAILABLE`. In beiden Fällen werden weder neue Buchungen noch Link-Mails erzeugt. Weitere Buchungsänderungen bleiben bei einem Ausfall der anschließenden Informationsmail gespeichert und protokollieren den Versandfehler wie bisher.

Eine Zulassung wird bei Fehlern, Konflikten, ungewissen Graph-Antworten oder einer unbekannten Adresse nicht zurückgebucht. Das vermeidet einen unbeabsichtigten zusätzlichen Versand, kann das Budget aber früher ausschöpfen. Ein reservierter Versandplatz ist nur einmal im reservierenden Prozess verwendbar. HTTP-Antworten und Logs enthalten keine Empfängeradresse; Logs zur Erschöpfung enthalten nur Ereignis und Absenderhash.

## Geocoding messen und kontrollieren

Der bisherige Code begrenzte Anfragen nur pro Prozess. Tatsächliche Azure-Instanzzahlen und historische Anfragen lassen sich daraus nicht ableiten. Der lokale Prozess-Test mit drei getrennten Node-Prozessen bestätigt die Zusammenfassung identischer Lookups und mindestens 1.100 ms Abstand verschiedener Requests. Er ersetzt keine Azure-Messung.

Vor der produktiven Freigabe sollen die Azure-verantwortlichen Personen in Application Insights einen Zeitraum mit Buchungsbetrieb prüfen und die Ergebnisse festhalten:

| Messwert                                                       | Quelle                                                | Ergebnis                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Beobachtete Functions-Instanzen in einem festgelegten Zeitraum | `cloud_RoleInstance` in Requests/Traces               | Nach Verknüpfung und Deployment messen                              |
| Bisherige Nominatim-Anfragen, gesamt und je Instanz            | `dependencies`, falls die HTTP-Aufrufe erfasst wurden | Nicht messbar: keine historische Dependency-Telemetrie verfügbar    |
| Gemeinsamer Zustand aller Instanzen einer Umgebung             | `CONFIG.database` (Previews: eigene Datenbank)        | Seit #165 erfüllt; Previews takten Nominatim getrennt               |
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

## Hängende Adresssuche

Eine Reservierung der Adresssuche (Geocoding) verfällt absichtlich nicht automatisch: Ein pausierter Prozess könnte sonst nach Ablauf weiter Anfragen an den Anbieter schicken. Stürzt ein Prozess mitten in einer Anfrage ab, bleibt die Reservierung stehen und Adressen werden bis zur Freigabe nicht mehr verortet (Buchungen gehen mit „nicht ermittelt“ weiter).

Die Steuerung zeigt unter **Adresssuche**, ob und seit wann eine Suche läuft. Normalerweise dauert sie Sekunden. Läuft sie seit mehr als zehn Minuten, hängt kein Vorgang mehr daran (Azure Functions brechen früher ab): Bestätigen und **Sperre lösen**. Gelöst wird nur genau die angezeigte Reservierung; hat inzwischen eine neue begonnen, lehnt die API ab. Cache und Tempo bleiben erhalten.

## Saison wechseln

1. Nach der Aktion bis zum angezeigten Datum Anmeldungen und Helfende löschen (siehe oben).
2. In der Steuerung die Besuchstage, Zeiten und Teams der kommenden Saison eintragen. Die Nikolausverwaltung einschalten, sobald geplant wird.
3. Kapazitäten, Bestätigung, Änderung, Storno, Dispo und Fahrtansicht mit lokalen Mock-Daten prüfen. In der echten Datenbank Tests ausschließlich als `TEST – bitte löschen` oder mit `scripts/nikolaus-testdata.ts` anlegen und sofort wieder entfernen.
4. Datenbankzugriff, Mailversand und Geocoding prüfen, dann die Online-Anmeldung einschalten.

## Fahrtansicht bei Funklöchern

Die lokale Teamroute, ausstehende Besuchsmarkierungen und deren Löschung sind in
[nikolaus-offline.md](nikolaus-offline.md) beschrieben.
