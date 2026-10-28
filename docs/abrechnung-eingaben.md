# Persönliche Ergänzungen zur Abrechnung

Die Daten aus CampFlow bleiben die Grundlage. Eigene Ergänzungen (Teilnehmende,
Rollen, Postleitzahlen, Zusatztag, Beträge, Leihgebühren, Deckblatt und Kurzbeschreibung) werden mit
**Eingaben speichern** für den angemeldeten Account in Azure SQL gespeichert.
Andere Leitende sehen diese persönlichen Ergänzungen nicht. Auf einem anderen
Gerät mit demselben Account stehen sie nach dem Öffnen der Aktion bereit.

Die Seite zeigt, ob Änderungen offen, gerade unterwegs oder bestätigt gespeichert
sind. Verlassen mit ungespeicherten Änderungen fragt nach, auch wenn man die letzte
Angabe wieder entfernt. Ein fehlgeschlagener Save behält die Eingaben. Änderungen
während einer laufenden Speicherung bleiben als neue, noch ungespeicherte Fassung
markiert. Bei einem Konflikt wird keine neuere Gerätefassung überschrieben; der
Hinweis erklärt, wie man die eigenen Angaben kopiert und die gespeicherte Fassung lädt.

Alte lokale Ergänzungen werden nur angeboten, wenn noch keine Serverfassung
existiert. Ihre lokale Kopie wird erst nach einer erfolgreichen ausdrücklichen
Speicherung entfernt. Ein Zurücksetzen behält eine leere versionierte Serverzeile,
damit ein älteres Gerät die gelöschten Angaben nicht versehentlich zurückschreibt.

## Kurzbeschreibung

Der KJR verlangt beim Antrag auf Zuschuss eine Kurzbeschreibung: einen Satz zur
Zielsetzung und einen groben Zeitplan. Sie liegt in `AbrechnungSession.kurzbeschreibung`
(`einleitung` und `tage` mit Blöcken `von`/`bis` als `HH:MM` oder leer, `text`) und wird
wie die übrigen Ergänzungen gespeichert. Solange `tage` leer ist, zeigt die Seite die Tage
der Aktion aus CampFlow; die erste Änderung übernimmt sie. Ältere Seiten ohne das Feld
dürfen weiter speichern (`validAbrechnungSession` ergänzt es leer).

Das PDF (`downloadKurzbeschreibungPdf` in `web/src/lib/abrechnungPdf.ts`) nutzt dasselbe
Briefpapier wie Eigenbeleg und Leihgebühren (`drawBriefkopf`, `drawBriefseiten`). Der
Zeitplan steht in zwei (zwei Tage) oder drei Spalten: bis drei Tage je in einer Spalte,
sonst so ausgeglichen, dass er auf die erste Seite passt, sonst über weitere Seiten mit
„(Fortsetzung)“.

„In eigenen Worten beschreiben“ schickt einen frei geschriebenen Ablauf (höchstens
10.000 Zeichen, `freitext`) an denselben Endpunkt. Ein eigener Prompt bringt ihn einmal
in Tage und Blöcke und formuliert aus der Beschreibung eine Zielsetzung; Rückfragen
gibt es nicht. Der noch nicht abgeschickte Text liegt wie offene Zeilen im Store
(`zeitplanFreitext`) und ist gegen Verlassen geschützt.

„Aus Datei übernehmen“ schickt Fotos und die ersten vier Seiten eines PDFs als JPEG, Excel
(`.xlsx`) und CSV als Datei an `POST /api/intern/abrechnung/{id}/zeitplan`. Die API liest
Excel selbst als Text (`api/lib/xlsx-text.ts`) und fragt die Bereitstellung der
Belegprüfung (`gpt-6.1-sol-datazone`, Datenzonenstandard, mit wenig Denkaufwand wegen der
45-Sekunden-Grenze der Static Web App; `api/lib/kurzbeschreibung-zeitplan.ts`). Es wird
nichts gespeichert; die Seite übernimmt das Ergebnis erst nach Rückfrage, wenn schon ein
Zeitplan da ist. Tageslimit: `CONFIG.abrechnung.zeitplanMaxReadsPerDay` (je
Functions-Instanz, `0` schaltet es ab).

## Betrieb

- Migration `0036_abrechnung_eingabe.sql`, Tabelle `organisation.abrechnung_eingabe`.
- `GET/PUT /api/intern/abrechnung/{id}/eingaben`, Staff-Anmeldung zwingend; keine
  Nutzerkennung aus dem Request-Body. Antworten sind `no-store`.
- Pro Account und Aktion eine Zeile; bedingte Writes vergleichen `rowversion`.
  Eine Transaktionssperre verhindert zwei gleichzeitige erste Schreibvorgänge.
- Die Aufbewahrungsfrist bleibt unverändert: drei Kalendermonate ab Aktionsende,
  danach ein weiterer Monat. Vor dem Lesen und Löschen einer Aktion wird ihr
  aktuelles Ende aus CampFlow geprüft und die gespeicherte Frist angepasst. Erst
  dann werden abgelaufene Zeilen dieser Aktion entfernt; neue Speicherungen abgelaufener Aktionen werden abgelehnt.
- Der Server ermittelt das Aktionsende aus CampFlow. Der Browser kann die Frist
  nicht verlängern. Die Azure-Sicherungen laufen nach sieben Tagen aus.
- Preview-Seeding enthält ausschließlich erfundene Angaben.

Gezielte Prüfungen: `api/test/abrechnung-eingabe.test.ts`,
`api/test/kurzbeschreibung-zeitplan.test.ts`, `web/test/kurzbeschreibung.test.ts`,
`web/tests/abrechnung-kurzbeschreibung.spec.ts`,
`web/tests/abrechnung-speicher.spec.ts` und der Gerätekonflikt in
`web/tests/issue-382.spec.ts`. Die SQL-Prüfung braucht `TEST_SQL_PASSWORD` und wird
lokal ohne Testdatenbank übersprungen; in CI ist die Testdatenbank vorgeschrieben.
