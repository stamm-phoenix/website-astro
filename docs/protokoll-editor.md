# Protokoll-Editor

Protokolle der Leitendenrunde werden direkt im Leitendenbereich geschrieben, ohne Word (#277). Der Editor stellt den Inhalt in den Vordergrund, nicht die Formatierung. Eine Person schreibt während der Sitzung mit, ihr Bildschirm läuft auf dem Fernseher und in Teams. Alle anderen Leitenden können das Protokoll auf dem eigenen Gerät live mitlesen.

Schritt 1 umfasst Editor, Speichern, Sperre, Mitlesen und Versionen, Schritt 2 das PDF, die Ablage im SharePoint-Ordner, Review und Versand ([unten](#review-freigabe-und-versand)), Schritt 3 die Anbindung an das Modul Aufgaben ([unten](#aufgaben-und-projekte)). Der Weg über die Word-Vorlage und die Protokoll-Dateien im SharePoint-Ordner ([Protokolle](protokolle.md)) bleiben daneben unverändert bestehen. Das Anlegen über Word wird erst abgeschaltet, wenn der Editor mit allen Schritten fertig ist (#284).

## Bedienung

- **Anlegen:** Unter `/leitendenbereich/protokolle` legt „Neues Protokoll schreiben“ ein Protokoll mit Titel und Datum an und öffnet es zum Schreiben. „Sitzungsbeginn auf jetzt setzen“ ist vorausgewählt und trägt die Uhrzeit des Browsers als Beginn ein (der Server läuft in UTC); ohne Häkchen bleibt der Beginn leer.
- **Kopfdaten:**
  - Sitzungsleitung (bis zu fünf Personen), vorbelegt mit dem Team „Vorstand“ aus der Leitenden-Liste
  - Protokoll (eine Person), vorbelegt mit der anlegenden Person
  - Beginn und Ende, mit „Jetzt“-Buttons. Ist beim Tippen auf „Bearbeitung beenden“ noch kein Ende eingetragen, fragt der Editor, ob die Sitzung jetzt endet: „Ja, Ende auf jetzt setzen“ trägt die Uhrzeit ein und beendet, „Nein, Ende leer lassen“ beendet ohne Ende, „Weiter bearbeiten“ (oder Schließen) bleibt im Editor.
  - Anwesenheit mit eckigen Schaltern „da“ und „entsch.“ mit Häkchen, wie die Anwesenheit der Gruppenstunden; Namen erscheinen ohne runde Pillen.
  - Teilnehmende: Leitende aus der Entra-Gruppe (wie bei den Aufgaben) mit „da“ oder „entsch.“ anklicken, weitere Personen (Altleitende, Gäste) über die Suche eintragen
  - Externe als Freitext (Gruppen und Gäste mit Beschreibung)
- **Namen auswählen (#301):** Jedes Namensfeld (Sitzungsleitung, Protokoll, weitere Anwesende, Zuständige von Aufgaben und Terminen) ist eine Suche wie die Zuständigkeit im Aufgaben-Modul (`ui/PersonSuche.svelte`, auch von `TaskAssigneeField.svelte` genutzt). Die Treffer sind nach „Leitende“, „Altleitende“ und „Weitere“ gruppiert und lassen sich mit Pfeiltasten und Enter wählen; Escape schließt die Liste. Freie Eingabe bleibt möglich: Enter bei geschlossener Liste oder Verlassen des Felds übernimmt den getippten Namen. Eine ausgewählte Person speichert ihr Login, eine frei eingegebene nur den Namen.
- **Weitere Personen:** Altleitende und andere regelmäßig Beteiligte, die nicht in der Entra-Gruppe sind, stehen in der Liste unter `/leitendenbereich/personen` (Name, Gruppe, optional Login, aktiv). Nur aktive Personen werden angeboten; wer auch in der Entra-Gruppe ist, erscheint als Leitende\*r. `GET /api/intern/protokoll-editor-personen` liefert beide Quellen; fällt eine aus, meldet es `unavailable` und Namen lassen sich weiter tippen.
- **Tagesordnung:** Vorbelegt wie die frühere Word-Vorlage: Stufenberichte mit Wölflingen, Jungpfadfindern, Pfadfindern, Rovern und StaVos, dann Reflexion, Planung und Sonstiges. Punkte und Unterpunkte (eine Ebene) lassen sich hinzufügen, umbenennen, verschieben und löschen. Hat ein Punkt Inhalt, fragt das Löschen nach.
- **Verschieben per Ziehen:** Jeder Punkt hat links in seiner Titelzeile einen Griff ⠿ (`ProtokollTagesordnung.svelte`, Logik in `lib/protokollReihenfolge.ts`). Wer ihn mit Maus oder Finger zieht, verschiebt den Punkt direkt im Editor. Sobald sich der Zeiger bewegt, klappen alle Punkte auf ihre Titelzeile zusammen; der gegriffene bleibt unter dem Zeiger, nach dem Loslassen ist alles wieder offen. Nach rechts gezogen wird ein Punkt Unterpunkt des Punkts darüber, nach links Hauptpunkt. Eine Linie mit Beschriftung („als Unterpunkt von 1. Stufenberichte“) zeigt das Ziel, am Fensterrand scrollt die Seite mit, höchstens bis zum Seitenende. Ein Hauptpunkt nimmt seine Unterpunkte mit und kann selbst kein Unterpunkt werden; zwischen Unterpunkten passt nur ein Unterpunkt. Ein Klick auf den Griff ohne Bewegung ändert nichts, Escape bricht ab. Auf dem Griff verschieben die Pfeiltasten (hoch, runter, rechts zum Unterpunkt, links zum Hauptpunkt; ein neuer Hauptpunkt steht danach direkt hinter seinem bisherigen Hauptpunkt). Die Pfeil-Buttons je Punkt bleiben. Text, Aufgaben und Termine bleiben am Punkt, gespeichert wird wie sonst automatisch.
- **Punkt aus Aktion:** Übernimmt den Namen einer CampFlow-Aktion als Überschrift. Ihr Zeitraum steht darunter („Aktion, 12.–14.06.2026“). Der Punkt merkt sich die CampFlow-ID, damit spätere Schritte (Aufgaben, Projekte) daran anknüpfen können. Aktionen, die vor der Sitzung endeten, sind ausgeblendet, lassen sich aber einblenden.
- **Text (#299):** Markdown nach CommonMark mit den GitHub-Erweiterungen: fett, kursiv, durchgestrichen, Inline-Code, nummerierte, verschachtelte und Checklisten, Links (auch automatisch erkannte Adressen), Tabellen, Zitate, Codeblöcke und Trennlinien. `• ` als Aufzählungszeichen gilt weiter. Überschriften im Text liegen eine Ebene unter der Überschrift des Punkts. Enter am Ende einer Listenzeile setzt Aufzählung, Nummerierung (hochgezählt) oder Checkliste fort, Enter in einem leeren Listenpunkt beendet sie. „Formatierung“ unter dem Textfeld zeigt die Syntax.
  - **Formatiert schreiben (#320, #277):** Neben der Überschrift „Tagesordnung“ steht „Texte schreiben als: Formatiert / Markdown“ (bewusst nicht in der festen Leiste, die auf dem Handy sonst noch mehr Inhalt verdeckt). „Formatiert“ ist die Voreinstellung und zeigt die ganze Tagesordnung als **ein Dokument** (`ProtokollDokument.svelte`, Tiptap): Jeder Punkt ist ein Block mit Titelzeile (Griff, Nummer, Titel, Pfeile, Löschen, darunter die Aktion), Text, Aufgaben und Terminen; Unterpunkte sind eingerückte Blöcke im Punkt. Eine Werkzeugleiste über dem Dokument bleibt beim Scrollen unter der festen Leiste stehen (Fett, Kursiv, Durchgestrichen, Code, zwei Überschriften, Aufzählung, Nummerierung, Checkliste, Link, Tabelle mit Zeilen- und Spaltenwerkzeugen, Zitat, Codeblock, Trennlinie, Rückgängig, Wiederholen; Tastaturkürzel wie Strg+B und Strg+K). Die Tastatur verhält sich wie in einem Dokument: Enter im Titel springt in den Text, Enter in einer leeren letzten Zeile legt den nächsten Punkt an (bei einem Unterpunkt den nächsten Unterpunkt), Backspace in einem leeren Punkt entfernt ihn und springt zum Punkt davor (ein Punkt aus einer Aktion gilt nicht als leer), Backspace am Anfang des Texts springt in den Titel (beginnt der Text mit einer Liste, einem Zitat oder einem Codeblock, löst das erste Backspace wie in jedem Editor zuerst die Formatierung, das nächste springt in den Titel; Titel und Text werden nie zusammengezogen). Eine Markierung über mehrere Punkte löscht nichts, weil damit ein Punkt verschwände; Punkte gehen nur über den Papierkorb (mit Nachfrage, wenn sie Inhalt haben), Backspace im leeren Punkt oder Rückgängig (Rückgängig und Wiederholen dürfen immer). Der letzte Punkt wird nicht entfernt, sondern geleert. Kopierte Punkte nehmen Aktion, Aufgaben und Termine mit und bekommen beim Einfügen neue IDs. Ein Text über 20.000 Zeichen bekommt unter seiner Titelzeile den Hinweis, dass er so nicht gespeichert wird. Griff, Pfeiltasten und Pfeil-Buttons verschieben wie bisher.
    - Gespeichert wird unverändert `ProtokollInhalt`: `lib/protokollDokument.ts` baut aus den Punkten das Dokument (Knoten `punkt`, `unterpunkt`, `punktTitel` mit der Aktion, `punktText` mit dem Markdown als Blöcke, `punktExtras` mit Aufgaben und Terminen) und schreibt es bei jeder Eingabe zurück; der Text eines Punkts, den niemand angefasst hat, bleibt dabei Zeichen für Zeichen wie gespeichert. Leseansicht, PDF, Mitlesen, Präsentation, Versionen, Review und Versand ändern sich nicht, und alte Protokolle brauchen keine Migration. Änderungen von außen (Punkt aus Aktion, Wiederherstellen einer Version, Verschieben) landen im Dokument, unveränderte Punkte behalten dabei ihre Knoten. `aktiverPunkt` folgt dem Cursor.
    - Der Editor liest den Text mit denselben marked-Optionen wie `ProtokollText.svelte` und schreibt Markdown zurück (`• ` wird dabei zu `- `; `<`, `>` und `&` bleiben wie getippt, und als Text getipptes HTML wie `<b>x</b>` bleibt auch im Editor Text, wie in der Ansicht). Er wird erst geladen, wenn „Formatiert“ gewählt ist (schlägt das fehl, etwa ohne Verbindung oder weil die Seite seit einem Deploy veraltet ist und der Chunk 404 gibt, sagt eine Meldung, dass der Text unverändert ist, rät zum Neuladen und zeigt die Markdown-Felder zum Weiterschreiben); die Wahl wird pro Person auf dem Server gespeichert (`organisation.staff_settings`, `GET`/`PUT /api/intern/einstellungen`, `lib/staffSettingsStore.svelte.ts`) und gilt auf jedem Gerät; schlägt das Speichern fehl, gilt sie für die offene Seite und ein Hinweis sagt das.
    - „Markdown“ zeigt wie zuvor je Punkt Titelfeld, Markdown-Textfeld mit Syntax-Hilfe, Aufgaben und Termine (`ProtokollPunktEditor.svelte`, die Aufgaben und Termine in `ProtokollPunktExtras.svelte`, das auch das Dokument nutzt).
  - Sicherheit: `marked` zerlegt den Text, `api/lib/protokoll-markdown.ts` macht daraus einen eigenen kleinen Baum. `ProtokollText.svelte` rendert ihn als Svelte-Elemente, das PDF (`protokoll-editor-pdf.ts`) als pdfmake-Blöcke, beide nie als HTML. Seite und PDF zeigen deshalb dasselbe. Rohes HTML (`<script>`, `<img onerror=…>`) bleibt als Text sichtbar, Links nur mit `http`, `https` und `mailto`, Bilder werden zu Links auf das Bild (keine fremden Inhalte).
  - Der Server speichert den Text unverändert; ältere Protokolle sehen gleich aus, weil die frühere Syntax eine Teilmenge ist.
- **Aufgaben:** Je Punkt mit Titel, Zuständigen und Fälligkeit. Bei der Freigabe werden sie zu Aufgaben im Modul Aufgaben ([unten](#aufgaben-und-projekte)); bis dahin stehen sie nur im Protokoll.
- **Projekt und offene Aufgaben:** Ein Punkt lässt sich mit einem Projekt des Moduls Aufgaben verknüpfen. Er zeigt dann dessen offene Aufgaben zum Abhaken, und seine Aufgaben landen bei der Freigabe in diesem Projekt. Neue Protokolle beginnen mit dem Punkt „Offene Aufgaben“ ([unten](#aufgaben-und-projekte)).
- **Termine (#297):** Je Punkt mit „+ Termin“: Titel, Datum, Uhrzeit, Ort und Zuständige (`termine` am Punkt, höchstens `MAX_TERMINE`). Ein Punkt mit Terminen hat Inhalt, Löschen fragt nach. Vorerst stehen sie nur im Protokoll; eine Übernahme in den Kalender ist ein möglicher Folgeschritt.
- **Leseansicht (#298):** „Leseansicht“ zeigt beim Schreiben das Protokoll so, wie es gelesen wird (`ProtokollAnsicht.svelte`, dieselbe Ansicht wie beim Mitlesen und in der Präsentation): Kopf als abgesetzter Block mit Datum, Uhrzeit und Namenslisten, nummerierte Punkte mit eingerückten Unterpunkten, Aufgaben und Termine als Tabellen (auf dem Handy als Karten), am Ende „Alle Aufgaben“, „Alle Termine“ (nach Datum) und die nächste Leitendenrunde. Die Leseansicht lässt sich ohne Kopf- und Fußzeile der Website drucken.
- **Nächste Leitendenrunde:** Datum, Uhrzeit und Ort als eigene Felder.

## Aufgaben und Projekte

Schritt 3 von #277 verbindet die Protokolle mit dem Modul Aufgaben ([Aufgaben](aufgaben.md)). Code: `api/lib/protokoll-editor-aufgaben.ts`, im Browser `ProtokollPunktProjekt.svelte` und `lib/protokollAufgabenStore.svelte.ts`; die gemeinsamen Regeln (welche Aufgaben ein Punkt zeigt, welche Einträge zu Aufgaben werden) stehen in `protokoll-editor-model.ts`.

- **Aufgaben bei der Freigabe:** Jeder Aufgaben-Eintrag mit Titel wird in derselben Transaktion wie die Freigabe eine offene Aufgabe: Titel, Zuständige (eine Person ohne Login bleibt ein Name), Fälligkeit und das Projekt des Punkts. Ein Unterpunkt ohne eigenes Projekt gehört zum Projekt seines Punkts; ein inzwischen gelöschtes Projekt wird weggelassen. Ein Titel über 200 Zeichen wird gekürzt und steht vollständig in der Beschreibung. Die Aufgabe merkt sich Protokoll, Eintrag und Punkt („3. Planung“); die Aufgaben-Karte verlinkt das Protokoll. Ein Eintrag wird höchstens einmal zur Aufgabe. Dialog und Meldung der Freigabe nennen die Anzahl; der Block „Review und Versand“ nennt danach, wie viele Aufgaben aus dem Protokoll im Modul stehen. Diese Aufgaben dürfen wie selbst angelegte gelöscht werden.
- **Punkt „Offene Aufgaben“:** Ein neues Protokoll beginnt mit diesem Punkt, wenn es offene Aufgaben aus früheren Protokollen gibt (aus dem Editor freigegeben oder als Vorschlag aus einer Word-Datei angenommen), nach Fälligkeit sortiert, höchstens `MAX_OFFENE_AUFGABEN`. Ohne solche Aufgaben beginnt es wie bisher mit den Stufenberichten.
- **Projekt am Punkt:** „Projekt verknüpfen“ wählt ein Projekt; der Punkt zeigt dann dessen offene Aufgaben. „Projekt ändern“ und „Projekt lösen“ stehen daneben. Bei einem Punkt aus einer Aktion schlägt der Editor das Projekt mit derselben CampFlow-ID vor („Mit Projekt … verknüpfen“) oder legt eines für die Aktion an („Projekt für die Aktion anlegen“, über `POST /api/intern/pflege/aufgaben/projekte`).
- **Abhaken:** Das Kästchen einer offenen Aufgabe erledigt die Aufgabe sofort im Modul Aufgaben (`PUT /api/intern/pflege/protokoll-editor-aufgaben/{id}` mit `{ erledigt }`), erneutes Tippen öffnet sie wieder. Der Punkt sagt das („Häkchen werden sofort im Modul Aufgaben gespeichert.“) und zeigt den Stand in Worten. Steht dieselbe Aufgabe in mehreren Punkten, folgen die anderen. „Offene Aufgaben neu laden“ ergänzt inzwischen hinzugekommene Aufgaben; abgehakte bleiben stehen.
- **Im Protokoll:** Die offenen Aufgaben sind eine Kopie (`offeneAufgaben` am Punkt, mit `erledigt`), damit Leseansicht, Mitlesen, Präsentation und PDF zeigen, was in der Sitzung besprochen und erledigt wurde. Das Projekt (`projekt` mit ID und Name) steht unter dem Titel des Punkts. Protokolle von vor Schritt 3 werden ohne beides gelesen.
- **Daten für den Editor:** `GET /api/intern/protokoll-editor-aufgaben` liefert die Projekte und alle offenen Aufgaben mit Projekt und Herkunft. Der Editor lädt sie beim Öffnen; fehlen sie, lässt sich weiter schreiben, nur ohne Projektwahl.
- **KI-Erkennung:** Für Protokolle aus dem Editor nicht nötig; sie bleibt für Word-Protokolle wie bisher.

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

## Review, Freigabe und Versand

Der Ablauf ist derselbe wie bei den Word-Protokollen ([Protokolle](protokolle.md)): Entwurf → (Review →) Freigegeben → Verschickt. Das Review ist freiwillig: Wer ein zweites Paar Augen möchte, gibt das Protokoll zum Review, wer sich sicher ist, gibt den Entwurf direkt frei. Der Status liegt am Protokoll in Azure SQL. Die Seite des Protokolls zeigt ihn im Block „Review und Versand“.

1. **Zum Review geben:** Die schreibende Person (oder, solange niemand schreibt, jede Person) gibt das Protokoll zum Review. Der Editor speichert vorher, was noch fehlt. Der Server gibt die Sperre frei; ab jetzt schreibt niemand mehr. Ein anderer Tab, der noch schreiben wollte, bekommt `409 NOT_EDITABLE` und behält seine lokalen Änderungen. Solange jemand anderes die Sperre hält, lehnt der Server mit `423` ab.
2. **Zurückgeben:** Alle Leitenden können das Protokoll im Review mit einem Hinweis zurückgeben. Es ist wieder ein Entwurf, der Hinweis steht über dem Protokoll und geht per Mail an die anlegende Person.
3. **Freigeben:** Alle Leitenden, aus dem Review oder direkt aus dem Entwurf. Einen Entwurf gibt wie beim Review nur die schreibende Person frei (oder jede, solange niemand schreibt; sonst `423`); der Editor speichert vorher, und der Server gibt die Sperre frei. Das eigene Protokoll freizugeben braucht ein ausdrückliches Häkchen im Dialog (`ownConfirmed`), sonst lehnt der Server ab. Die API erzeugt das PDF, legt es als `JJJJ-MM-TT Titel.pdf` im Protokoll-Ordner ab (bei belegtem Namen `… (2).pdf`) und setzt erst dann den Status. Hat sich das Protokoll inzwischen geändert, wird die Datei wieder gelöscht. Danach lässt sich das Protokoll nicht mehr ändern.
4. **Versand:** Wie bei den Word-Protokollen: Anzahl der Leitenden aus CampFlow bestätigen, das abgelegte PDF geht mit einem Link auf die Seite des Protokolls in Blindkopie an alle. Vor der Mail wird der Versand reserviert; bleibt er unbestätigt („Versand unklar“), ist ein erneutes Senden nur bewusst möglich.

„PDF-Vorschau“ erzeugt bei Entwürfen und im Review ein PDF des zuletzt gespeicherten Stands, gekennzeichnet als Entwurf. Nach der Freigabe lädt „PDF herunterladen“ die abgelegte Datei.

Die Liste der Protokoll-Dateien (Word-Weg) blendet die abgelegten PDFs aus, und ihre Endpunkte behandeln sie als nicht vorhanden. Sie gehören zum Protokoll im Editor.

### PDF

Erzeugt in der API mit `pdfmake` (`api/lib/protokoll-editor-pdf.ts`), im Layout der Briefe aus der Abrechnung:

- **Erste Seite (Deckblatt):** Voller Briefkopf mit Stammeslilie, „DPSG Stamm Phoenix“, Pfarrei Sankt Laurentius Feldkirchen-Westerham und den Stammesvorsitzenden mit Telefon und Adresse aus der Leitenden-Liste (Team „Vorstand“). Darunter Titel, Datum, Freigabe (oder „Entwurf“) und nur das Inhaltsverzeichnis mit Seitenzahlen. Volle Fußzeile mit DPSG-Zeile, Stammesnummer, Rechtstext zu BJR, BDKJ, IKKP, RdP und WOSM, DPSG-Logo und Seitenzahl.
- **Ab Seite 2:** Das Protokoll selbst (Sitzungsdaten, Tagesordnung mit Text, Aufgaben und Aktion, nächste Leitendenrunde). Reduzierte Kopfzeile mit kleinem Logo, Titel und Datum, reduzierte Fußzeile mit Stammesnummer und Seitenzahl.

Deckblatt und Protokoll sind zwei `section`s von pdfmake mit eigenen Rändern, Kopf- und Fußzeilen.

Schrift ist Source Sans 3, die Schrift der Website (SIL Open Font License, `api/assets/fonts/`). Sie wird eingebettet. Bilder liegen in `api/assets/protokoll/`. Das PDF lädt nichts von außen.

### Testen

Previews nutzen dieselbe SharePoint-Bibliothek wie die Website. Eine Freigabe in einer Preview legt das PDF also im echten Protokoll-Ordner ab, und ein Versand geht an alle Leitenden. Zum Testen das Protokoll „TEST – bitte löschen“ nennen und das PDF danach in SharePoint löschen. Für den Versand vorübergehend `campflowGroups` auf eine Testgruppe setzen (siehe [Protokolle](protokolle.md#testen)). Die Preview bringt ein Protokoll im Review mit („Stavo-Sitzung (Testdaten)“).

## Rechte

- Alle angemeldeten Leitenden sehen alle Protokolle und dürfen einen Entwurf schreiben.
- Entwürfe löschen dürfen alle Leitenden.
- Freigeben, Zurückgeben und Verschicken dürfen alle Leitenden; das eigene Protokoll nur mit ausdrücklicher Bestätigung.
- Das Löschen entfernt auch alle Versionen.

Autosave und Verlängern der Sperre werden nicht protokolliert (`pflegeHandler` mit `quiet`). Protokolliert werden Anlegen, Übernehmen, Überschreiben mit einer lokalen Fassung, Wiederherstellen und Löschen, immer nur mit ID, nie mit Inhalt.

## Daten

Schema `protokoll` (`api/migrations/0016_protokoll_editor.sql`):

| Tabelle     | Inhalt                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `protokoll` | Titel, Datum, Status, Inhalt als JSON (`ProtokollInhalt`); seit `0017` auch Review, Freigabe, abgelegtes PDF und Versand.               |
| `sperre`    | Wer gerade schreibt: Login, Name, Tab-Kennung, Ablauf und aktiver Punkt. Eigene Tabelle, damit das Verlängern die Version nicht ändert. |
| `revision`  | Gesicherte Fassungen mit Grund (`speichern`, `uebernahme`, `ueberschreiben`, `wiederherstellen`).                                       |

Die Aufgaben aus der Freigabe liegen in `organisation.task` mit `protokoll_id`, `protokoll_aufgabe` (ID des Eintrags, eindeutig je Protokoll) und `protokoll_punkt` (`api/migrations/0031_protokoll_aufgaben.sql`).

Die weiteren Personen liegen in `organisation.person` (`api/migrations/0018_weitere_personen.sql`, `api/lib/weitere-personen.ts`, Pflege unter `/api/intern/pflege/personen`), damit auch andere Module sie nutzen können.

Code: `api/lib/protokoll-editor*.ts` (Review und Versand in `protokoll-editor-review.ts`, PDF in `protokoll-editor-pdf.ts`, Aufgaben in `protokoll-editor-aufgaben.ts`), `api/endpoints/intern-protokoll-editor.ts`, `web/src/components/protokolle/`, `web/src/lib/protokollEditor.ts`. Die Typen stehen in `api/lib/protokoll-editor-model.ts`, das auch das Frontend nutzt. Die Previews bekommen zwei erfundene Protokolle, eines davon im Review mit einer Aufgabe im Projekt „Herbstaktion“ (`seedPreviewProtokollEditor`), und erfundene weitere Personen (`seedPreviewWeiterePersonen`).
