# Mitschriften

Im Modul **Mitschriften** im Leitendenbereich (`/leitendenbereich/mitschriften`) werden Meetings wie die Leitendenrunde transkribiert. Aus dem Transkript schreibt Azure OpenAI Notizen. Es gibt zwei Wege:

1. **Live** während des Meetings, auch wenn Externe über Teams zugeschaltet sind.
2. **Nachträglich** aus einer hochgeladenen Audiodatei.

Vor dem Anlegen bestätigt die Person eine Pflicht-Checkbox: „Alle Anwesenden wurden informiert und sind einverstanden“. Externe im Teams-Call informiert sie selbst, weil Teams ihnen bei unserem Tool keinen Hinweis zeigt.

**Rechte:** Alle angemeldeten Leitenden sehen alle Mitschriften. Sie dürfen sie anlegen, bearbeiten, Abschnitte löschen und aufräumen. Transkribiert wird nur, was alle aus der Leitendenrunde mitbekommen dürfen.

## Grundsatz: Audio ist nicht nachträglich anhörbar

- **Kein Abspielen, kein Download.** Audio ist nie abrufbar, weder in der Oberfläche noch über die API.
- **Server:** Eine hochgeladene Datei liegt nur, solange ihr Transkriptionsauftrag läuft, im Blob Storage. Danach werden Blob und Auftrag bei Azure Speech sofort gelöscht, der Blob endgültig (siehe [Azure](#azure)).
- **Lokal:** Nur auf dem Gerät der aufnehmenden Person und nur verschlüsselt. Dort liegen nur Stücke, die noch nicht transkribiert sind (siehe [Ausfallsicherheit](#ausfallsicherheit)).
- Ist ein Abschnitt transkribiert und gespeichert, ist sein Audio weg, lokal wie auf dem Server. Wird ein transkribierter Abschnitt danach gelöscht, ist er ganz verschwunden.

## Live-Modus

- Das Audio geht per WebSocket direkt vom Browser zu Azure Speech (`microsoft-cognitiveservices-speech-sdk`, `ConversationTranscriber` mit Sprechertrennung), nicht durch die Functions. `GET /api/intern/mitschriften-token` gibt ein Token für zehn Minuten aus; der Browser erneuert es alle acht Minuten. Der Schlüssel bleibt in der API.
- **Zwei Quellen** mit je eigenem Transkriber:
  - **Mikrofon** (Konferenzlautsprecher in der Tischmitte), Sprecher „Raum – Sprecher n“
  - **Ton des Teams-Tabs** über `getDisplayMedia` mit „Tab-Audio teilen“, Sprecher „Teams – Sprecher n“

  Das ist nötig, weil die Echounterdrückung des Konferenzlautsprechers die Externen aus dem Mikrofon filtert. Tab-Audio gibt es in Chrome, Edge und Chromium, auch unter Linux. Firefox teilt keinen Tab-Ton; die Seite weist darauf hin.

- Jeder fertige Satz geht sofort an `POST …/mitschriften/{id}/abschnitte` und wird gespeichert. Jeder Satz trägt eine `clientId`, damit ein wiederholtes Senden nichts doppelt.
- **Sprache:** nur Deutsch (`CONFIG.mitschriften.locale`). Die Phrasenliste in `CONFIG.mitschriften.phrases` hilft bei Fachbegriffen und Lehnwörtern.
- **Satzende:** Azure beendet einen Satz nach einer Sprechpause. Der Standard (etwa eine halbe Sekunde) schneidet Sätze an jeder Denkpause. `CONFIG.mitschriften.segmentationSilenceMs` (1000 ms) hält sie zusammen und trennt die Sprecher trotzdem; die Werte sind mit deutscher Sprache verglichen. Die KI-basierte Segmentierung („Semantic“) schnitt auf Deutsch öfter mitten im Satz.
- **Pause:** Während der Pause geht kein Audio an Azure und nichts in den lokalen Zwischenspeicher.
- **Laufende Notizen:** Alle 2,5 Minuten erzeugt gpt-5.4-mini Notizen aus dem bisherigen Transkript (`save: false`). Sie werden nur auf dem aufnehmenden Rechner angezeigt. Beim Beenden folgt ein gründlicherer Durchlauf mit `reasoning_effort: low`, der gespeichert wird.
- **Sprecher:** Die Sprechertrennung zählt in jedem Erkennungslauf neu, etwa nach einer Pause oder einem Abbruch. Ein Sprecher gehört deshalb zu einem Lauf (`key` wie `l3:Guest-1`). Sprecher lassen sich umbenennen oder zusammenlegen. Es gibt keine Stimmprofile; Namen gelten nur in ihrer Mitschrift.
- Die Wake-Lock-API verhindert, dass sich der Bildschirm sperrt und das Mikrofon stoppt.

Code: `web/src/lib/mitschriftRecorder.svelte.ts`, `web/src/components/mitschriften/MitschriftLive.svelte`.

## Ausfallsicherheit

Ein Ausfall von WLAN oder Azure, ein Absturz des Tabs oder ein Neustart des Browsers soll keinen Teil des Meetings kosten.

1. **Lokaler, verschlüsselter Zwischenspeicher** (`web/src/lib/mitschriftAudioCache.ts`):
   - Jede Quelle wird zusätzlich in Stücken von zehn Sekunden aufgenommen (`MediaRecorder`, Opus). Jedes Stück ist eine eigene Datei und wird in IndexedDB der Website gespeichert.
   - Jedes Stück ist mit AES-GCM verschlüsselt. Der Schlüssel ist ein nicht exportierbarer WebCrypto-Schlüssel (`extractable: false`), der nur in diesem Browserprofil existiert.
2. **Nur Untranskribiertes bleibt liegen:** Jedes Stück kennt seinen Zeitbereich. Es wird gelöscht, wenn alle drei Bedingungen erfüllt sind:
   - Die Erkennung lief ohne Unterbrechung.
   - Sie hat keinen offenen Satz aus der Zeit vor seinem Ende.
   - Alle Sätze, die darin beginnen, sind gespeichert.

   Im Normalbetrieb liegen also nur die letzten 15 bis 25 Sekunden lokal.

3. **Bei einem Ausfall** läuft die Aufnahme lokal weiter. Die Seite zeigt „Verbindung unterbrochen – Aufnahme wird lokal gesichert“. Steht die Verbindung wieder, geht die Live-Transkription weiter. Die Lücke wird aus den lokalen Stücken als WAV-Datei zusammengesetzt (`web/src/lib/mitschriftWav.ts`) und über den Upload-Weg nachtranskribiert. Das Ergebnis ersetzt, was die Live-Erkennung in diesem Zeitbereich dieser Quelle gespeichert hatte. Ist der Auftrag fertig, werden die lokalen Stücke gelöscht.
4. **Nach einem Absturz oder Neustart** fragt das Modul beim nächsten Öffnen im selben Browser: „Es gibt noch nicht transkribierte Teile der Mitschrift X – jetzt transkribieren?“. Möglich sind nur „Transkribieren“ oder „Verwerfen“. Die Stücke gehören der angemeldeten Person; anderen wird nichts angeboten.
5. **Ablauf:** Nicht transkribierte Stücke werden nach sieben Tagen beim nächsten Öffnen des Moduls verworfen.

_Grenze:_ Wer am eigenen Rechner die Seite mit den Entwicklerwerkzeugen manipuliert, kommt theoretisch an die Stücke, solange sie existieren. Das betrifft nur die aufnehmende Person, ihr eigenes Gerät und nur noch nicht transkribierte Teile.

## Upload-Modus

- Formate: MP3, M4A, WAV, OGG, WebM, FLAC, AAC, MP4 (auch Teams-Aufzeichnungen), bis 1000 MB.
- `POST …/mitschriften/{id}/auftraege` legt einen Auftrag an und gibt eine **Upload-SAS** aus. Sie erlaubt nur Anlegen und Schreiben, kein Lesen und kein Auflisten, und gilt zwei Stunden. Signiert wird mit einem User-Delegation-Key der App-Registrierung, weil die Accounts keine Shared Keys erlauben. Der Browser lädt die Datei direkt in den Blob Storage hoch, nicht durch die Function.
- `POST …/auftraege/{auftragId}` startet die Batch Transcription mit Sprechertrennung. Nur dieser Auftrag bekommt eine kurzlebige Lese-SAS.
- Die Seite fragt alle zehn Sekunden `POST …/mitschriften/{id}/pruefen`. Ist der Auftrag fertig, speichert die API das Transkript. Gleich danach löscht sie den Auftrag bei Azure Speech (DELETE) und den Blob endgültig. Anschließend erzeugt die Seite die Notizen.
- **Bei Fehlern** wird der Blob ebenfalls gelöscht; die Fehlermeldung bleibt sichtbar, bis jemand sie ausblendet. Aufträge, die nach `CONFIG.mitschriften.maxJobHours` (24 h) nicht fertig sind, entfernt `cleanupStaleAuftraege()` samt Blob. Das passiert beim nächsten Öffnen des Moduls, weil die verwaltete API der Static Web App keinen Timer-Trigger kennt. Als Sicherheitsnetz löscht die Lifecycle-Regel des Produktions-Accounts Blobs unter `website/mitschriften/` nach einem Tag (die Preview-Container verschwinden ohnehin mit dem PR); solche Blobs landen allerdings im Soft Delete (7 Tage), weil die Regel nicht endgültig löschen kann. Azure Speech löscht fertige Aufträge selbst nach `maxJobHours` (`timeToLiveHours`), damit ein Ergebnis wartet, bis die Seite wieder geöffnet wird.
- Derselbe Weg dient für die Lücken der Live-Aufnahme (`source` `raum` oder `teams` mit `offsetMs` und `untilMs`).

## Bearbeiten

- Bearbeitbar sind Transkript (Text, Sprecher eines Satzes, Sprechernamen, Zusammenlegen) und Notizen. Gleichzeitige Änderungen erkennt die `rowversion` (`etag`, `VersionConflictError` → 409).
- **Keine Versionshistorie:** Änderungen überschreiben den alten Text.
- Wird das Transkript geändert, zeigt das Modul „Notizen sind nicht mehr aktuell“ (`notes_stale`) und bietet „Notizen neu erzeugen“ an. Von Hand geänderte Notizen (`notes_edited`) überschreibt die KI nur nach Rückfrage (`overwrite: true`, sonst `409 NOTES_EDITED`).
- Während die Aufnahme läuft, lassen sich die Notizen nicht bearbeiten.
- **Abschnitte löschen** (`POST …/abschnitte-loeschen`) löscht die Sätze hart. In derselben Transaktion verschwinden die Notizen, damit nichts davon in einer Zusammenfassung überlebt; danach erzeugt die Seite sie neu. Waren die Notizen von Hand geändert, weist die Rückfrage darauf hin.

Transkript und Notizen landen nie in Logs. Die API protokolliert nur IDs und Aktionen (`pflegeHandler`); Fehler von Azure Speech und Azure OpenAI enthalten nur den HTTP-Status.

## Notizen

Feste Struktur (Structured Outputs, `api/lib/mitschriften-notizen.ts`):

- **Beschlüsse**
- **To-dos** mit Verantwortlichen und, falls genannt, Frist
- **Offene Punkte**
- **Nächster Termin**

Modell: `CONFIG.mitschriften.notes`, gpt-5.4-mini auf `website-astro-openai` (Deployment-Typ Data Zone Standard, also Verarbeitung in der EU). Es gilt derselbe Schlüssel `AZURE_OPENAI_API_KEY` wie bei der Belegprüfung.

## Aufbewahrung

Dauerhaft gespeichert werden nur Transkript und Notizen. Es gibt keine automatische Löschung. Das Modul warnt, sobald Mitschriften mit einem Meeting vor mehr als `CONFIG.mitschriften.warnAfterMonths` (12) Monaten existieren. Dazu gibt es den Button „Alte Mitschriften aufräumen“, der sie nach einer Rückfrage endgültig löscht.

_Grenzen_ (so auf `/datenschutz#mitschriften` beschrieben):

- Die Point-in-time-Backups von Azure SQL enthalten gelöschte Daten noch sieben Tage.
- Azure OpenAI kann Eingaben zur Missbrauchserkennung bis zu 30 Tage vorhalten.

## Daten

Schema `mitschrift` (`api/migrations/0005_mitschriften.sql`):

| Tabelle      | Inhalt                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `mitschrift` | Titel, Datum, Status (`live`, `datei`, `fertig`), Notizen als JSON und ihre Flags.             |
| `sprecher`   | Eine Stimme pro Quelle und Erkennungslauf, mit laufender Nummer und optionalem Namen.          |
| `abschnitt`  | Ein Satz: Quelle, Sprecher, Start und Ende in ms ab Aufnahmebeginn, Text, `client_id` (live).  |
| `auftrag`    | Ein Batch-Auftrag mit Blob-Name und ID bei Azure Speech; existiert nur, solange es Audio gibt. |

Code: `api/lib/mitschriften*.ts`, `api/endpoints/intern-mitschriften.ts`, `web/src/components/mitschriften/`. Die Typen stehen in `api/lib/mitschriften-model.ts`, das auch das Frontend nutzt.

## Azure

| Was                 | Wert                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speech-Ressource    | `website-astro-speech` (SpeechServices S0, `germanywestcentral`, Custom Subdomain), Audio-Logging aus                                                                                                                                                                                                                                                                                                                                  |
| Endpoint und Region | `CONFIG.mitschriften.speech`                                                                                                                                                                                                                                                                                                                                                                                                           |
| Schlüssel           | App Setting `AZURE_SPEECH_KEY` der Static Web App (Key 1 der Ressource)                                                                                                                                                                                                                                                                                                                                                                |
| Storage CORS        | `PUT`/`OPTIONS` von `https://www.stamm-phoenix.de` und `https://stamm-phoenix.de`; im Preview-Account von `*` (wechselnde Hosts)                                                                                                                                                                                                                                                                                                       |
| Lifecycle-Regel     | `mitschriften-audio` im Produktions-Account: Blobs unter `website/mitschriften/` nach einem Tag löschen. Ohne Blob-Tags, weil die App-Registrierung keine Tags schreiben darf                                                                                                                                                                                                                                                          |
| Endgültiges Löschen | `allowPermanentDelete` am Produktions-Account (Soft Delete bleibt für die Blogbilder); eigene Rolle „Storage Blob Permanent Delete“ für die App-Registrierung auf beiden Accounts. Azure löscht endgültig nur Snapshots, nicht den Blob selbst: `deleteBlobPermanently()` überschreibt den Blob deshalb erst mit nichts (Soft Delete legt den alten Inhalt als Snapshot ab), löscht diesen Snapshot endgültig und dann den leeren Blob |
| CSP                 | `connect-src` mit `wss://germanywestcentral.stt.speech.microsoft.com` und den Blob-Endpoints (`web/public/staticwebapp.config.json`)                                                                                                                                                                                                                                                                                                   |

Ein Budget mit Kostenwarnung ist nicht eingerichtet; die Kosten werden im Cost Management beobachtet. Es gibt kein Tageslimit im Code.

## Previews

In den PR-Previews wird echt transkribiert, mit derselben Speech- und OpenAI-Ressource. Transkripte und Notizen liegen in der Preview-Datenbank `website-pr-<n>`, Uploads im Container `pr-<n>` des Preview-Storage-Accounts. Beides verschwindet, wenn der PR geschlossen wird. Aufträge bei Azure Speech tragen den Namen der Preview-Datenbank im `displayName` und löschen sich spätestens nach `maxJobHours` selbst.

`seedPreviewMitschriften()` in `api/lib/db-preview.ts` legt eine erfundene, fertige Leitendenrunde mit Transkript und Notizen an. Im Dev-Server liefert `web/dev/mock-data/mitschriften.ts` erfundene Mitschriften. Die Live-Aufnahme braucht dort echtes Azure Speech und ist im Mock nicht verfügbar.
