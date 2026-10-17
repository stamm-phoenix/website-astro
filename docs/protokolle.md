# Protokolle

> Neue Protokolle lassen sich inzwischen auch direkt auf der Website schreiben, ohne Word: siehe [Protokoll-Editor](protokoll-editor.md) (#277). Dieses Dokument beschreibt den Weg über die Word-Vorlage. Er bleibt unverändert bestehen, bis der Editor mit allen Schritten aus #277 fertig ist, und wird erst danach in #284 abgeschaltet. Protokolle aus dem Editor durchlaufen Review und Versand dort; ihre PDFs im Protokoll-Ordner blendet die Liste der Protokoll-Dateien aus.

Das Modul **Protokolle** im Leitendenbereich (`/leitendenbereich/protokolle`) ersetzt den Weg über SharePoint. Niemand muss Dateien selbst anlegen, benennen oder verschieben.

1. **Anlegen:** „Neues Protokoll“ kopiert die Word-Vorlage in den Protokoll-Ordner. Die Datei heißt `JJJJ-MM-TT Titel.docx`.
2. **Schreiben:** „In Word bearbeiten“ öffnet die Datei in Word im Browser. Mit „Link kopieren“ lässt sich der Link teilen (z. B. in WhatsApp), damit alle während der Sitzung mitschreiben. **Vorschau** zeigt das Protokoll nur zum Lesen direkt in der Seite (über die Vorschau-Funktion von Microsoft Graph, ohne SharePoint-Anmeldung im Browser). Bearbeiten lässt sich Word nicht in fremde Seiten einbetten.
3. **Review (freiwillig) und Freigabe:** Wer noch ein zweites Paar Augen möchte, tippt auf „Zum Review geben“. Dann können alle Leitenden das Protokoll freigeben oder mit einem Hinweis zurückgeben. Der Hinweis geht per Mail an die Person, die das Protokoll angelegt hat. Wer sich sicher ist, gibt den Entwurf mit „Freigeben“ direkt frei. Das eigene Protokoll freizugeben, ob als Entwurf oder im Review, geht nur mit einem ausdrücklichen Häkchen („ohne zweite Person“).
4. **Versand:** Nach der Freigabe schicken es alle Leitenden mit „Protokoll verschicken“ an die Leitenden und alle mit dem Label „Protokollempfang“ (siehe [Empfänger*innen](#empfängerinnen)). Die Mail enthält das PDF (SharePoint wandelt die Word-Datei um) und einen Link in den Leitendenbereich. Alle Empfänger*innen stehen in Blindkopie.

Noch nicht verschickte Protokolle können alle Leitenden löschen (nach einer Rückfrage). Die Datei landet im Papierkorb der SharePoint-Website und lässt sich dort wiederherstellen. Verschickte und archivierte Protokolle bleiben erhalten.

Wird die Datei nach der Freigabe noch geändert, erkennt die Website das an der Version der Datei. Dann muss es erneut freigegeben werden („Wieder bearbeiten“), bevor es verschickt werden kann.

Dateien im Ordner ohne Status, also alle Protokolle von vor diesem Modul, erscheinen als „Archiv“ unter „Erledigt“. Sie lassen sich öffnen und als PDF laden, aber nicht verschicken. Das Datum im Dateinamen wird auch in der Form `16.09.25` erkannt.

Code: `api/lib/protokolle.ts`, `api/endpoints/intern-pflege-protokolle.ts`, `web/src/components/pflege/ProtokollePflege.svelte`.

## Nächster Termin

Nach der Freigabe liest die Website aus dem freigegebenen Protokoll den Termin der **nächsten Leitendenrunde** heraus und speichert ihn als Vorschlag beim Protokoll (Azure SQL). Alle Leitenden können ihn bestätigen, korrigieren oder verwerfen.

1. **Erkennen:** Direkt nach „Freigeben“ lädt die Website genau die freigegebene Fassung der DOCX-, PDF- oder TXT-Datei, macht daraus Text (inklusive Tabellen) und schickt ihn an ein Sprachmodell bei Azure OpenAI. Das Modell sucht nur den nächsten Termin der Leitendenrunde, nicht Aktionen, Lager oder andere Termine. Relative Angaben wie „in zwei Wochen“ oder „nächsten Dienstag“ rechnet es vom Datum der Sitzung aus (aus dem Dateinamen), nicht von heute. Das Ergebnis ist eines von:
   - **gefunden:** ein eindeutiger Termin, mit der Fundstelle im Protokoll,
   - **unklar:** mehrere Kandidaten, Widersprüche, nur ein ungefährer Zeitraum oder keine überprüfbare Fundstelle; wenn erkennbar mit dem wahrscheinlichsten Termin,
   - **nicht gefunden:** kein nächster Termin im Protokoll,
   - **fehler:** die Erkennung ist gescheitert (Datei nicht lesbar, kein Datum im Dateinamen, Zeitüberschreitung, Tageslimit, Fehler bei Azure OpenAI),
   - **nicht eingerichtet:** kein Modell konfiguriert.

   Die Freigabe selbst scheitert nie an der Erkennung.

   Archivierte Protokolle (Dateien ohne Status) sind nie freigegeben worden. Beim jeweils neuesten zeigt die Seite „Termin erkennen“, damit der Termin auch ohne neue Freigabe erfasst werden kann. Der Vorschlag gilt dort für die Datei, wie sie beim Erkennen war; wird sie danach geändert, ist er veraltet. Prüfe den Vorschlag deshalb besonders genau.

2. **Prüfen:** Die Website traut der Antwort nicht blind. Daten, die es nicht gibt, die am oder vor dem Sitzungstag oder mehr als ein Jahr danach liegen, fallen weg. „gefunden“ gilt nur mit Datum und einer Fundstelle, die wörtlich im Protokoll steht; sonst wird daraus „unklar“.
3. **Entscheiden** (alle Leitenden, bei freigegebenen, verschickten oder archivierten Protokollen):
   - **Bestätigen** übernimmt den Vorschlag oder ein korrigiertes Datum, optional mit Uhrzeit (`HH:MM`) und Ort (höchstens 120 Zeichen). Das Datum darf nicht vor der Sitzung liegen.
   - **Manuell eintragen** ist dasselbe ohne Vorschlag, z. B. bei „fehler“, „nicht gefunden“ oder „nicht eingerichtet“. Es geht auch vor der ersten Erkennung; dann steht im gespeicherten Zustand „nicht ausgefuehrt“, und es erfolgt kein Modellaufruf.
   - **Ablehnen** heißt: Es gibt keinen nächsten Termin (bzw. er steht nicht fest).
   - **Neu erkennen** startet die Erkennung noch einmal und setzt eine frühere Entscheidung zurück. Das geht bei freigegebenen oder verschickten Protokollen nur, solange die Datei seit der Freigabe nicht geändert wurde. Bei archivierten Protokollen kann ein veralteter Vorschlag aus der aktuellen Datei neu erkannt werden.

Der Vorschlag gehört immer zu einer Fassung der Datei. Wird das freigegebene Protokoll danach noch geändert, gilt der Vorschlag als **veraltet** und lässt sich nicht mehr bestätigen; nach erneuter Freigabe wird er neu erkannt. „Wieder bearbeiten“ löscht den Vorschlag. Das gilt auch nach dem Versand: Eine geänderte verschickte Datei lässt keine weiteren Terminentscheidungen zu. Sie lässt sich nicht wieder ins Review geben; eine neue Fassung muss als neues Protokoll angelegt werden.

Die Inhaltsversion ist ein SHA-256-Fingerabdruck der Word-Dokumentteile (`word/`), einschließlich Text, Formatierung, Kopf- und Fußzeilen, Bildern und eingebetteten Objekten. SharePoint schreibt Bibliotheksspalten wie `Termin` in `customXml` und ändert dabei auch `cTag` und Dateihash. Diese Metadaten gehören deshalb nicht zur Inhaltsversion. Die API lädt Dateien mit gespeichertem Fingerabdruck bei einer neuen SharePoint-Version erneut; ein Cache hält genau einen Fingerabdruck je Datei des aktuellen Ordners und entfernt Einträge gelöschter Dateien. Höchstens vier Dateien werden gleichzeitig geprüft. Ist die Inhaltsprüfung nicht möglich, bleibt die Datei im Review; die Freigabe lässt sich nach erneutem Laden wieder versuchen. Alte gespeicherte `cTag`-Werte bleiben unverändert und werden beim erneuten Erkennen beziehungsweise Freigeben ersetzt.

Bei deaktivierter KI lässt sich ein veralteter Archivtermin mit „Termin zurücksetzen“ auf die aktuelle Fassung beziehen und anschließend manuell eintragen.

Vor dem Modellaufruf prüft die API, ob die heruntergeladene Datei noch zur geladenen Version gehört. Beim Speichern vergleicht sie die Version des Bibliothekseintrags erneut. Eine Änderung oder Entscheidung während der Erkennung verwirft das Ergebnis; die Freigabe bleibt bestehen.

Erinnerungen oder Mails zum nächsten Termin gibt es noch nicht. Der bestätigte Termin wird nur beim Protokoll gespeichert.

Code: `api/lib/protokoll-termin.ts` (Prompt, Prüfung der Antwort, Entscheidungen), `api/lib/docx-text.ts` (Word → Text), `api/lib/azure-openai.ts` (Aufruf von Azure OpenAI, gemeinsam mit der Belegprüfung).

### Was an Azure OpenAI geht

Das Datum der Sitzung und der Text des freigegebenen oder manuell ausgewählten archivierten Protokolls. Zusätzliche Daten aus CampFlow, Empfängerlisten oder Kontodaten von Leitenden werden nicht abgerufen oder übertragen. Im Protokoll selbst können Namen und andere personenbezogene Angaben stehen. Lange Protokolle werden gekürzt (Anfang und Ende, zusammen höchstens 12.000 Zeichen). Der Prompt sagt dem Modell, dass der Protokolltext nur Daten sind und keine Anweisungen; der Text steht zwischen Markierungen, die er selbst nicht enthalten kann. Das Modell schlägt nur Datum, Uhrzeit, Ort und Fundstelle vor, es entscheidet nichts. Die Website schreibt weder Protokolltext noch Prompt noch Fundstelle in die Logs.

Es gelten dieselben Bedingungen wie bei der [KI-Vorprüfung für Belege](belege-ki-pruefung.md#datenschutz): eigenes Azure-Abonnement, kein Training und mögliche Speicherung zur Missbrauchserkennung. Die am 10. Oktober 2026 geprüfte Bereitstellung `gpt-4.1-mini` verwendet „Global Standard“ und kann weltweit verarbeiten. Die Ressourcenregion Germany West Central begrenzt die Verarbeitung nicht auf Deutschland oder die EU. Nur „Datenzonenstandard“ in einer EU-Region würde die Verarbeitung auf die EU beschränken.

## Empfänger*innen

Die Adressen kommen aus CampFlow, nicht aus Microsoft: alle aktuellen Mitglieder der Mitgliederliste, die in einer der Gruppen aus `CONFIG.protokolle.campflowGroups` sind, mit ihrer Haupt-E-Mail-Adresse. Die Gruppen werden ohne Emoji, Gendersternchen und Groß-/Kleinschreibung verglichen, und es reicht der Anfang: `Leiter*in` passt auf „🐦‍🔥 Leiter\*in“.

Zusätzlich bekommen alle aktuellen Mitglieder mit einem der Labels aus `CONFIG.protokolle.campflowLabels` (hier „Protokollempfang“) das Protokoll, auch ohne Leitenden-Gruppe. Labels werden ohne Emoji und Groß-/Kleinschreibung verglichen, aber als ganzer Name mit Ziffern: „📄 Protokollempfang“ passt, „Protokollempfang 2025“ nicht. Jede Adresse bekommt die Mail nur einmal, auch wenn eine Person Leitende ist und das Label hat. Ohne Stammes-Account öffnen diese Personen den Link nicht, das Protokoll liegt aber immer im Anhang. Ist die Datei größer als 2,5 MB (`MAX_MAIL_ATTACHMENT_BYTES`), verschickt die Website nichts und erklärt im Dialog, dass sie zu groß ist; das gilt für Word- und Editor-Protokolle. Übliche Protokolle sind weit kleiner.

Vor dem Versand zeigt die Seite die Liste aus CampFlow mit Name, Adresse und dem Grund (Gruppe oder Label). Für diesen einen Versand lassen sich Personen per Häkchen herausnehmen und bis zu 20 weitere Adressen von Hand eintragen. Beides wird nicht gespeichert, beim Protokoll steht nur die Anzahl der Empfänger*innen. Die API prüft die eingetragenen Adressen erneut und verschickt an die Liste aus CampFlow ohne die herausgenommenen und mit den zusätzlichen Adressen, jede nur einmal. Ändert sich die Liste in CampFlow zwischen Anzeige und Versand, muss sie neu bestätigt werden.

## Einrichtung

### Konfiguration

In `api/lib/config.ts` unter `protokolle`:

| Wert             | Bedeutung                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `library`        | Name der Dokumentbibliothek in ihrer URL, hier `Unterlagen` (`…/sites/leitende/Unterlagen`). |
| `folderPath`     | Ordner der Protokolle in dieser Bibliothek, hier `Protokolle/Leitendenrunde`.                |
| `templateFileName` | Word-Vorlage im Ordner `folderPath`, hier `YYYY-MM-DD_Leitendenrunde.docx`.                |
| `defaultTitle`   | Vorbelegter Titel neuer Protokolle.                                                          |
| `sender`         | Postfach, das die Protokolle verschickt. Leer: kein Versand, alles andere funktioniert.      |
| `campflowGroups` | CampFlow-Gruppen der Leitenden, siehe oben.                                                  |
| `campflowLabels` | CampFlow-Labels weiterer Empfänger*innen, hier `Protokollempfang`, siehe oben.               |
| `termin`         | Modell für den nächsten Termin, siehe unten.                                                 |

Unter `protokolle.termin`:

| Wert                   | Bedeutung                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `endpoint`             | Azure-OpenAI-Ressource, standardmäßig dieselbe wie für die Belegprüfung. Leer: „nicht eingerichtet“.         |
| `deployment`           | Name der Bereitstellung, standardmäßig dieselbe wie für die Belegprüfung. Leer: „nicht eingerichtet“.        |
| `maxExtractionsPerDay` | Erkennungen pro Tag und Functions-Instanz (Kostenbremse, wie `maxChecksPerDay` der Belege). `0` schaltet ab. |

Das Tageslimit zählt nur im laufenden Prozess. Neustarts und weitere Instanzen haben eigene Zähler; es erfüllt damit noch nicht die persistente KI-Quote aus #184. Das Ratenlimit in Azure begrenzt Anfragen pro Minute und ist keine feste Ausgabenobergrenze.

Schlüssel und Anmeldung sind dieselben wie bei der Belegprüfung (`AZURE_OPENAI_API_KEY` oder die App-Registrierung), Einrichtung siehe [KI-Vorprüfung für Belege](belege-ki-pruefung.md). Ein Protokoll braucht etwa 1.000–4.000 Token. Steht das Ratenlimit der Bereitstellung auf 5.000 Token pro Minute, kann eine Erkennung kurz nach einer Belegprüfung mit „429“ scheitern; dann einfach „Neu erkennen“ oder das Limit etwas anheben.

### Metadaten in Azure SQL und Migration

Dateien bleiben im SharePoint-Ordner. DOCX, PDF mit Textebene und TXT (UTF-8 oder UTF-16 mit BOM) sind unterstützt. TXT hat eine Klartextvorschau in der App. PDFs und TXT werden unverändert heruntergeladen und angehängt; nur Word wird von Graph zu PDF konvertiert. Scans ohne Textebene und geschützte PDFs benötigen manuelle Übernahme; keine externe OCR. Die Extraktion ist auf 2 MB, 200 PDF-Seiten und 200.000 Zeichen begrenzt, Aufgaben weiterhin auf 24.000 Zeichen. PDF-Parsing läuft in einem separaten Worker mit fünf Sekunden Laufzeitlimit und 96 MB V8-Heaplimit. PDF/TXT verwenden SHA-256 der Dateibytes, DOCX der Word-Teile.

Reviewstatus, Autor, Prüfnotiz, Freigabe, Versandreservierung und Termin liegen in `organisation.protokoll`. JSON erhält bisherige Feldnamen und Werte verlustfrei. SQL-`rowversion` und Dateiversion bilden gemeinsam das ETag. Die Anwendung liest und schreibt keine fachlichen SharePoint-Spalten mehr. `organisation.protokoll_import` bestätigt den Import; ohne ihn verweigert die Anwendung den Zugriff statt alte Freigaben als Archiv einzustufen. Vorschauen erhalten ausschließlich erfundene SQL-Testdaten.

Migration `0012` bleibt unverändert. `0015` ergänzt den Cutover-Zustand und einen Vergleich mit dem zuletzt importierten SQL-Stand. Die neue API startet **gesperrt** (`frozen`, HTTP 503); es gibt keine automatische Produktionsaktivierung im Deployment. Preview-Daten starten im SQL-Modus. Protokoll-Requests teilen dieselbe SQL-Anwendungssperre im Shared-Modus; Operator-Schritte halten sie exklusiv. Ein eigener Sperrpool hält Datenbankverbindungen für die geschützten Datenzugriffe frei. `--freeze` wartet auf laufende Requests einschließlich Versand; ein Sperrtimeout erfordert einen erneuten Versuch. Transaktionen mit Graph/Mail-Effekten werden niemals automatisch wiederholt.

**Produktionswechsel** (Azure-CLI-Anmeldung mit Graph-Lesezugriff und SQL-Schreibzugriff):

1. #273 deployen und erfolgreichen Abschluss des Azure-Deployments abwarten. Die alten SharePoint-Schreiber werden dadurch ersetzt, die neue API bleibt gesperrt. Keine Bearbeitung der Workflow-Spalten durch Personen oder andere Programme während des Wechsels; Word-Dateien bleiben in SharePoint.
2. Aktuelle Daten importieren und prüfen:

```sh
cd api
bun scripts/protokoll-migrate.ts --plan
bun scripts/protokoll-migrate.ts --import
bun scripts/protokoll-migrate.ts --verify
bun scripts/protokoll-migrate.ts --activate
```

`--activate` prüft die neue API über die öffentliche, datenfreie Capability `/api/protokoll-cutover-status` am festen Produktionshost und beobachtet sie fünf Minuten lang, damit alte HTTP-Aufrufe auslaufen. Danach prüft es die aktuelle SharePoint-Quelle **unter derselben Sperre**, bevor es atomar auf SQL umschaltet. Eine alte API, fehlender Import oder eine geänderte Quelle verhindert die Aktivierung. Bei Quelländerungen im anfänglichen Freeze `--import` erneut ausführen: Änderungen und vollständig geleerte Felder werden nachgezogen. SQL-Entscheidungen seit dem Import werden niemals überschrieben; nach der ersten Aktivierung sind weitere Importe grundsätzlich gesperrt, auch nach erneutem Freeze.

`--plan` zeigt nur Anzahlen. Fehler enthalten bekannte Handlungscodes, keine SDK-Fehlertexte, Protokollwerte, URLs oder Tokens. `SOURCE_CHANGED_REIMPORT_WHILE_FROZEN` verlangt einen erneuten Import vor der ersten Aktivierung; `SQL_CHANGED_SINCE_IMPORT` verlangt manuelle Prüfung. `SQL_GATE_DEPLOYMENT_REQUIRED` verlangt das erfolgreiche Deployment dieser Version. Der Deployment-Check akzeptiert eine gesperrte API und prüft im SQL-Modus die aktuelle Quelle. Nach der Aktivierung sind allein abweichende alte SharePoint-Werte eine Warnung, weil SQL maßgeblich ist; fehlender Import, ungültige Spaltentypen und Graph-/SQL-Zugriffsfehler bleiben fatal. Aktivierung, Restore und Cleanup prüfen weiterhin streng.

**Rückfall und Restore**: Zuerst die SQL-Version sperren. Der Restore schreibt den **aktuellen SQL-Stand**, einschließlich erfolgtem Versand und späteren Terminentscheidungen, bedingt nach SharePoint zurück, statt alte Importwerte über neue Entscheidungen zu legen:

```sh
bun scripts/protokoll-migrate.ts --freeze
bun scripts/protokoll-migrate.ts --restore --sql-live
bun scripts/protokoll-migrate.ts --verify
```

Erst nach erfolgreichem Restore die vorherige Version deployen; SQL bleibt gesperrt. Ein erneuter SQL-Einsatz mit `--activate` funktioniert nur, wenn die vorherige Version nach dem Restore keine Workflow-Spalten geändert hat. Nach solchen Änderungen verweigert die Verifikation die Aktivierung; es gibt keinen automatischen Reconcile- oder Reimport-Pfad nach einem Rollback. SQL bleibt bis zu einem gesondert geprüften Abgleich gesperrt. DOCX-Fingerabdrücke versteht bereits #257; PDF/TXT benötigen weiterhin diese neue Version. Der Rückfall entfernt keine Dateien und keine SQL-Daten. Fehlende Dateien mit SQL-Workflowdaten verhindern den Restore: zunächst aus dem SharePoint-Papierkorb wiederherstellen. Fremde Spaltenänderungen und ETag-Konflikte stoppen den Ablauf. Teilweise abgeschlossene Wiederherstellungen können erneut ausgeführt werden; bereits identische Werte werden nicht neu geschrieben.

**Optionale Bereinigung**, erst nach geprüftem SQL-Betrieb und erfolgreichem Restore-Test:

```sh
bun scripts/protokoll-migrate.ts --freeze
bun scripts/protokoll-migrate.ts --cleanup --sql-live
bun scripts/protokoll-migrate.ts --verify
bun scripts/protokoll-migrate.ts --activate
```

Nur die acht Workflow-Feldwerte werden geleert, unter SharePoint-ETag-Vergleich. Dateien, fremde Metadaten und Bibliotheksspalten bleiben erhalten. SQL behält die Quellkopie; `source_cleared` unterscheidet geprüfte Bereinigung von überraschend geleerten Quellwerten. Nach einem Teilfehler bleibt die API gesperrt; Cleanup oder Restore kann erneut ausgeführt werden. Ohne expliziten Operator-Aufruf gibt es weder Bereinigung noch Restore.

Der CI-Paketcheck installiert ausschließlich Produktionsabhängigkeiten in einer separaten Kopie, lädt die optionale native Canvas-Bibliothek und führt die PDF-Tests mit dem kopierten Worker aus. Belastungstests decken stark komprimierten Text, mehr als 200 Seiten, ungültige PDFs und die weitere Nutzbarkeit nach einer Ablehnung ab. Das V8-Heaplimit begrenzt nicht alle nativen/externen Speicherallokationen; die 2-MB-Eingabegrenze und das Zeitlimit bleiben zusätzliche Schranken.

### Rechte

Vor der SQL-Aktivierung braucht auch die Workflow-Identität `SQL_MIGRATION_CLIENT_ID` Microsoft-Graph-Lesezugriff auf die konfigurierte SharePoint-Site (z. B. Application Permission `Sites.Selected` mit Read-Grant auf diese Site). SQL-Rechte allein reichen für den Check späterer Produktionsdeployments nicht; fehlender Zugriff stoppt sie absichtlich. Der initiale Freeze benötigt diesen Graph-Zugriff noch nicht.

- Die App-Registrierung der Website braucht Lese- und Schreibzugriff auf die Site „leitende“, sonst nichts in SharePoint: Die Protokolle sind die einzigen Dateien dort (#165). Auch die Vorlage holt sie über den Ordnerpfad in der Bibliothek, nicht über einen Freigabelink. Dafür reicht die Anwendungsberechtigung `Sites.Selected` mit einer Schreibfreigabe auf diese Site, statt `Sites.ReadWrite.All` für alle Sites (Umstellung siehe unten). Findet die Website die Vorlage nicht, meldet „Neues Protokoll“ das.
- Für den Versand braucht die App `Mail.Send` für das Postfach in `sender`.
- Wer mitschreiben will, braucht in SharePoint Bearbeitungsrechte auf den Ordner. Das haben die Leitenden über die Website „leitende“ bereits.

#### Umstellung auf `Sites.Selected`

Die Rechte der Website-App (`5dd5864b-e2c3-4c21-9ef2-8bb3290cd374`) in Microsoft Graph sind danach:

| Recht | Wofür |
| --- | --- |
| `Sites.Selected` mit Freigabe `write` auf die Site „leitende“ | Protokolle lesen, anlegen, löschen, Vorschau und PDF |
| `Mail.Send` | Kontaktformular, Nikolaus, Sammelbestellung, Belege, Protokollversand, Erinnerungen |
| `GroupMember.Read.All`, `User.Read.All` | Personenliste der Aufgaben ([Aufgaben](aufgaben.md)) |

1. **Freigabe auf der Site:** Mit einer Identität, die `Sites.FullControl.All` hat (z. B. die
   Verwaltungsidentität `claude-azure-mcp`), die Website-App für die Site freigeben:

   ```http
   POST https://graph.microsoft.com/v1.0/sites/stammphoenix.sharepoint.com,571937bd-77aa-4e71-8d76-86e60015a1b9,6eec5ae9-3bb4-4393-913a-ee9e0fef0be1/permissions
   Content-Type: application/json

   {"roles":["write"],"grantedToIdentities":[{"application":{"id":"5dd5864b-e2c3-4c21-9ef2-8bb3290cd374","displayName":"website"}}]}
   ```

   `GET …/permissions` auf dieselbe Site zeigt danach `website` mit `write` neben
   `website-astro-db-migrations` (`read`, für `protokoll-migrate.ts --check` im Deploy).
2. **Entra:** App-Registrierungen → Website-App → API-Berechtigungen → Microsoft Graph →
   Anwendungsberechtigungen → `Sites.Selected` hinzufügen und Administratorzustimmung erteilen.
3. **Altes Recht entfernen und prüfen:** Solange `Sites.ReadWrite.All` da ist, merkt man vom
   neuen Recht nichts. Deshalb `Sites.ReadWrite.All` (und ein etwaiges `Files.ReadWrite.All` oder
   `Sites.FullControl.All`) entfernen und direkt danach im Leitendenbereich unter „Protokolle“ die Liste öffnen, ein
   Protokoll „TEST – bitte löschen“ anlegen, in der Vorschau ansehen und wieder löschen.
   Klappt etwas nicht, das entfernte Recht wieder hinzufügen und zustimmen; Tokens der Website
   gelten bis zu einer Stunde, also nach einer Änderung kurz warten oder die Functions neu starten.

### Testen

1. Im Leitendenbereich **Protokolle → Neues Protokoll** mit dem Titel „TEST – bitte löschen“ anlegen und in Word öffnen.
2. Zum Review geben und mit einem zweiten Account freigeben, oder direkt selbst freigeben (mit Häkchen).
3. Für einen Versandtest vorübergehend `campflowGroups` auf eine Gruppe mit nur einer Testperson und `campflowLabels` auf `[]` setzen, sonst geht die Mail an alle Leitenden und alle mit dem Label.
4. Die Testdatei danach in SharePoint löschen.

Wird der Versand gestartet, aber nicht bestätigt (z. B. bei einem Timeout), zeigt die Seite „Versand unklar“. Dann im Postfach des Absenders unter „Gesendete Elemente“ nachsehen und nur erneut senden, wenn die Mail dort fehlt.

## Aufgaben aus Protokollen

Die Aufgabenansicht nutzt dieselbe Inhaltsprüfung und KI-Anbindung für einzeln zu prüfende
Aufgabenvorschläge. Ablauf, Grenzen und SQL-Ablage: [Aufgaben](aufgaben.md).

### Entra-Personen für Aufgabenvorschläge

Die Website-App (`5dd5864b-e2c3-4c21-9ef2-8bb3290cd374`) benötigt zusätzlich zu den bestehenden
`Sites.*`- und `Mail.Send`-Rechten die Microsoft-Graph-**Application Permission `GroupMember.Read.All` und `User.Read.All`**
mit Administratorzustimmung. In Entra unter App-Registrierungen → Website-App → API-Berechtigungen
→ Microsoft Graph → Anwendungsberechtigungen hinzufügen und anschließend Admin Consent erteilen.
Es werden ausschließlich aktivierte interne Member-Konten mit Vor-/Nachnamen und Stammes-Login
für die Personenliste übernommen. Eine zusätzliche Gruppen-ID ist bei dieser Variante nicht nötig.

Autocomplete und Erkennung verwenden diese Liste. Der KI werden Anzeigenamen, Vornamen und
kurzlebige Indexnummern mitgegeben, keine Konto-IDs oder Mailadressen aus der Liste. Empfängeradressen
werden erst serverseitig nach Prüfung der Fundstelle aufgelöst. Die Dokumentinhalte selbst können
weiterhin personenbezogene Angaben enthalten. Verarbeitung: Azure OpenAI `website-astro-openai`,
Deployment `gpt-4.1-mini`, Global Standard; die bestehenden Datenschutzhinweise gelten ebenso für
diese zusätzlichen Namen. Die Zuordnung bleibt bis zur menschlichen Annahme ein Vorschlag.
Bei fehlender Berechtigung bleibt die Personenliste nicht verfügbar; manuelle Namen und
Aufgabenvorschläge ohne automatische Zuordnung funktionieren weiter.

Die Website-App (`5dd5864b-e2c3-4c21-9ef2-8bb3290cd374`) benötigt für beide
Microsoft-Graph-Anwendungsberechtigungen Admin Consent. `User.ReadBasic.All` deckt die
Namen und Logins ab, aber nicht `accountEnabled`; es reicht deshalb für unseren Ausschluss
deaktivierter Konten nicht aus. Abgefragt werden ausschließlich Mitglieder der konfigurierten
Leitende-Gruppe, inklusive `accountEnabled` und `userType`. Die OData-Abfrage sendet
`$count=true` und `ConsistencyLevel: eventual` auch bei Fortsetzungsseiten.
Einzelne unvollständige Profile werden übersprungen. Liefert die Abfrage keine nutzbaren
Personen, wird ein Konfigurationsfehler gemeldet; die Oberfläche erlaubt weiterhin manuelle Namen.

Betriebsprüfung: Mit der Website-Identität das Prüfskript `api/scripts/task-directory-check.ts`
ausführen. Es zeigt nur Anzahl und Erfolg, keine Namen, Logins oder Tokens.
Die konfigurierte Verwaltungsidentität besitzt aktuell nur SharePoint-Rechte
(`Sites.Selected`, `Sites.FullControl.All`); die Gruppen- und App-Berechtigungsabfrage
antworteten am 13.10.2026 mit HTTP 403. Das bestätigt keinen Consent der Website-App.

Live-Prüfung am 13.10.2026: Mit der tatsächlichen Website-Identität wurden beide
Anwendungsrechte im Token bestätigt. Der produktive Graph-Leseaufruf mit den ausgewählten
Feldern, Gruppen-Cast und Advanced-Query-Parametern lieferte 22 aktivierte Personenkonten.
Es wurden nur Berechtigungsstatus und Anzahl ausgegeben, keine Namen oder Tokens.

### Versandabschluss und Versionsprüfung

Der Versandabschluss vergleicht unter SQL-Sperre die genaue Reservierung dieses Versuchs. Er aktualisiert nur den Versandzustand und bei Erfolg den Status; zwischenzeitliche Änderungen etwa am Termin bleiben erhalten. Ein anderer oder bereits abgeschlossener Versuch wird abgewiesen. Dafür ist kein weiterer Graph-Aufruf nötig.

Vor Freigaben und anderen Workflow-Schreibzugriffen bleibt dagegen eine frische Prüfung der SharePoint-Inhaltsversion erforderlich: Der zuvor geladene cTag kann während Textextraktion, PDF-Konvertierung oder Modellaufruf veralten. Die SQL-Sperre schützt nicht vor einer parallelen Dateibearbeitung in Word. Ein Ausfall dieser Prüfung verhindert den Schreibzugriff.

Migration 0012 bleibt bewusst in #257. Sobald #257 gemergt und dessen Migrationen angewendet sind, existieren die beiden Protokolltabellen bereits in Produktion; #273 baut auf diesem unveränderten Schema auf.
