# CampFlow-Beiträge für Sammelbestellungen

Leitende können einer Bestellung eine CampFlow-Person zuordnen, den endgültigen Betrag prüfen und einen Beitrag anlegen. Bei Familien mit gemeinsamer E-Mail-Adresse wird eine Person für die gesamte Bestellung ausgewählt. Die Website legt keine neuen Mitglieder an.

Zahlungsaufforderungen werden im CampFlow-Dashboard verschickt. Die Website protokolliert die manuelle Versandbestätigung und den manuell gepflegten Bezahlstatus. Es gibt keinen automatischen Zahlungsabgleich, keine Lastschrift-Auslösung und keine automatische Erinnerung.

Diese Umsetzung gehört zu [Issue #89](https://github.com/stamm-phoenix/website-astro/issues/89). Die öffentliche [Beitragsdokumentation](https://docs.campflow.de/docs/beitraege/) beschreibt derzeit das Anlegen mit `POST /fees`, aber weder einen Idempotenzschlüssel noch Beitragsabgleich, Versand oder Zahlungsstatus. Diese Methoden werden nicht erfunden oder über interne Dashboard-Endpunkte nachgebaut.

## Einrichtung

Die drei folgenden Spalten müssen in der bestehenden Bestellungen-Liste angelegt werden. Die Namen sind interne SharePoint-Namen. Vorhandene Bestellungen brauchen keine nachträgliche Zuordnung.

| Interner Name               | Typ und Einstellung                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `CampflowZahlung`           | Mehrzeiliger Klartext, ohne Rich Text und ohne Anfügen von Änderungen. Optional, anfangs leer. |
| `CampflowZahlungsprotokoll` | Mehrzeiliger Klartext, ohne Rich Text und ohne Anfügen von Änderungen. Optional, anfangs leer. |
| `CampflowBeitragId`         | Einzeiliger Text, optional, eindeutige Werte erzwingen. Anfangs leer.                          |

Die API prüft die Spalten vor Zahlungsaktionen. Die Eindeutigkeit von `CampflowBeitragId` verhindert, dass zwei Bestellungen denselben Beitrag übernehmen. Ein vorheriger Suchlauf in der Liste allein würde gleichzeitige Zuordnungen nicht verhindern. Die Einstellungen sind über die dokumentierten Graph-Ressourcen [columnDefinition](https://learn.microsoft.com/en-us/graph/api/resources/columndefinition?view=graph-rest-1.0) und [textColumn](https://learn.microsoft.com/en-us/graph/api/resources/textcolumn?view=graph-rest-1.0) prüfbar.

`CAMPFLOW_API_TOKEN` bleibt ausschließlich in der Functions-Konfiguration. Das Token muss die Mitgliederliste lesen und Beiträge für die zugeordneten Personen anlegen dürfen. Ein fehlendes Token wird vor der Reservierung erkannt.

Die neue Variable `SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED` ist standardmäßig ausgeschaltet. Nur der genaue Wert `true` schaltet neue Beitragserstellungen frei. Die Personenzuordnung und die manuelle Übernahme eines vorhandenen Beitrags benötigen diese Freigabe nicht, wohl aber die richtigen SharePoint-Spalten.

Vor dem Einschalten:

1. Die Spalten und die eindeutige Beitrags-ID prüfen.
2. Mit CampFlow bestätigen, ob das Anlegen selbst Benachrichtigungen oder andere Zahlungsabläufe auslöst. Das Anlegen und die manuelle Versandbestätigung sind auf der Website getrennte Schritte, aber eine automatische CampFlow-Benachrichtigung darf nicht doppelt verschickt werden.
3. Token-Berechtigungen und zulässige Betrags-/Beschreibungslimits bestätigen. Die Website verwendet positive Ganzzahlen in Cent bis höchstens 10.000.000 Cent und Beschreibungen mit höchstens 200 Zeichen. Diese lokalen Grenzen sind keine Zusicherung der CampFlow-Limits.
4. Die Zuständigkeit für unklare Ergebnisse und Korrekturen festlegen. Ohne bestätigten API-Abgleich muss eine Person im Team die Beiträge im Dashboard oder mit CampFlow-Support prüfen können.
5. Die Tests mit simulierten Antworten ausführen. Keine echten Beiträge oder Zahlungsaufforderungen als Test anlegen.

Es gibt in diesem PR keine automatische Änderung der Produktionslisten und keine automatische Aktivierung. Das Ausschalten der Variable verhindert neue Beitragserstellungen. Gespeicherte Beiträge, Referenzen und Prüfverläufe bleiben erhalten.

## Kostenstelle und Kategorie

Neue Beiträge übermitteln unter `attached_expense` den vollständigen Namen der Sammelbestellung als `costunit_name` und „Bestellungen“ als `category_name`. Die Zuordnung erscheint vor der Erstellung im Dialog und wird zusammen mit dem Beitragsvorgang gespeichert. Bereits vorbereitete Vorgänge behalten ihre ursprüngliche Zuordnung. Bestehende Beiträge werden nicht umgebucht.

CampFlow dokumentiert die Zuordnung per Name, aber nicht das automatische Anlegen fehlender Kostenstellen oder Kategorien. Vor der Nutzung die Kostenstelle mit dem exakten Aktionsnamen und darin die Kategorie „Bestellungen“ im Dashboard einrichten. Die Kostenstelle darf nicht archiviert sein. Es gibt keinen dokumentierten API-Aufruf zum Anlegen einer Kostenstelle in den geprüften Unterlagen. Eine Ablehnung wird nicht durch einen zweiten Aufruf ohne Zuordnung umgangen.

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

| Gespeicherter Zustand | Bedeutung und nächster Schritt                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepared`            | Betrag und Person sind gespeichert. Der externe Aufruf wurde noch nicht reserviert. Eine erneute Prüfung kann denselben Vorgang mit einem neuen ETag fortsetzen.  |
| `attempted`           | Der externe Aufruf wurde dauerhaft reserviert. Er kann noch laufen, beendet sein oder vor dem eigentlichen Versand abgebrochen sein. Kein erneuter Schreibaufruf. |
| `uncertain`           | CampFlow-Aufruf oder Speicherung des Ergebnisses waren unklar. Kein erneuter Schreibaufruf.                                                                       |
| `created`             | ID und Referenz sind gespeichert. Kein weiterer Beitrag für diesen Vorgang. Versand und Zahlung bleiben eigene Schritte.                                          |

Bei `attempted` oder `uncertain`:

1. Sicherstellen, dass der alte Functions-Aufruf beendet ist und nicht später noch weiterlaufen kann. Ein abgelaufener Browser-Timer ist kein Nachweis.
2. In CampFlow anhand der Person, des exakten Betrags und der Bestellnummer in der Beschreibung prüfen. Bei Bedarf CampFlow-Support hinzuziehen. Mehrere passende Beiträge müssen zuerst dort geklärt werden.
3. Den passenden vorhandenen Beitrag über „Vorhandenen Beitrag zuordnen“ übernehmen. Dazu seine tatsächliche `fee_…`-ID und die separate Zahlungsreferenz eintragen. Die Website liest den Beitrag mangels dokumentierten Endpunkts nicht zurück. Die Prüfung wird ausdrücklich als manuell dokumentiert.
4. Den Nachweis mit Prüfzeitpunkt und Abgleich festhalten. Keine Bankverbindungen, Mandate oder Zugangsdaten eintragen.

Ein fehlender Suchtreffer beweist nicht, dass kein Beitrag existiert. Der PR bietet deshalb keinen Reset und keinen neuen Erstellungsversuch für einen unklaren Vorgang. Wenn CampFlow bestätigt, dass kein Beitrag angelegt wurde, bleibt eine erneute Erstellung bewusst außerhalb dieses ersten Ablaufs und muss mit dem Team und CampFlow geklärt werden. Metadaten nicht einfach löschen, um die Sperre zu umgehen.

Wenn CampFlow erfolgreich antwortet und nur ein ETag-Konflikt bei der lokalen Speicherung entsteht, versucht die API ausschließlich diese Speicherung erneut. Sie wiederholt nicht die Beitragserstellung. Geht auch diese Speicherung verloren, bleibt die Bestellung im Prüfzustand.

## Korrekturen, Protokoll und Aufbewahrung

Falsche Person, falscher Betrag, Stornierung oder Rückzahlung müssen zuerst in CampFlow geklärt werden. Dieser PR implementiert keine Beitragsänderung oder Rückzahlung und entfernt keine IDs. Für eine nachträgliche Bestelländerung wird ein gesonderter, nachvollziehbarer Korrekturablauf benötigt.

Der Zahlungsverlauf dokumentiert Zuordnung, Vorbereitung, Versuch, Ergebnis, manuelle Übernahme, Versandbestätigung und Zahlungsmarkierung mit Zeitpunkt und handelnder Person. Die private Bestellung zeigt nur einen kleinen Zahlungsüberblick, keine Personenliste oder internen Prüfvermerke.

Die JSON-Spalten enthalten jeweils höchstens 60.000 Zeichen. Das Protokoll ist auf 100 Einträge begrenzt; neue Beitragserstellungen reservieren Platz für Ergebnis, Übernahme, Versand und eine Zahlungsmarkierung. Bei vollem Protokoll werden weitere Änderungen abgewiesen, statt alte Nachweise zu löschen. Ein Administrator muss dann ältere Protokolle gemäß Aufbewahrungsregeln exportieren, gesichert archivieren und die Übertragung dokumentieren. Beitragsschlüssel, Betrag, ID und Referenz in `CampflowZahlung` bleiben bestehen. Mindestens den aktuellen Vorgangsnachweis im aktiven Protokoll behalten.

Beim Löschen alter Bestellungen auch das zugehörige CampFlow-Zahlungsverhältnis und die Aufbewahrung der Buchungsnachweise berücksichtigen. Ein Rollback des Codes macht externe Beiträge nicht rückgängig.

## Prüfung vor einem Merge

In `api/`:

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

Die API-Tests verwenden fiktive Personen, einen ETag-prüfenden SharePoint-Speicher und simulierte CampFlow-Antworten. Sie prüfen Familienzuordnung, konkurrierende Reservierungen, verlorene Antworten, lokale Speicherfehler, manuelle Übernahme, Mutationssperren, getrennten Versand/Bezahlstatus und Datenausgaben. Unerwartete Netzwerkaufrufe brechen den Test ab.

Für Browserprüfungen die Staff-Ansicht mit simulierten API-Antworten auf Desktop und Mobilgerät prüfen. Auswahl ohne und mit Familienzuordnung, Tastaturbedienung, Vorschau, unklarer Zustand, manuelle Übernahme, Versandbestätigung und gesperrte Betragseingabe abdecken. Produktionslisten, echte Beiträge und echte Nachrichten bleiben dabei unberührt.
