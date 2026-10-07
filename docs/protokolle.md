# Protokolle

Das Modul **Protokolle** im Leitendenbereich (`/leitendenbereich/protokolle`) ersetzt den Weg über SharePoint. Niemand muss Dateien selbst anlegen, benennen oder verschieben.

1. **Anlegen:** „Neues Protokoll“ kopiert die Word-Vorlage in den Protokoll-Ordner. Die Datei heißt `JJJJ-MM-TT Titel.docx`.
2. **Schreiben:** „In Word bearbeiten“ öffnet die Datei in Word im Browser. Mit „Link kopieren“ lässt sich der Link teilen (z. B. in WhatsApp), damit alle während der Sitzung mitschreiben.
3. **Review:** „Zum Review geben“ markiert das Protokoll für die Reviewer*innen. Sie geben es frei oder mit einem Hinweis zurück. Der Hinweis geht per Mail an die Person, die das Protokoll angelegt hat. Das eigene Protokoll gibt immer jemand anderes frei.
4. **Versand:** Nach der Freigabe schickt eine Reviewerin oder ein Reviewer das Protokoll an alle Leitenden. Die Mail enthält das PDF (SharePoint wandelt die Word-Datei um) und einen Link in den Leitendenbereich. Alle Empfänger*innen stehen in Blindkopie.

Wird die Datei nach der Freigabe noch geändert, erkennt die Website das an der Version der Datei. Dann muss das Protokoll erneut ins Review, bevor es verschickt werden kann.

Dateien im Ordner ohne Status, also alle Protokolle von vor diesem Modul, erscheinen als „Archiv“ unter „Erledigt“. Sie lassen sich öffnen und als PDF laden, aber nicht verschicken. Das Datum im Dateinamen wird auch in der Form `16.09.25` erkannt.

Code: `api/lib/protokolle.ts`, `api/endpoints/intern-pflege-protokolle.ts`, `web/src/components/pflege/ProtokollePflege.svelte`.

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
