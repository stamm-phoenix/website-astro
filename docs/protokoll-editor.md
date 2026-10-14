# Protokoll-Editor

Protokolle der Leitendenrunde werden direkt im Leitendenbereich geschrieben, ohne Word (#277). Der Editor stellt den Inhalt in den Vordergrund, nicht die Formatierung. Eine Person schreibt während der Sitzung mit, ihr Bildschirm läuft auf dem Fernseher und in Teams. Alle anderen Leitenden können das Protokoll auf dem eigenen Gerät live mitlesen.

Dieser erste Schritt umfasst Editor, Speichern, Sperre, Mitlesen und Versionen. PDF, Ablage im SharePoint-Ordner, Review und Versand sowie die Anbindung an Aufgaben und Mitschriften folgen (siehe #277). Der Weg über die Word-Vorlage und die Protokoll-Dateien im SharePoint-Ordner ([Protokolle](protokolle.md)) bleiben daneben unverändert bestehen. Das Anlegen über Word wird erst abgeschaltet, wenn der Editor mit allen Schritten fertig ist (#284).

## Bedienung

- **Anlegen:** Unter `/leitendenbereich/protokolle` legt „Neues Protokoll schreiben“ ein Protokoll mit Titel und Datum an und öffnet es zum Schreiben.
- **Kopfdaten:**
  - Sitzungsleitung (bis zu fünf Personen), vorbelegt mit dem Team „Vorstand“ aus der Leitenden-Liste
  - Protokoll (eine Person), vorbelegt mit der anlegenden Person
  - Beginn und Ende, mit „Jetzt“-Buttons
  - Teilnehmende: Leitende aus der Entra-Gruppe (wie bei den Aufgaben) mit „da“ oder „entsch.“ anklicken, weitere Personen (Altleitende, Gäste) über die Suche eintragen
  - Externe als Freitext (Gruppen und Gäste mit Beschreibung)
- **Namen auswählen (#301):** Jedes Namensfeld (Sitzungsleitung, Protokoll, weitere Anwesende, Zuständige von Aufgaben und Terminen) ist eine Suche wie die Zuständigkeit im Aufgaben-Modul (`ui/PersonSuche.svelte`, auch von `TaskAssigneeField.svelte` genutzt). Die Treffer sind nach „Leitende“, „Altleitende“ und „Weitere“ gruppiert und lassen sich mit Pfeiltasten und Enter wählen; Escape schließt die Liste. Freie Eingabe bleibt möglich: Enter bei geschlossener Liste oder Verlassen des Felds übernimmt den getippten Namen. Eine ausgewählte Person speichert ihr Login, eine frei eingegebene nur den Namen.
- **Weitere Personen:** Altleitende und andere regelmäßig Beteiligte, die nicht in der Entra-Gruppe sind, stehen in der Liste unter `/leitendenbereich/personen` (Name, Gruppe, optional Login, aktiv). Nur aktive Personen werden angeboten; wer auch in der Entra-Gruppe ist, erscheint als Leitende*r. `GET /api/intern/protokoll-editor-personen` liefert beide Quellen; fällt eine aus, meldet es `unavailable` und Namen lassen sich weiter tippen.
- **Tagesordnung:** Vorbelegt wie die frühere Word-Vorlage: Stufenberichte mit Wölflingen, Jungpfadfindern, Pfadfindern, Rovern und StaVos, dann Reflexion, Planung und Sonstiges. Punkte und Unterpunkte (eine Ebene) lassen sich hinzufügen, umbenennen, verschieben und löschen. Hat ein Punkt Inhalt, fragt das Löschen nach.
- **Punkt aus Aktion:** Übernimmt den Namen einer CampFlow-Aktion als Überschrift. Ihr Zeitraum steht darunter („Aktion, 12.–14.06.2026“). Der Punkt merkt sich die CampFlow-ID, damit spätere Schritte (Aufgaben, Projekte) daran anknüpfen können. Aktionen, die vor der Sitzung endeten, sind ausgeblendet, lassen sich aber einblenden.
- **Text (#299):** Markdown nach CommonMark mit den GitHub-Erweiterungen: fett, kursiv, durchgestrichen, Inline-Code, nummerierte, verschachtelte und Checklisten, Links (auch automatisch erkannte Adressen), Tabellen, Zitate, Codeblöcke und Trennlinien. `• ` als Aufzählungszeichen gilt weiter. Überschriften im Text liegen eine Ebene unter der Überschrift des Punkts. Enter am Ende einer Listenzeile setzt Aufzählung, Nummerierung (hochgezählt) oder Checkliste fort, Enter in einem leeren Listenpunkt beendet sie. „Formatierung“ unter dem Textfeld zeigt die Syntax.
  - Sicherheit: `web/src/lib/protokollMarkdown.ts` zerlegt den Text mit `marked` in einen eigenen kleinen Baum, den `ProtokollText.svelte` als Svelte-Elemente rendert, nie als HTML. Rohes HTML (`<script>`, `<img onerror=…>`) bleibt als Text sichtbar, Links nur mit `http`, `https` und `mailto`, Bilder werden zu Links auf das Bild (keine fremden Inhalte).
  - Der Server speichert den Text unverändert; ältere Protokolle sehen gleich aus, weil die frühere Syntax eine Teilmenge ist.
- **Aufgaben:** Je Punkt mit Titel, Zuständigen und Fälligkeit. Vorerst stehen sie nur im Protokoll. Echte Aufgaben daraus entstehen mit der Freigabe in einem späteren Schritt.
- **Termine (#297):** Je Punkt mit „+ Termin“: Titel, Datum, Uhrzeit, Ort und Zuständige (`termine` am Punkt, höchstens `MAX_TERMINE`). Ein Punkt mit Terminen hat Inhalt, Löschen fragt nach. Vorerst stehen sie nur im Protokoll; eine Übernahme in den Kalender ist ein möglicher Folgeschritt.
- **Vorschau (#298):** „Vorschau“ zeigt beim Schreiben das Protokoll so, wie es gelesen wird (`ProtokollAnsicht.svelte`, dieselbe Ansicht wie beim Mitlesen und in der Präsentation): Kopf als abgesetzter Block mit Datum, Uhrzeit und Namenslisten, nummerierte Punkte mit eingerückten Unterpunkten, Aufgaben und Termine als Tabellen (auf dem Handy als Karten), am Ende „Alle Aufgaben“, „Alle Termine“ (nach Datum) und die nächste Leitendenrunde. Die Leseansicht lässt sich ohne Kopf- und Fußzeile der Website drucken.
- **Nächste Leitendenrunde:** Datum, Uhrzeit und Ort als eigene Felder.

## Speichern ohne Datenverlust

1. **Autosave:** Eine Sekunde nach der letzten Eingabe, beim Durchtippen spätestens alle fünf Sekunden, geht das ganze Dokument an `PUT /api/intern/pflege/protokoll-editor/{id}`. Die Leiste zeigt „Gespeichert um …“, „Speichert …“, „Offline – Änderungen sind auf diesem Gerät gesichert“ oder einen Fehler.
2. **Lokale Sicherung:** Jede noch nicht bestätigte Änderung liegt zusätzlich im `localStorage` (`phoenix:protokoll-entwurf:v1:<id>`), mit der Version, auf der sie beruht.
   - Ohne Verbindung versucht der Editor es weiter, mit wachsendem Abstand bis 30 Sekunden.
   - Nach einem Absturz oder Neuladen werden Änderungen, die auf der gespeicherten Version beruhen, automatisch übernommen und gespeichert.
   - Passt die lokale Fassung nicht mehr zur gespeicherten, weil inzwischen jemand anderes gespeichert hat, wird sie beiseitegelegt (`…:geparkt`, höchstens fünf). Die Seite bietet dann „Ansehen“, „Meine Fassung übernehmen“ und „Verwerfen“ an. Beim Übernehmen bleibt die gespeicherte Fassung als Version erhalten.
3. **Versionen:** Beim Speichern legt der Server höchstens alle fünf Minuten eine Version an (`REVISION_MINUTES`). Zusätzlich sichert er die gespeicherte Fassung, bevor jemand die Bearbeitung übernimmt, eine lokale Fassung übernommen wird oder eine ältere Version wiederhergestellt wird. „Versionen“ zeigt sie an. Wer schreibt, kann jede davon wiederherstellen.

Der Server speichert den Text genau so, wie er getippt wurde. Er prüft nur Aufbau, Längen und Steuerzeichen (`validateProtokollInhalt`). Ein gespeichertes Dokument, das diese Prüfung nicht mehr besteht, lässt die Seite scheitern, statt es durch ein leeres zu ersetzen. Spätere Änderungen am Format müssen alte Dokumente deshalb weiter lesen können: Protokolle von vor #297 und #301 ohne `termine` und mit Sitzungsleitung und Protokoll als Text werden beim Lesen ergänzt (ein Text wird zu einer Person ohne Login). Lokale Fassungen im Browser hebt `upgradeInhalt` genauso an.

## Sperre und Mitlesen

- **Eine Person schreibt.** Wer schreibt, hält eine Sperre (`protokoll.sperre`) mit einer zufälligen Kennung des Browser-Tabs.
  - Die Sperre gilt 60 Sekunden (`SPERRE_SECONDS`). Der Tab verlängert sie alle 20 Sekunden und mit jedem Speichern.
  - „Bearbeitung beenden“ und das Schließen eines Tabs ohne offene Änderungen geben sie sofort frei.
  - Ein neu geladener Tab schreibt weiter, weil Kennung und Zustand im `sessionStorage` liegen.
- **Übernehmen:** Ist die Sperre abgelaufen, kann jede Person sofort „Bearbeiten“. Läuft sie noch, fragt „Bearbeitung übernehmen“ vorher nach.
  - Der Server sichert vorher die gespeicherte Fassung.
  - Der bisherige Tab bekommt beim nächsten Speichern `423`. Er wechselt in die Leseansicht und legt seine noch nicht gespeicherten Änderungen beiseite (siehe oben).
  - Ein Speichern nimmt nie eine laufende Sperre weg. Gegen alte Versionen schützt zusätzlich die `rowversion` (`409`).
- **Mitlesen:** Die Leseansicht fragt alle 2,5 Sekunden `GET /api/intern/protokoll-editor/{id}/live?etag=…`, solange der Tab sichtbar ist.
  - Ohne Änderung kommt nur Version und Sperre zurück, sonst das ganze Protokoll.
  - Geänderte Punkte leuchten kurz auf.
  - „Mitlaufen“ scrollt zum Punkt, in dem gerade geschrieben wird. Die Sperre trägt dazu `aktiverPunkt`. Scrollt jemand selbst, endet das Mitlaufen.
  - Echtes Push bräuchte Azure Web PubSub oder SignalR, weil die verwaltete API der Static Web App keine WebSockets kann. Für das Mitlesen reicht das Abfragen.
- **Kein gemeinsames Schreiben:** Gleichzeitiges Bearbeiten durch mehrere Personen ist bewusst nicht vorgesehen.

## Präsentation

„Präsentation öffnen“ gibt es beim Schreiben und beim Lesen. Es öffnet `/leitendenbereich/protokolle/praesentation?id=…` in einem eigenen Fenster. Das Fenster lässt sich auf den Fernseher schieben oder in Teams teilen, ohne dass das Schreiben im Editor stört.

- **Nur das Protokoll:** Es ist groß gesetzt und ruhig. Kopf- und Fußzeile der Website, Eingabefelder und Bedienelemente fehlen (`BaseLayout` mit `bare`).
- **Fenster ohne Leisten:** Ein Popup-Fenster hat keine Tabs, Lesezeichen oder Menüs. Eine schmale Titelleiste mit der Adresse lässt jeder Browser stehen.
- **Sofort aktuell:** Der schreibende Tab im selben Browser schickt jede Änderung über einen `BroadcastChannel` direkt an das Fenster (`praesentationChannel`). Das geht ohne Umweg über den Server und speichert nichts. Beim Öffnen fragt das Fenster den aktuellen Stand ab (`hallo`).
- **Auf anderen Geräten:** Ohne schreibenden Tab im selben Browser fragt das Fenster wie die Leseansicht alle 2,5 Sekunden den Server ab. Kam kurz zuvor ein Stand direkt vom Editor, gewinnt dieser, denn der Server hinkt ihm einen Moment hinterher. Das gilt auch für die erste Antwort beim Öffnen.
- **Scrollen:** Jede Änderung scrollt zum Punkt, an dem gerade geschrieben wird, sonst zum geänderten Punkt. Geänderte Punkte leuchten kurz auf.
- **Auch für Mitlesende:** Muss jemand anderes als der Protokollant den Bildschirm teilen, öffnet diese Person das Fenster selbst. Die Leseansicht der Seite bleibt in normaler Größe zum Durchlesen und zeigt wie das Fenster keine Bearbeitungselemente. Die große Schrift (`ProtokollAnsicht` mit `gross`) gibt es nur im Fenster.
- **Ohne Tab-Kennung:** Das Fenster liest nur und zählt nie als schreibender Tab.

## Rechte

- Alle angemeldeten Leitenden sehen alle Protokolle und dürfen einen Entwurf schreiben.
- Löschen dürfen die anlegende Person und die Reviewer*innen aus `CONFIG.protokolle.reviewers`, und nur Entwürfe.
- Das Löschen entfernt auch alle Versionen.

Autosave und Verlängern der Sperre werden nicht protokolliert (`pflegeHandler` mit `quiet`). Protokolliert werden Anlegen, Übernehmen, Überschreiben mit einer lokalen Fassung, Wiederherstellen und Löschen, immer nur mit ID, nie mit Inhalt.

## Daten

Schema `protokoll` (`api/migrations/0016_protokoll_editor.sql`):

| Tabelle     | Inhalt                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `protokoll` | Titel, Datum, Status (vorerst nur `entwurf`), Inhalt als JSON (`ProtokollInhalt`).                                                      |
| `sperre`    | Wer gerade schreibt: Login, Name, Tab-Kennung, Ablauf und aktiver Punkt. Eigene Tabelle, damit das Verlängern die Version nicht ändert. |
| `revision`  | Gesicherte Fassungen mit Grund (`speichern`, `uebernahme`, `ueberschreiben`, `wiederherstellen`).                                       |

Die weiteren Personen liegen in `organisation.person` (`api/migrations/0017_weitere_personen.sql`, `api/lib/weitere-personen.ts`, Pflege unter `/api/intern/pflege/personen`), damit auch andere Module sie nutzen können.

Code: `api/lib/protokoll-editor*.ts`, `api/endpoints/intern-protokoll-editor.ts`, `web/src/components/protokolle/`, `web/src/lib/protokollEditor.ts`. Die Typen stehen in `api/lib/protokoll-editor-model.ts`, das auch das Frontend nutzt. Die Previews bekommen ein erfundenes Protokoll (`seedPreviewProtokollEditor`) und erfundene weitere Personen (`seedPreviewWeiterePersonen`).
