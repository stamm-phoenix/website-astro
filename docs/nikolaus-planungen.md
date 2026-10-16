# Nikolaus-Planungen zuverlässig speichern

Dispo und Helfendeneinteilung liegen in der Datenbank (siehe [azure-sql.md](azure-sql.md)):

| Planung | Tabelle | Eine Zeile pro |
| --- | --- | --- |
| Dispo | `nikolaus.dispo_visit` | Buchung und Tag (Team, Reihenfolge, geplante Ankunft, Besuchszeit) |
| Einteilung | `nikolaus.assignment` | Person und Tag (Team oder Küche, Posten) |

Beide verweisen per Fremdschlüssel auf Buchung bzw. Person. Wird eine Buchung oder eine Person
gelöscht, verschwinden ihre Zeilen mit. Verlegt eine Familie ihren Termin, behält die Buchung
ihre ID; die Zeile im alten Plan zeigt dann den Slot von damals, und die Fahrtansicht markiert
den Besuch als verlegt.

## Speichern und Konflikte

Gespeichert wird immer ein ganzer Plan: die Dispo eines Tages bzw. die Einteilung aller Tage.
Die API löscht die alten Zeilen und schreibt die neuen in **einer Transaktion**; ein Fehler
hinterlässt den bisherigen vollständigen Stand. Eine Sperre pro Plan (`sp_getapplock`) lässt
gleichzeitige Speicherungen nacheinander laufen.

Gegen das Überschreiben fremder Änderungen schickt der Browser die Version mit, die er geladen
hat. Sie ist ein Fingerabdruck der Planungsfelder. Hat inzwischen jemand anderes gespeichert,
antwortet die API mit HTTP 409; dann den aktuellen Stand neu laden und die Änderungen dort
erneut vornehmen. Abgehakte Besuche verändern die Version der Dispo nicht und bleiben beim
Neuplanen erhalten. Kommt derselbe Plan nach einer verlorenen Antwort noch einmal, erkennt die
API ihn und schreibt nichts.

Besuche in der Fahrtansicht tragen eine Vorgangs-ID und die Version der Zeile. Eine Wiederholung
desselben Vorgangs (z. B. aus der Offline-Warteschlange) gibt den gespeicherten Stand zurück;
ein Vorgang auf Grundlage einer älteren Version wird abgelehnt.

Der Zeitpunkt eines abgehakten Besuchs zählt für die Löschfrist der Steuerung
([nikolaus-betrieb.md](nikolaus-betrieb.md#verantwortung-und-frist)).

## Nachweis

`cd api && TEST_SQL_PASSWORD=… bun run test` mit einem lokalen SQL Server (siehe
[azure-sql.md](azure-sql.md#tests)). `test/nikolaus-planning-save.test.ts` prüft konkurrierende
Erst-Speicherungen, veraltete Versionen, gelöschte Buchungen und Personen, identische
Wiederholungen und erhaltene Besuchsmarkierungen. Die Tests
legen eigene Datenbanken an und berühren keine echten Daten.

## Einteilung und Teamzahl

Ein Team ist einsatzfähig, wenn es Nikolaus und Fahrer*in hat; Krampus und Engerl sind willkommen,
aber nicht nötig. Die Einteilung (`api/lib/nikolaus-einteilung.ts`) besetzt deshalb zuerst so viele
einsatzfähige Teams wie möglich (Team A vor B), danach Krampus und Engerl, bevorzugt in
einsatzfähigen Teams, dann die Verteilung der Arbeit und zuletzt positive Merkmale. Pro Tag zeigt
sie, für wie viele einsatzfähige Teams die Gemeldeten höchstens reichen (`teamCapacity`).

Die Teamzahl eines Tages lässt sich in der Einteilung ausprobieren. Das ändert nur die Planung im
Browser; Familien buchen weiter mit der Zahl der Steuerung, bis sie mit „… Teams in die Steuerung
übernehmen“ (mit Rückfrage) gespeichert wird. Mehr Teams als in der Steuerung lassen sich erst nach
dem Übernehmen speichern. Weniger Teams lehnt die Steuerung ab, solange Anmeldungen, Dispo oder die
gespeicherte Einteilung das wegfallende Team noch brauchen; sie nennt dann die Termine.

Die Dispo rechnet pro Besuch 5 Minuten je Kind, mindestens 10 und höchstens 45 Minuten. Ab sechs
Kindern weist das Formular Familien darauf hin, dass der Besuch nicht länger wird.

