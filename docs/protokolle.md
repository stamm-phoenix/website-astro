# Protokolle

Das Modul **Protokolle** im Leitendenbereich (`/leitendenbereich/protokolle`) ersetzt den Weg über SharePoint. Niemand muss Dateien selbst anlegen, benennen oder verschieben.

1. **Anlegen:** „Neues Protokoll“ kopiert die Word-Vorlage in den Protokoll-Ordner. Die Datei heißt `JJJJ-MM-TT Titel.docx`.
2. **Schreiben:** „In Word bearbeiten“ öffnet die Datei in Word im Browser. Mit „Link kopieren“ lässt sich der Link teilen (z. B. in WhatsApp), damit alle während der Sitzung mitschreiben. **Vorschau** zeigt das Protokoll nur zum Lesen direkt in der Seite (über die Vorschau-Funktion von Microsoft Graph, ohne SharePoint-Anmeldung im Browser). Bearbeiten lässt sich Word nicht in fremde Seiten einbetten.
3. **Review:** „Zum Review geben“ markiert das Protokoll für die Reviewer*innen. Sie geben es frei oder mit einem Hinweis zurück. Der Hinweis geht per Mail an die Person, die das Protokoll angelegt hat. Das eigene Protokoll gibt immer jemand anderes frei.
4. **Versand:** Nach der Freigabe schickt eine Reviewerin oder ein Reviewer das Protokoll an alle Leitenden. Die Mail enthält das PDF (SharePoint wandelt die Word-Datei um) und einen Link in den Leitendenbereich. Alle Empfänger*innen stehen in Blindkopie.

Noch nicht verschickte Protokolle können die Person, die sie angelegt hat, und die Reviewer*innen löschen (nach einer Rückfrage). Die Datei landet im Papierkorb der SharePoint-Website und lässt sich dort wiederherstellen. Verschickte und archivierte Protokolle bleiben erhalten.

Wird die Datei nach der Freigabe noch geändert, erkennt die Website das an der Version der Datei. Dann muss das Protokoll erneut ins Review, bevor es verschickt werden kann.

Dateien im Ordner ohne Status, also alle Protokolle von vor diesem Modul, erscheinen als „Archiv“ unter „Erledigt“. Sie lassen sich öffnen und als PDF laden, aber nicht verschicken. Das Datum im Dateinamen wird auch in der Form `16.09.25` erkannt.

Code: `api/lib/protokolle.ts`, `api/endpoints/intern-pflege-protokolle.ts`, `web/src/components/pflege/ProtokollePflege.svelte`.

## Nächster Termin

Nach der Freigabe liest die Website aus dem freigegebenen Protokoll den Termin der **nächsten Leitendenrunde** heraus und speichert ihn als Vorschlag beim Protokoll (Spalte `Termin`). Eine Reviewerin oder ein Reviewer bestätigt, korrigiert oder verwirft ihn.

1. **Erkennen:** Direkt nach „Freigeben“ lädt die Website genau die freigegebene Fassung der Word-Datei, macht daraus Text (inklusive Tabellen) und schickt ihn an ein Sprachmodell bei Azure OpenAI. Das Modell sucht nur den nächsten Termin der Leitendenrunde, nicht Aktionen, Lager oder andere Termine. Relative Angaben wie „in zwei Wochen“ oder „nächsten Dienstag“ rechnet es vom Datum der Sitzung aus (aus dem Dateinamen), nicht von heute. Das Ergebnis ist eines von:
   - **gefunden:** ein eindeutiger Termin, mit der Fundstelle im Protokoll,
   - **unklar:** mehrere Kandidaten, Widersprüche, nur ein ungefährer Zeitraum oder keine überprüfbare Fundstelle; wenn erkennbar mit dem wahrscheinlichsten Termin,
   - **nicht gefunden:** kein nächster Termin im Protokoll,
   - **fehler:** die Erkennung ist gescheitert (Datei nicht lesbar, kein Datum im Dateinamen, Zeitüberschreitung, Tageslimit, Fehler bei Azure OpenAI),
   - **nicht eingerichtet:** kein Modell konfiguriert.

   Die Freigabe selbst scheitert nie an der Erkennung.

   Archivierte Protokolle (Dateien ohne Status) sind nie freigegeben worden. Beim jeweils neuesten zeigt die Seite „Termin erkennen“, damit der Termin auch ohne neue Freigabe erfasst werden kann. Der Vorschlag gilt dort für die Datei, wie sie beim Erkennen war; wird sie danach geändert, ist er veraltet. Reviewer*innen prüfen den Vorschlag deshalb besonders genau.

