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

## Umplanen am Besuchsabend

Abgehakte Besuche gelten in der Dispo als erledigt (`done` im `DispoProblem`,
`api/lib/nikolaus-dispo.ts`). Sie stehen am Anfang der Route ihres Teams, in der Reihenfolge,
in der sie abgehakt wurden, und werden weder von Hand noch durch „Neu berechnen“ verschoben.
Bei ihnen gibt es keine Teamauswahl mehr. Die übrigen Termine eines Teams plant die Dispo ab
dem zuletzt abgehakten Besuch, und zwar ab dem Zeitpunkt des Abhakens. Ein Termin, der einem
anderen Team gegeben wird, kommt also immer hinter dessen erledigte Besuche. Die aktuelle Uhrzeit
zählt dabei nicht: Hakt ein Team länger nicht ab, rechnet die Dispo weiter mit dem letzten
Abhaken.

Ein abgehakter Besuch endet in der Planung beim Abhaken. Beim Speichern bekommt er als geplante
Ankunft deshalb die Zeit des Abhakens minus Besuchsdauer. So zählt der Fortschritt der Familien
(Verspätung beim letzten Abhaken plus geplante Ankunft) die Verspätung nicht doppelt, wenn die
übrigen Termine neu geplant gespeichert werden.

Die Dispo lädt Abhaken nicht von selbst nach. Beim Speichern schickt sie deshalb mit, welche
Besuche beim Laden wann abgehakt waren. Hat ein Team seitdem abgehakt, ein Häkchen
zurückgenommen oder einen Besuch neu abgehakt, lehnt die API den Plan mit HTTP 400 ab und speichert nichts, denn er wäre auf
einem veralteten Stand gerechnet. Abhaken ändert die Version der Dispo nicht, die
Versionsprüfung allein fängt das also nicht ab.

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
sie, für wie viele einsatzfähige und komplette Teams die Gemeldeten höchstens reichen
(`teamCapacity`); diese Zahl rechnet ohne Merkmale, die Familien eines Teams können weniger erlauben.
Ob Teams besetzt werden können, hängt nur an ihrem Tag (jede Person übernimmt einen Posten pro Tag),
und ein Tag hat höchstens vier Teams. Deshalb prüft ein exakter Fluss jede Kombination, die größte
zuerst; die kompletten Teams werden innerhalb der größten einsatzfähigen Kombination gesucht.

Die Teamzahl eines Tages lässt sich in der Einteilung ausprobieren. Das ändert nur die Planung im
Browser; Familien buchen weiter mit der Zahl der Steuerung, bis sie mit „… Teams in die Steuerung
übernehmen“ (mit Rückfrage) gespeichert wird. Mehr Teams als in der Steuerung lassen sich erst nach
dem Übernehmen speichern. Weniger Teams lehnt die Steuerung ab, solange Anmeldungen, Dispo oder die
gespeicherte Einteilung das wegfallende Team noch brauchen; sie nennt dann die Termine.

Die Dispo rechnet pro Besuch 5 Minuten je Kind, mindestens 10 und höchstens 45 Minuten. Ab sechs
Kindern weist das Formular Familien darauf hin, dass der Besuch nicht länger wird.

