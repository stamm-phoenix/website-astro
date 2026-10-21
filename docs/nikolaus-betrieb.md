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
| Kontakt am Besuchstag | Name und Handynummer einer Person für alle Termine. Nur für Notfälle, z. B. wenn eine Familie doch nicht zu Hause ist: Familien sehen sie erst zwei Stunden vor ihrem Termin auf ihrer Terminseite, sonst schreiben sie über das Kontaktformular; sie rufen nicht bei den Teams an. Leer: kein Kontakt. |

Die API liest die Einstellungen bei jeder Anfrage aus der Datenbank; Schalter wirken also sofort. Menü, Banner und `/nikolaus` sind dagegen beim Build eingebacken (Quelle `nikolaus`, [eingebackene-inhalte.md](eingebackene-inhalte.md)): Ändert sich etwas Öffentliches, startet das Speichern den Neubau, und die Seiten zeigen es nach etwa 5 bis 10 Minuten.

Tage, Zeiten und Teams lassen sich nicht so ändern, dass Anmeldungen ab heute ihren Termin verlieren, ein Termin mehr Anmeldungen als Teams hätte oder Dispo und Einteilung ein Team nutzen, das es nicht mehr gibt. Die Steuerung nennt dann die betroffenen Termine; erst verlegen oder umplanen, dann speichern. Vergangene Saisons blockieren nichts. Eine neue Buchung prüft die Kapazität unter derselben Sperre wie das Speichern der Steuerung.

## Verantwortung und Frist

Am 2. Oktober 2026 wurde festgelegt: **Nico Welles** ist verantwortlich; die Daten werden **einen Kalendermonat nach dem letzten tatsächlich erfolgten Besuch der Saison** gelöscht. So steht es auch in der Datenschutzerklärung (`/datenschutz#nikolaus`).

Die Steuerung zeigt den letzten Besuch und das Datum, bis zu dem gelöscht sein muss. Als letzter Besuch gilt der späteste abgehakte Besuch der Fahrtansicht (Datum in Europe/Berlin) oder, wenn später, der späteste Tag einer bestätigten Anmeldung. Die Monatsfrist ist ein Kalenderdatum: Aus dem 6. Dezember wird der 6. Januar, aus dem 31. Januar der letzte Februartag. Ist die Frist erreicht und sind noch Daten da, zeigt die Startseite des Leitendenbereichs einen roten Hinweis, bis gelöscht ist. Eine automatische Löschung oder Mail gibt es nicht.

## Daten löschen

Unter **Daten löschen** gibt es zwei getrennte Knöpfe. Beide verlangen, dass der angezeigte Text („ANMELDUNGEN LÖSCHEN“ bzw. „HELFENDE LÖSCHEN“) eingetippt wird, und warnen, wenn die Frist noch nicht erreicht ist.

- **Anmeldungen:** alle Buchungen jeden Status mit Adressen, die Dispo und die zwischengespeicherten Orte der Adresssuche. Die Mailquote bleibt.
- **Helfende:** alle Helfenden mit Verfügbarkeiten und Merkmalen und die Einteilung.

Jede Löschung läuft in einer Transaktion: Schlägt etwas fehl, bleibt alles unverändert. Neue Buchungen warten währenddessen auf die Kapazitätssperre; wer eine gelöschte Buchung vorher geladen hat, bekommt beim Speichern einen Versionskonflikt. IDs werden nicht wiederverwendet, damit eine alte Offline-Warteschlange der Fahrtansicht nie eine Buchung der nächsten Saison trifft.