2. **Prüfen:** Die Website traut der Antwort nicht blind. Daten, die es nicht gibt, die am oder vor dem Sitzungstag oder mehr als ein Jahr danach liegen, fallen weg. „gefunden“ gilt nur mit Datum und einer Fundstelle, die wörtlich im Protokoll steht; sonst wird daraus „unklar“.
3. **Entscheiden** (nur Reviewer*innen, nur bei freigegebenen oder verschickten Protokollen):
   - **Bestätigen** übernimmt den Vorschlag oder ein korrigiertes Datum, optional mit Uhrzeit (`HH:MM`) und Ort (höchstens 120 Zeichen). Das Datum darf nicht vor der Sitzung liegen.
   - **Manuell eintragen** ist dasselbe ohne Vorschlag, z. B. bei „fehler“, „nicht gefunden“ oder „nicht eingerichtet“.
   - **Ablehnen** heißt: Es gibt keinen nächsten Termin (bzw. er steht nicht fest).
   - **Neu erkennen** startet die Erkennung noch einmal und setzt eine frühere Entscheidung zurück. Das geht nur, solange die Datei seit der Freigabe nicht geändert wurde.

Der Vorschlag gehört immer zu einer Fassung der Datei. Wird das freigegebene Protokoll danach noch geändert, gilt der Vorschlag als **veraltet** und lässt sich nicht mehr bestätigen; nach erneutem Review und erneuter Freigabe wird er neu erkannt. „Wieder bearbeiten“ löscht den Vorschlag.

Erinnerungen oder Mails zum nächsten Termin gibt es noch nicht. Der bestätigte Termin wird nur beim Protokoll gespeichert.

Code: `api/lib/protokoll-termin.ts` (Prompt, Prüfung der Antwort, Entscheidungen), `api/lib/docx-text.ts` (Word → Text), `api/lib/azure-openai.ts` (Aufruf von Azure OpenAI, gemeinsam mit der Belegprüfung).

### Was an Azure OpenAI geht

Nur das Datum der Sitzung und der Text des freigegebenen Protokolls, sonst nichts: keine Daten aus CampFlow, keine Empfänger*innen, keine Namen von Reviewer*innen. Lange Protokolle werden gekürzt (Anfang und Ende, zusammen höchstens 12.000 Zeichen). Der Prompt sagt dem Modell, dass der Protokolltext nur Daten sind und keine Anweisungen; der Text steht zwischen Markierungen, die er selbst nicht enthalten kann. Das Modell schlägt nur Datum, Uhrzeit, Ort und Fundstelle vor, es entscheidet nichts. Die Website schreibt weder Protokolltext noch Prompt noch Fundstelle in die Logs.

