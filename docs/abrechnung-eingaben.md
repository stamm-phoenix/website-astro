# Persönliche Ergänzungen zur Abrechnung

Die Daten aus CampFlow bleiben die Grundlage. Eigene Ergänzungen (Teilnehmende,
Rollen, Postleitzahlen, Zusatztag, Beträge, Leihgebühren und Deckblatt) werden mit
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

## Betrieb

- Migration `0036_abrechnung_eingabe.sql`, Tabelle `organisation.abrechnung_eingabe`.
- `GET/PUT /api/intern/abrechnung/{id}/eingaben`, Staff-Anmeldung zwingend; keine
  Nutzerkennung aus dem Request-Body. Antworten sind `no-store`.
- Pro Account und Aktion eine Zeile; bedingte Writes vergleichen `rowversion`.
  Eine Transaktionssperre verhindert zwei gleichzeitige erste Schreibvorgänge.
- Die Aufbewahrungsfrist bleibt unverändert: drei Kalendermonate ab Aktionsende,
  danach ein weiterer Monat. Abgelaufene Zeilen werden beim nächsten Zugriff
  entfernt; neue Speicherungen abgelaufener Aktionen werden abgelehnt.
- Der Server ermittelt das Aktionsende aus CampFlow. Der Browser kann die Frist
  nicht verlängern. Die Azure-Sicherungen laufen nach sieben Tagen aus.
- Preview-Seeding enthält ausschließlich erfundene Angaben.

Gezielte Prüfungen: `api/test/abrechnung-eingabe.test.ts`,
`web/tests/abrechnung-speicher.spec.ts` und der Gerätekonflikt in
`web/tests/issue-382.spec.ts`. Die SQL-Prüfung braucht `TEST_SQL_PASSWORD` und wird
lokal ohne Testdatenbank übersprungen; in CI ist die Testdatenbank vorgeschrieben.