Die Löschung entfernt die Daten aus der Datenbank. In den automatischen Sicherungen von Azure SQL bleiben sie noch bis zu 7 Tage ([azure-sql.md](azure-sql.md#wiederherstellen)), danach sind sie endgültig weg. Bereits versandte E-Mails und lokale Exporte erfasst die Löschung nicht; deren Aufbewahrung muss der Betreiber zusätzlich festlegen.

## Gemeinsamer Zustand

Die Produktion und jede ihrer Azure-Functions-Instanzen verwenden dieselbe Datenbank (`CONFIG.database` in `api/lib/config.ts`) und damit denselben Zustand in der Tabelle `nikolaus.state`: Mailquote und Cache des Geocodings. Die Einstellungen der Steuerung stehen in `nikolaus.settings` und `nikolaus.day`. Jedes dieser JSON-Dokumente wird unter einer Zeilensperre geändert, gleichzeitige Änderungen laufen nacheinander. Ist die Datenbank nicht erreichbar, sucht das Geocoding ohne Cache. PR-Previews haben je eine eigene Datenbank mit Testdaten und damit auch eigene Einstellungen, eine eigene Mailquote und einen eigenen Geocoding-Cache ([azure-sql.md](azure-sql.md#previews)).

`NIKOLAUS_STATE_SECRET` muss mindestens 32 Zeichen lang und in allen beteiligten Umgebungen identisch sein. Es bildet HMAC-Schlüssel für Adress-Lookups. Der Zustand enthält keine Klartextadressen im Geocoding-Schlüssel; die zwischengespeicherten Koordinaten sind trotzdem Standortdaten. Eine Änderung des Secrets verwirft die bisherige Zuordnung von Cache-Schlüsseln. Wie Dispo und Einteilung gespeichert werden, steht in [Planungen speichern](nikolaus-planungen.md).

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

## Kartendienst Azure Maps

Seit #187 verortet Azure Maps die Adressen (Karte im Buchungsformular, Speichern einer Buchung, Leitendenbereich) und liefert der Dispo die Fahrzeiten und die Straßenverläufe der Karte. Vorher waren das OpenStreetMap Nominatim und OpenRouteService. Die Kartenkacheln kommen weiter von OpenStreetMap; die Umstellung ist #408.

### Einrichtung

1. Im Azure-Abo mit der Nonprofit-Gutschrift einen Azure-Maps-Account (Gen2) in einer EU-Region anlegen, mit eigener Ressourcengruppe oder Budgetwarnung wie in [belege-ki-pruefung.md](belege-ki-pruefung.md).
2. Anmeldung, eine der beiden Varianten:
   - **Entra ID (Standard):** Der App-Registrierung aus `CONFIG.azure` auf dem Account die Rolle „Azure Maps Data Reader“ geben und die Client-ID des Accounts (Seite „Authentication“, `az maps account show --query properties.uniqueId`) als `CONFIG.azureMaps.clientId` in `api/lib/config.ts` eintragen. Die API meldet sich mit demselben Zertifikat (`AZURE_CLIENT_CERT`) an wie für Graph und Azure SQL.
   - **Schlüssel:** `AZURE_MAPS_API_KEY` als App Setting setzen (Produktion und Previews). Ist er gesetzt, hat er Vorrang vor Entra ID.
3. Ohne beides fragt die API Azure Maps nicht an: Adressen bleiben „nicht ermittelt“, die Dispo schätzt aus der Luftlinie und zeichnet gerade Linien.

Alle Anfragen gehen an den europäischen Endpunkt `eu.atlas.microsoft.com` (`CONFIG.azureMaps.endpoint`). Microsoft verarbeitet und speichert Anfragen dort laut [Geographic scope](https://learn.microsoft.com/en-us/azure/azure-maps/geographic-scope) nur innerhalb Europas. Verwendet werden Geocoding (`/geocode`, API-Version `2026-01-01`), Route Matrix (`/route/matrix`) und Route Directions (`/route/directions`, beide `2025-01-01`).

### Was an Microsoft geht

- **Geocoding:** Straße mit Hausnummer, Postleitzahl und Ort, eingeschränkt auf Deutschland, mit dem Startpunkt der Teams als Bevorzugung. Keine Namen, Telefonnummern, E-Mails oder Angaben über Kinder.
- **Fahrzeiten und Routen:** nur Koordinaten, ohne Bezug zu einer Familie, und bei der Matrix der Beginn des Besuchstags als Abfahrtszeit.

Die Familien-Adressen gehen damit an Microsoft statt an die OpenStreetMap Foundation und HeiGIT; das Verzeichnis der Verarbeitungstätigkeiten muss das nennen. Die Datenschutzerklärung (`/datenschutz#nikolaus`) ist angepasst.

### Geocoding

Gesucht wird zuerst die vollständige Adresse. Ein Treffer zählt nur mit der eingegebenen Postleitzahl. Typ `Address` mit Hausnummer ergibt die Genauigkeit `address`, eine Straße (`RoadBlock`, `RoadIntersection` oder eine Adresse ohne Hausnummer) `street`. Ohne passenden Treffer sucht die API nur Postleitzahl und Ort (`area`), sonst „nicht gefunden“. Ist Azure Maps nicht eingerichtet, nicht erreichbar oder antwortet unlesbar, wird die Adresse „nicht ermittelt“ (`unavailable`); eine Buchung geht trotzdem durch.

Gefundene Orte stehen 24 Stunden in `geocoding:azure-maps` in `nikolaus.state`, höchstens 100, unter einem HMAC-Schlüssel der Adresse (`NIKOLAUS_STATE_SECRET`). So kostet die Adresse aus der Karte beim Buchen keine zweite Anfrage. Fehler werden nicht gespeichert; ein beschädigter Eintrag wird verworfen. Eine Taktung oder Sperre wie bei Nominatim gibt es nicht mehr, daher auch keine „hängende Adresssuche“ in der Steuerung. Das Löschen der Anmeldungen leert den Cache und entfernt den alten Eintrag `geocoding:nominatim`.

### Fahrzeiten und Routen

- Die Dispo fragt die Fahrzeiten mit der **Abfahrtszeit des Besuchstags** an (Beginn des ersten Termins, Europe/Berlin) und mit historischem Verkehr, also der üblichen Verkehrslage eines Abends dieses Wochentags. Liegt der Zeitpunkt schon zurück, wird ohne Abfahrtszeit gerechnet.
- Mit Abfahrtszeit erlaubt die synchrone Matrix höchstens 200 Zellen. Die API teilt größere Tage deshalb in Blöcke, höchstens vier gleichzeitig.
- Fahrzeiten werden **pro Paar** sechs Stunden im Prozess gemerkt. Kommt eine Buchung hinzu, holt die API nur deren Zeile und Spalte; mehrere Buchungen an einer Adresse teilen sich eine.
- Schlägt ein Block oder eine einzelne Zelle fehl oder brauchen alle Blöcke zusammen länger als 25 Sekunden, gilt für diesen Abruf die Luftlinien-Schätzung (Faktor 1,4, 35 km/h), und die Dispo zeigt „geschätzt“; der nächste Abruf holt nur das Fehlende. Paare, zwischen denen Azure Maps ausdrücklich keine Route findet, werden einzeln geschätzt. Jede Fahrt bekommt zwei Minuten zum Parken dazu.
- Die Straßenverläufe der Karte kommen aus Route Directions mit bis zu 150 Punkten pro Team, sonst zeichnet die Karte gerade Linien.

### Kosten (Stand Oktober 2026)

Laut [Preisliste](https://azure.microsoft.com/pricing/details/azure-maps/) und Retail Prices API sind pro Monat 5.000 Search-Transaktionen (Geocoding) und 1.000 Routing-Transaktionen frei, danach je 4,50 USD pro 1.000. Eine Matrix kostet eine Routing-Transaktion pro 4 Zellen, eine Route eine. Fehlerantworten (401, 403, 408, 429, 5xx) werden nicht berechnet.

Grobe Abschätzung für eine Saison mit drei Besuchstagen zu je etwa 30 Buchungen:

| Anfrage | Annahme | Transaktionen |
| --- | --- | ---: |
| Geocoding | 100 Buchungen, je 2 bis 4 Suchen (Karte, Buchen, Änderungen; zweistufig) | etwa 400, im Freikontingent |
| Matrix, erster Abruf eines Tages | 31 × 31 Punkte = 961 Zellen | etwa 240 je Tag und Prozess |
| Matrix, neue Buchung | Zeile und Spalte, etwa 62 Zellen | etwa 16 |
| Matrix, Neustart oder nach 6 Stunden | wie erster Abruf | einige Male je Tag |
| Routen der Karte | je Team und Änderung der Reihenfolge | einige Hundert |

Das ergibt grob 3.000 bis 6.000 Routing-Transaktionen pro Saison, also etwa 10 bis 25 USD über dem Freikontingent, getragen von der Nonprofit-Gutschrift. Für die Ressourcengruppe eine Budgetwarnung einrichten.

### Beobachten

Die API schreibt JSON-Ereignisse mit `scope=nikolaus_geocoding` und `event` `cache_hit`, `request_finish` (mit `durationMs` und `success`), `cache_failed` oder `unavailable`, ohne Adresse, Koordinate oder Schlüssel. Fehler der Matrix und der Routen stehen als Warnung „Azure Maps matrix failed“ bzw. „Azure Maps route failed“ mit dem HTTP-Status im Log. Die `host.json` deaktiviert weiter das automatische Dependency-Tracking, damit URLs mit Adressen nicht in Application Insights landen.

```kusto
traces
| where timestamp > ago(7d)
| extend geo=parse_json(message)
| where tostring(geo.scope) == "nikolaus_geocoding"
| summarize count() by event=tostring(geo.event), success=tostring(geo.success), bin(timestamp, 1d)
```

Die Anfragen pro Monat zeigt außerdem der Azure-Maps-Account unter **Metriken** („Usage“, nach API aufgeteilt).

### Vor der ersten Saison prüfen

- **Qualität:** Eine Stichprobe echter Adressen aus dem Einzugsgebiet (auch Neubaugebiete und Hausnummern mit Zusätzen) mit Azure Maps verorten und mit der Karte vergleichen. OpenStreetMap ist in Deutschland bei kleinen Straßen teils genauer als die TomTom-Daten von Azure Maps. Die Ergebnisse in #187 festhalten.
- **Fahrzeiten:** Die Dispo eines Testtags öffnen und prüfen, dass oben keine „geschätzten“ Fahrzeiten stehen und die Karte Straßenverläufe zeigt.

## Saison wechseln

1. Nach der Aktion bis zum angezeigten Datum Anmeldungen und Helfende löschen (siehe oben).
2. In der Steuerung die Besuchstage, Zeiten und Teams der kommenden Saison eintragen. Die Nikolausverwaltung einschalten, sobald geplant wird.
3. Kapazitäten, Bestätigung, Änderung, Storno, Dispo und Fahrtansicht mit lokalen Mock-Daten prüfen. In der echten Datenbank Tests ausschließlich als `TEST – bitte löschen` oder mit `scripts/nikolaus-testdata.ts` anlegen und sofort wieder entfernen.
4. Datenbankzugriff, Mailversand, Geocoding und Fahrzeiten der Dispo (Azure Maps, siehe oben) prüfen, dann die Online-Anmeldung einschalten.

## Fahrtansicht bei Funklöchern

Die lokale Teamroute, ausstehende Besuchsmarkierungen und deren Löschung sind in
[nikolaus-offline.md](nikolaus-offline.md) beschrieben.
