# CampFlow-Beiträge für Sammelbestellungen

Leitende können einer Bestellung eine CampFlow-Person zuordnen, den endgültigen Betrag prüfen und einen Beitrag anlegen. Bei Familien mit gemeinsamer E-Mail-Adresse wird eine Person für die gesamte Bestellung ausgewählt. Die Website legt keine neuen Mitglieder an.

Zahlungsaufforderungen werden im CampFlow-Dashboard verschickt. Die Website protokolliert die manuelle Versandbestätigung und den manuell gepflegten Bezahlstatus. Es gibt keinen automatischen Zahlungsabgleich, keine Lastschrift-Auslösung und keine automatische Erinnerung.

Diese Umsetzung gehört zu [Issue #89](https://github.com/stamm-phoenix/website-astro/issues/89). Die öffentliche [Beitragsdokumentation](https://docs.campflow.de/docs/beitraege/) beschreibt derzeit das Anlegen mit `POST /fees`, aber weder einen Idempotenzschlüssel noch Beitragsabgleich, Versand oder Zahlungsstatus. Diese Methoden werden nicht erfunden oder über interne Dashboard-Endpunkte nachgebaut.

## Einrichtung

Die Zahlungsdaten liegen in Azure SQL (Schema `sammel`, siehe [Speicherung](#speicherung)). Es gibt nichts weiter einzurichten; vorhandene Bestellungen brauchen keine nachträgliche Zuordnung.

`CAMPFLOW_API_TOKEN` bleibt ausschließlich in der Functions-Konfiguration. Das Token muss die Mitgliederliste lesen und Beiträge für die zugeordneten Personen anlegen dürfen. Ein fehlendes Token wird vor der Reservierung erkannt.

Die neue Variable `SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED` ist standardmäßig ausgeschaltet. Nur der genaue Wert `true` schaltet neue Beitragserstellungen frei. Die Personenzuordnung und die manuelle Übernahme eines vorhandenen Beitrags benötigen diese Freigabe nicht.

Vor dem Einschalten:

1. Mit CampFlow bestätigen, ob das Anlegen selbst Benachrichtigungen oder andere Zahlungsabläufe auslöst. Das Anlegen und die manuelle Versandbestätigung sind auf der Website getrennte Schritte, aber eine automatische CampFlow-Benachrichtigung darf nicht doppelt verschickt werden.
2. Token-Berechtigungen und zulässige Betrags-/Beschreibungslimits bestätigen. Die Website verwendet positive Ganzzahlen in Cent bis höchstens 10.000.000 Cent und Beschreibungen mit höchstens 200 Zeichen. Diese lokalen Grenzen sind keine Zusicherung der CampFlow-Limits.
3. Die Zuständigkeit für unklare Ergebnisse und Korrekturen festlegen. Ohne bestätigten API-Abgleich muss eine Person im Team die Beiträge im Dashboard oder mit CampFlow-Support prüfen können.
4. Die Tests mit simulierten Antworten ausführen. Keine echten Beiträge oder Zahlungsaufforderungen als Test anlegen.

Es gibt keine automatische Aktivierung. Das Ausschalten der Variable verhindert neue Beitragserstellungen. Gespeicherte Beiträge, Referenzen und Prüfverläufe bleiben erhalten.

## Kostenstelle und Kategorie

Die Playwright API erlaubt für neue Kostenstellennamen höchstens 100 Zeichen. Die Beitragsvorschau prüft deshalb den Aktionsnamen vor einer neuen Reservierung; bereits vorbereitete Vorgänge behalten ihre gespeicherte Zuordnung.

Neue Beiträge übermitteln unter `attached_expense` den vollständigen Namen der Sammelbestellung als `costunit_name` und „Bestellungen“ als `category_name`. Die Zuordnung erscheint vor der Erstellung im Dialog und wird zusammen mit dem Beitragsvorgang gespeichert. Bereits vorbereitete Vorgänge behalten ihre ursprüngliche Zuordnung. Bestehende Beiträge werden nicht umgebucht.

Die Website prüft die Zuordnung über die Playwright API (`GET /campflow/kostenstellen`). Fehlt die Kostenstelle, legt `PUT /campflow/kostenstellen` sie mit der Kategorie „Bestellungen“ an. Fehlt nur die Kategorie, ergänzt `PUT /campflow/kostenstellen/{id}/kategorien` sie. Die neue Kategorie verwendet `business` (wirtschaftlicher Geschäftsbetrieb), festgelegt in `CONFIG.sammelbestellung.categorySphere`. Vorhandene Kategorien und ihre Sphären werden nicht geändert; archivierte Kostenstellen blockieren die Beitragserstellung.

Dafür muss `PLAYWRIGHT_API_KEY` in der Website-API eingerichtet sein. Die URL kommt aus `CONFIG.playwrightApi.url`. Der Playwright-Dienst benötigt seinen CampFlow-Login und den Stand mit beiden PUT-Endpunkten. Er erhält bei seinen Änderungen die übrigen Kostenstellen und Kategorien; gleichzeitiges Speichern im CampFlow-Dashboard kann dennoch mit einer Änderung kollidieren.

Das gesamte API-Zeitbudget beginnt beim Eintritt in den Handler und endet nach 40 Sekunden (SWA-Grenze: 45 Sekunden). Die Zuordnungsprüfung verwendet nur die verbleibende Zeit abzüglich 25 Sekunden für Gebühren-Aufruf und Speicherzugriffe. Fehlt dieses Restbudget, bleibt der Vorgang `prepared`; der Gebühren-Aufruf hat höchstens 15 Sekunden und behält weitere fünf Sekunden zum Speichern des Ergebnisses zurück.

Die Prüfung erfolgt mit dem gespeicherten Zuordnungssnapshot im Zustand `prepared`, bevor `attempted` gespeichert oder ein Beitrag gesendet wird. Bei Ausfall, Timeout oder einer nicht bestätigten Zuordnung wird kein Beitrag angelegt; ein ausdrücklicher neuer Versuch liest die Zuordnung erneut. HTTP 409 nach einer gleichzeitigen Anlage wird durch Nachlesen geprüft. Es gibt keine automatische Wiederholung eines PUT oder eines Gebühren-POST. Eine bereits angelegte Kostenstelle kann nach einem abgebrochenen Ablauf bestehen bleiben. Eine Ablehnung wird nie durch einen Gebühren-Aufruf ohne Zuordnung umgangen.

## Normaler Ablauf

1. Unter „Status bearbeiten“ den endgültigen Gesamtbetrag einschließlich Versand festlegen. Die vollständige Summe der aktiven Artikel wird vorbelegt, wenn noch kein eigener Gesamtbetrag gespeichert ist. Ein eigener Betrag hat Vorrang. Bei fehlenden Shop-Preisen muss der vollständige Betrag manuell eingetragen werden. Versandkosten bei Bedarf ergänzen. Ein leeres Feld lässt den Betrag offen; die API ergänzt ihn nicht selbst. Die Bestellung muss auf „Bestellt“ oder „Eingetroffen“ stehen und darf für eine neue Beitragserstellung noch nicht bezahlt sein. Archivierte Aktionen können keine neuen Beiträge erhalten.
2. „Bezahlung verwalten“ öffnen. Bei fehlendem Betrag oder Status führt „Bestellung vorbereiten“ direkt zur Statusbearbeitung. Die CampFlow-Person ausdrücklich bestätigen. Primäre und CC-Adressen werden berücksichtigt. Bei mehreren Familienmitgliedern muss eine Person ausgewählt werden. Für eine abweichende E-Mail-Adresse ist eine Begründung erforderlich.
3. „Beitrag vorbereiten“ öffnen. Betrag, Person und Bestellbeschreibung kontrollieren. Falls bereits ein Beitrag existiert, „Vorhandenen Beitrag zuordnen“ verwenden. Für einen neuen Beitrag bestätigen, dass noch kein Beitrag für diese Bestellung existiert.
4. „Beitrag anlegen“ erzeugt genau einen Beitrag pro API-Aufruf. ID und Zahlungsreferenz werden an der Bestellung gespeichert. Wiederholte Klicks und konkurrierende Anfragen starten nach der Reservierung keinen weiteren Aufruf für diese Bestellung.
5. Im CampFlow-Dashboard prüfen, ob die Zahlungsaufforderung bereits verschickt wurde. Falls nötig dort verschicken und tatsächliche Empfänger einschließlich CC-Adressen kontrollieren. Auf der Website „Versand bestätigen“ mit einem kurzen Nachweis verwenden. Diese Bestätigung verschickt keine Nachricht.
6. Zahlungseingang prüfen und unter „Status bearbeiten“ manuell als bezahlt markieren. Die Website speichert Quelle, Zeitpunkt und handelnde Person. Die Auslieferung wird weiterhin separat gepflegt.

Bestellungen ohne Beitrag behalten ihren manuellen Ablauf. Für kostenlose Bestellungen bleibt der Betrag null oder null Euro möglich; ein CampFlow-Beitrag erfordert einen positiven Betrag. Bereits manuell bezahlte Bestellungen können einen vorhandenen Beitrag übernehmen, aber keinen neuen Beitrag erzeugen.

Ab der Vorbereitung sind Betrag, zugeordnete Person und Artikel gesperrt. Wiederöffnung, Ausschluss oder Wiederaufnahme von Artikeln und Stornierung sind dann nicht über die bisherigen Bestellaktionen möglich. Änderungen an Auslieferung oder Fortschritt zwischen „Bestellt“ und „Eingetroffen“ bleiben möglich. Diese Regeln gelten auch auf dem Server und schützen vor alten Browserständen.

## Unklare Ergebnisse

Eine Zeitüberschreitung beweist nicht, dass kein Beitrag angelegt wurde. Auch eine Serverfehlermeldung oder eine unvollständige Erfolgsantwort wird vorsichtig als unklar behandelt. Der CampFlow-Schreibaufruf hat keinen automatischen Retry, auch nicht bei HTTP 429.

| Gespeicherter Zustand | Bedeutung und nächster Schritt                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepared`            | Betrag und Person sind gespeichert. Der externe Aufruf wurde noch nicht reserviert. Eine erneute Prüfung kann denselben Vorgang mit der neuen Version der Bestellung fortsetzen. |
| `attempted`           | Der externe Aufruf wurde dauerhaft reserviert. Er kann noch laufen, beendet sein oder vor dem eigentlichen Versand abgebrochen sein. Kein erneuter Schreibaufruf.                |
| `uncertain`           | CampFlow-Aufruf oder Speicherung des Ergebnisses waren unklar. Kein erneuter Schreibaufruf.                                                                                      |
| `created`             | ID und Referenz sind gespeichert. Kein weiterer Beitrag für diesen Vorgang. Versand und Zahlung bleiben eigene Schritte.                                                         |

Bei `attempted` oder `uncertain`:

1. Sicherstellen, dass der alte Functions-Aufruf beendet ist und nicht später noch weiterlaufen kann. Ein abgelaufener Browser-Timer ist kein Nachweis.
2. In CampFlow anhand der Person, des exakten Betrags und der Bestellnummer in der Beschreibung prüfen. Bei Bedarf CampFlow-Support hinzuziehen. Mehrere passende Beiträge müssen zuerst dort geklärt werden.
3. Den passenden vorhandenen Beitrag über „Vorhandenen Beitrag zuordnen“ übernehmen. Dazu seine tatsächliche `fee_…`-ID und die separate Zahlungsreferenz eintragen. Die Website liest den Beitrag mangels dokumentierten Endpunkts nicht zurück. Die Prüfung wird ausdrücklich als manuell dokumentiert.
4. Den Nachweis mit Prüfzeitpunkt und Abgleich festhalten. Keine Bankverbindungen, Mandate oder Zugangsdaten eintragen.

Ein fehlender Suchtreffer beweist nicht, dass kein Beitrag existiert. Der PR bietet deshalb keinen Reset und keinen neuen Erstellungsversuch für einen unklaren Vorgang. Wenn CampFlow bestätigt, dass kein Beitrag angelegt wurde, bleibt eine erneute Erstellung bewusst außerhalb dieses ersten Ablaufs und muss mit dem Team und CampFlow geklärt werden. Metadaten nicht einfach löschen, um die Sperre zu umgehen.

Wenn CampFlow erfolgreich antwortet und nur ein Versionskonflikt bei der lokalen Speicherung entsteht, versucht die API ausschließlich diese Speicherung erneut. Sie wiederholt nicht die Beitragserstellung. Geht auch diese Speicherung verloren, bleibt die Bestellung im Prüfzustand.

## Korrekturen, Protokoll und Aufbewahrung

Falsche Person, falscher Betrag, Stornierung oder Rückzahlung müssen zuerst in CampFlow geklärt werden. Dieser PR implementiert keine Beitragsänderung oder Rückzahlung und entfernt keine IDs. Für eine nachträgliche Bestelländerung wird ein gesonderter, nachvollziehbarer Korrekturablauf benötigt.

Der Zahlungsverlauf dokumentiert Zuordnung, Vorbereitung, Versuch, Ergebnis, manuelle Übernahme, Versandbestätigung und Zahlungsmarkierung mit Zeitpunkt und handelnder Person. Die private Bestellung zeigt nur einen kleinen Zahlungsüberblick, keine Personenliste oder internen Prüfvermerke.

Das Protokoll hat keine Obergrenze; Einträge werden nie geändert oder gelöscht.

Beim Löschen alter Bestellungen auch das zugehörige CampFlow-Zahlungsverhältnis und die Aufbewahrung der Buchungsnachweise berücksichtigen. Ein Rollback des Codes macht externe Beiträge nicht rückgängig.

## Speicherung

Aktionen, Bestellungen und Zahlungen liegen in Azure SQL im Schema `sammel` (`api/migrations/0021_sammelbestellung.sql`, Zugriff in `api/lib/sammelbestellung-list.ts`), ohne JSON-Spalten:

| Tabelle                           | Inhalt                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `campaign`                        | Aktion mit Zeitraum, Archivstatus und eindeutigem Schlüssel des Formulars                           |
| `catalog_item`, `catalog_variant` | Häufige Artikel einer Aktion und ihre Größen/Varianten                                              |
| `invitation`                      | Einladungsversand, eine Zeile je Adresse (`pending`, `attempted`, `sent`)                           |
| `link_quota`                      | Angeforderte Bestelllinks je Aktion und UTC-Stunde/-Tag                                             |
| `member_order`                    | Bestellung, eindeutig je Aktion und E-Mail-Adresse                                                  |
| `order_item`                      | Eine Zeile je Artikel mit Shop, Referenz, Variante, Menge und Ausschlussgrund                       |
| `payment`, `payment_email`        | Zugeordnete Person mit ihren Adressen, Beitragsvorgang mit Snapshot, Versand und Zahlungsmarkierung |
| `payment_event`                   | Zahlungsprotokoll, eine Zeile je Schritt                                                            |

**Version und Gleichzeitigkeit:** Die `rowversion` der Bestellung (`member_order.version`, als `etag` an den Browser) schützt die ganze Bestellung. Jede Änderung an Artikeln, Zahlung oder Protokoll schreibt die Bestellzeile in derselben Transaktion mit und prüft dabei die geladene Version. Zahlungsdaten und Protokolleintrag entstehen so immer gemeinsam, und von zwei gleichzeitigen Reservierungen gewinnt genau eine; die andere bekommt 409. Der Aufruf bei CampFlow liegt außerhalb jeder Transaktion.

**Was die Datenbank erzwingt:** Eine Beitrags-ID gehört zu höchstens einer Bestellung (eindeutiger Index), ebenso ein Vorgangsschlüssel. CHECK-Regeln verlangen einen vollständigen Snapshot, sobald ein Vorgang begonnen hat, Beitrags-ID und Referenz genau im Zustand `created` und Versand oder Zahlungsmarkierung nur bei angelegtem Beitrag. Beim Lesen prüft die Website die Daten zusätzlich wie früher (`sammelbestellung-payment-storage.ts`, `sammelbestellung-validation.ts`); ungültige Zeilen führen zu einer Fehlermeldung statt zu einer scheinbar leeren Bestellung.

Die Mitgliedsansicht bekommt nur den kleinen Zahlungsüberblick (`publicSammelOrder`), nie Person, Prüfvermerke oder Protokoll.

## Ablösung der SharePoint-Listen

Bis #156 lagen die Daten in den SharePoint-Listen „sammelbestellungen“ und „sammelbestellungenOrders“ mit JSON in mehrzeiligem Text. Es gab noch keine produktive Sammelbestellung, deshalb werden keine Daten übernommen: Nach dem Deploy die beiden Listen in SharePoint löschen.

## Prüfung vor einem Merge

In `api/` (mit `TEST_SQL_PASSWORD`, siehe [azure-sql.md](azure-sql.md#tests)):

```sh
bun run test
bun run build
bun run lint
```

In `web/`:

```sh
bun run build
bunx astro check
bun run lint
```

Die API-Tests laufen gegen einen echten SQL Server ([Tests](azure-sql.md#tests)) und verwenden fiktive Personen und simulierte CampFlow-Antworten. Sie prüfen Familienzuordnung, konkurrierende Reservierungen, verlorene Antworten, lokale Speicherfehler, manuelle Übernahme, Mutationssperren, getrennten Versand/Bezahlstatus und Datenausgaben. Unerwartete Netzwerkaufrufe brechen den Test ab.

Für Browserprüfungen die Staff-Ansicht mit simulierten API-Antworten auf Desktop und Mobilgerät prüfen. Auswahl ohne und mit Familienzuordnung, Tastaturbedienung, Vorschau, unklarer Zustand, manuelle Übernahme, Versandbestätigung und gesperrte Betragseingabe abdecken. Produktionsdaten, echte Beiträge und echte Nachrichten bleiben dabei unberührt.
