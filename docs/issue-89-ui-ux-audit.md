# Prüfung des Zahlungsablaufs für Sammelbestellungen

Stand: 1. Oktober 2026, PR #103.

Der geprüfte Ablauf ist nach den Korrekturen verständlicher und hält die geprüften Fehlerfälle aus. Die Beurteilung betrifft die Sammelbestellungen und ihren Zahlungsdialog, keine vollständige Prüfung der Website. Für eine Freigabe mit echten Beiträgen bleiben die CampFlow-Einrichtung und ein Abgleich mit dem Dashboard erforderlich.

## Bewertung der Bedienung

Der Betrag ist die wichtigste Information und steht vor Person und Buchungszuordnung. Die Herkunft des Betrags und der nächste Schritt sind sichtbar. Vorbereitung, tatsächliche Erstellung, manueller Versand und Bezahlstatus werden getrennt benannt. Das verhindert, dass eine Bestätigung auf der Website mit einer verschickten Zahlungsaufforderung verwechselt wird.

Der Dialog verwendet Textzeilen statt zusätzlicher Karten oder Statuspillen. Lange Inhalte scrollen im Inhaltsbereich, während die Hauptaktionen erreichbar bleiben. Auf schmalen Bildschirmen stehen Bezeichnung und Wert untereinander. Die fachlich nötige Bestätigung steht direkt vor der Erstellung; bei einem unklaren Ergebnis ersetzt die manuelle Prüfung den Erstellungsbutton.

## Befunde und Korrekturen

| Befund | Änderung |
| --- | --- |
| Ein Validierungsfehler schloss die Formulare für Beitragszuordnung und Versandnachweis. | Bei Feldfehlern und unverändertem Bestellstand bleibt das Formular samt Nachweis offen. Das erste fehlerhafte Feld erhält den Fokus und `aria-invalid`. Bei Versionskonflikten wird die alte Bestätigung weiterhin verworfen. |
| Eine verlorene Antwort führte zu einer Fehlermeldung, obwohl das Neuladen einen gespeicherten Beitrag fand. | Der bestätigte lokale Zustand ersetzt die Fehlermeldung. Der externe Aufruf wird nicht wiederholt. Schlägt das Neuladen fehl, bleibt nur Schließen und erneutes Laden möglich. |
| Bei unklarem Ergebnis stand gleichzeitig „Noch kein Beitrag angelegt“. | Die Anzeige benennt die ungeklärte Erstellung und fordert den manuellen Abgleich. |
| Eine Bestellung über 0 Euro bot die Beitragserstellung an. | Die Aktion ist gesperrt, mit Erklärung, dass kein CampFlow-Beitrag erforderlich ist. |
| Sehr lange Namen konnten im Dialog horizontal abgeschnitten werden. | Namen und Werte brechen innerhalb ihrer Spalten um. Die Inhaltsfläche benötigt keine horizontale Scrollbewegung. |
| Der Wechsel zur manuellen Zuordnung war während der Erstellung möglich. | Auch diese Nebenaktion ist während des Aufrufs gesperrt. Escape schließt einen laufenden Vorgang nicht. |
| Die manuelle Zuordnung zeigte die gewünschte Kostenstelle wie eine bestätigte Buchungszuordnung an. | Kostenstelle und Kategorie erscheinen nur in der Vorschau einer neuen API-Erstellung. Dort steht auch die erforderliche Einrichtung in CampFlow. |
| Die Ermittlung der automatischen Summe fragte bis zu 40 Artikel nacheinander ab. | Höchstens vier parallele Abfragen; sobald ein Preis fehlt, werden keine weiteren Abfragen gestartet. Bereits laufende Abfragen werden abgeschlossen. Es wird keine Teilsumme abgerechnet. |

## Durchgeführte Prüfungen

- 94 API-Tests bestehen. Der neue Test prüft die vollständige Summe von 40 Artikeln, höchstens vier gleichzeitige Abfragen und den Abbruch weiterer Abfragen bei fehlenden Preisen.
- Zwölf zusätzliche Läufe der API-Fälle für Konkurrenz, Timeouts, unklare Reservierung, Prozessabbruch, Ergebnisspeicherung und veraltete ETags bestehen.
- 24 Browser-Prüfungen bestehen. Der wiederholbare Browser-Test verwendet fiktive API-Antworten. Er prüft fehlenden Betrag, fehlende Preise, 0 Euro, bezahlte und archivierte Bestellungen, deaktivierte Erstellung sowie vorbereitete, erstellte und unklare Beiträge.
- Layouts mit 1440 × 1000, 390 × 844, 320 × 740 und 844 × 390 Pixeln bestehen. Geprüft werden die Breite der scrollbaren Inhaltsfläche und die Erreichbarkeit der Hauptaktion; Screenshots wurden zusätzlich gesichtet.
- Drei schnelle Klicks erzeugen nur einen Erstellungsaufruf. Während eines gezielt angehaltenen Aufrufs bleiben Moduswechsel und Escape gesperrt.
- Eingabefehler erhalten den Nachweis. Feldfehler sind mit ihrem Eingabefeld verknüpft. Tastaturfokus bleibt im Dialog; Escape gibt ihn anschließend an den auslösenden Button zurück.
- Verlorene Erfolgsantwort, Versionskonflikt, unklarer Erstellungsversuch und fehlgeschlagenes Neuladen bieten keine ungesicherte Wiederholung an.

Der Browser-Test ist in `web/test/sammel-payment-ux.js` gespeichert. Mit laufendem lokalen Dev-Server und einem geöffneten Playwright-CLI-Browser lässt er sich aus dem Repository-Verzeichnis ausführen:

```sh
playwright-cli run-code "$(sed 's/^export default //' web/test/sammel-payment-ux.js)"
```

Die Datei ist ein CLI-Callback, keine Playwright-Test-Suite. Sie setzt API-Routen im Testbrowser auf fiktive Antworten und legt keine echten Beiträge an. Fehler lassen den Callback fehlschlagen. Screenshots liegen unter `output/playwright/`.

## Grenzen der Beurteilung

Die Tests bestätigen den lokalen Ablauf und das Verhalten mit simulierten CampFlow- und SharePoint-Antworten. Sie bestätigen weder die Existenz der Kostenstelle in CampFlow noch tatsächlichen Versand oder Zahlungseingang. Diese Schritte bleiben wie vereinbart manuell. Ein erfolgreicher Erstellungsaufruf bestätigt keinen Versand.

Es gab keinen Test mit echten finanziellen Schreibzugriffen und keine echte Last gegen Produktionslisten. Die Browserprüfung lief in Chromium; Safari, Firefox und eine vollständige Prüfung mit Screenreadern stehen aus. Die Schriften der lokalen Testumgebung unterscheiden sich von denen eines üblichen Endgeräts. Die Screenshots dienen deshalb vor allem der Prüfung von Umbruch, Scrollverhalten und Aktionsanordnung.