Es gelten dieselben Bedingungen wie bei der [KI-Vorprüfung für Belege](belege-ki-pruefung.md#datenschutz): eigenes Azure-Abonnement, kein Training, Verarbeitung in der EU bei „Datenzonenstandard“.

## Empfänger*innen

Die Adressen kommen aus CampFlow, nicht aus Microsoft: alle aktuellen Mitglieder der Mitgliederliste, die in einer der Gruppen aus `CONFIG.protokolle.campflowGroups` sind, mit ihrer Haupt-E-Mail-Adresse. Die Gruppen werden ohne Emoji, Gendersternchen und Groß-/Kleinschreibung verglichen, und es reicht der Anfang: `Leiter*in` passt auf „🐦‍🔥 Leiter\*in“.

Vor dem Versand zeigt die Seite die Anzahl der Empfänger*innen. Ändert sich die Liste in CampFlow zwischen Anzeige und Versand, muss die Anzahl neu bestätigt werden.

## Einrichtung

### Konfiguration

In `api/lib/config.ts` unter `protokolle`:

| Wert             | Bedeutung                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `library`        | Name der Dokumentbibliothek in ihrer URL, hier `Unterlagen` (`…/sites/leitende/Unterlagen`). |
| `folderPath`     | Ordner der Protokolle in dieser Bibliothek, hier `Protokolle/Leitendenrunde`.                |
| `templateUrl`    | Freigabelink der Word-Vorlage (ohne `?e=…`).                                                 |
| `defaultTitle`   | Vorbelegter Titel neuer Protokolle.                                                          |
| `reviewers`      | Logins, die freigeben und verschicken dürfen, z. B. der Vorstand. Leer: alle Leitenden.      |
| `sender`         | Postfach, das die Protokolle verschickt. Leer: kein Versand, alles andere funktioniert.      |
| `campflowGroups` | CampFlow-Gruppen der Leitenden, siehe oben.                                                  |
| `termin`         | Modell für den nächsten Termin, siehe unten.                                                 |

Unter `protokolle.termin`:

| Wert                   | Bedeutung                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `endpoint`             | Azure-OpenAI-Ressource, standardmäßig dieselbe wie für die Belegprüfung. Leer: „nicht eingerichtet“.         |
| `deployment`           | Name der Bereitstellung, standardmäßig dieselbe wie für die Belegprüfung. Leer: „nicht eingerichtet“.        |
| `maxExtractionsPerDay` | Erkennungen pro Tag und Functions-Instanz (Kostenbremse, wie `maxChecksPerDay` der Belege). `0` schaltet ab. |

Schlüssel und Anmeldung sind dieselben wie bei der Belegprüfung (`AZURE_OPENAI_API_KEY` oder die App-Registrierung), Einrichtung siehe [KI-Vorprüfung für Belege](belege-ki-pruefung.md). Ein Protokoll braucht etwa 1.000–4.000 Token. Steht das Ratenlimit der Bereitstellung auf 5.000 Token pro Minute, kann eine Erkennung kurz nach einer Belegprüfung mit „429“ scheitern; dann einfach „Neu erkennen“ oder das Limit etwas anheben.

### Spalten in der Bibliothek „Unterlagen“

Der Status liegt in Spalten der Bibliothek. In SharePoint unter **Unterlagen → Spalte hinzufügen** diese Spalten anlegen. Der interne Name entsteht aus dem ersten Namen, den man vergibt, also genau so schreiben:

| Spalte            | Typ                           |
| ----------------- | ----------------------------- |
| `Status`          | Eine Textzeile                |
| `ErstelltVon`     | Eine Textzeile                |
| `Pruefnotiz`      | Mehrere Textzeilen (Nur-Text) |
| `FreigegebenVon`  | Eine Textzeile                |
| `FreigegebenAm`   | Eine Textzeile                |
| `FreigabeVersion` | Eine Textzeile                |
| `Versand`         | Mehrere Textzeilen (Nur-Text) |
| `Termin`          | Mehrere Textzeilen (Nur-Text) |

`Termin` enthält den nächsten Termin als JSON (Vorschlag, Fundstelle, Entscheidung). Fehlt die Spalte, funktionieren Freigabe und Versand weiter, nur der nächste Termin wird nicht gespeichert.

Die Spalten gelten für die ganze Bibliothek. Bei Dateien außerhalb des Protokoll-Ordners bleiben sie leer, und die Website ändert dort nichts.

### Rechte

- Die App-Registrierung der Website braucht Lese- und Schreibzugriff auf die Bibliothek (wie für Downloads und Belege) und Lesezugriff auf die Vorlage. Die Vorlage holt sie über den Freigabelink (`/shares/…`); das funktioniert mit `Sites.ReadWrite.All` bzw. `Files.ReadWrite.All`, aber nicht unbedingt mit `Sites.Selected`. Findet die Website die Vorlage nicht, meldet „Neues Protokoll“ das.
- Für den Versand braucht die App `Mail.Send` für das Postfach in `sender`.
- Wer mitschreiben will, braucht in SharePoint Bearbeitungsrechte auf den Ordner. Das haben die Leitenden über die Website „leitende“ bereits.

### Testen

1. Im Leitendenbereich **Protokolle → Neues Protokoll** mit dem Titel „TEST – bitte löschen“ anlegen und in Word öffnen.
2. Zum Review geben, mit einem zweiten Account freigeben.
3. Für einen Versandtest vorübergehend `campflowGroups` auf eine Gruppe mit nur einer Testperson setzen, sonst geht die Mail an alle Leitenden.
4. Die Testdatei danach in SharePoint löschen.

Wird der Versand gestartet, aber nicht bestätigt (z. B. bei einem Timeout), zeigt die Seite „Versand unklar“. Dann im Postfach des Absenders unter „Gesendete Elemente“ nachsehen und nur erneut senden, wenn die Mail dort fehlt.
