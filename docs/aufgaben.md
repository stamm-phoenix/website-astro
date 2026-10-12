# Aufgaben und persönliche Startseite (#153, #140)

Das Modul `/leitendenbereich/aufgaben` ist die gemeinsame Aufgabenablage für Aktionen und andere
Projekte. Aufgaben haben Titel, Beschreibung, eine oder mehrere zuständige Personen mit Klarname und Stammes-Login, optionale
Fälligkeit und Erledigt-Status. Vollständige zweiteilige Namen werden nach der Stammeskonvention als `vorname.nachname@stamm-phoenix.de` gespeichert. Der persönliche Filter erkennt auch bereits gespeicherte vollständige Namen, ohne Groß-/Kleinschreibung. Einzelne Vornamen bleiben ohne explizite Auswahl manuell.
Die Startseite zeigt zuerst die dem eigenen Login zugewiesenen offenen Aufgaben, ansonsten die
nächsten offenen Aufgaben des Stammes. Vorschläge und abgelehnte Vorschläge zählen nicht als offen.

Vorschläge mit einer Fälligkeit vor heute werden in der Vorschlagsliste ausgeblendet.
Die Erkennung speichert nur Vorschläge ohne Fälligkeit oder mit einer Fälligkeit ab heute
(Kalendertag in Europe/Berlin). Bereits angenommene Aufgaben bleiben auch bei überschrittener
Fälligkeit sichtbar. Bestehende Vorschläge und Prüfentscheidungen werden nicht gelöscht.

## Mobile Bedienung

Der Standardstatus ist „Offen“. Die Darstellung Liste/Kanban wird im Browser unter `phoenix-task-presentation` gespeichert und bei erneutem Aufruf wiederhergestellt; blockierter Speicher verhindert die Bedienung nicht. Die Aufgabenansicht enthält getrennte Segmentsteuerungen für die Darstellung „Liste / Kanban“ und den Status „Alle / Offen / Erledigt“. Projekt und „Nur mir zugewiesen“ stehen unter „Filter (N aktiv)“, zunächst eingeklappt. Der persönliche Filter ist ein Schalter mit mindestens 44 px hoher Tippfläche. Beim Wechsel der Darstellung bleiben alle Filter erhalten. „Aufgabe anlegen“ ist die gefüllte Hauptaktion, „Checkliste aus Vorlage“ bleibt eine Outline-Aktion.

Projekte, Vorlagen und Aufgabenvorschläge haben eigene Unterseiten (`/leitendenbereich/aufgaben/projekte`, `/vorlagen` und `/vorschlaege` unter demselben Aufgabenpfad), eigene Überschriften und Brotkrümel. Die Links stehen getrennt unter „Planung und Verwaltung“ unterhalb der Aufgabenliste. Offene Vorschläge sind zusätzlich mit einem Zähler und direktem Link oben sichtbar. Auf diesen Seiten gibt es keine Liste-/Kanban- oder Aufgabenstatus-Schalter. Der Rückweg zur Aufgabenliste ist ausdrücklich verlinkt. Bestehende Protokoll-Links mit `?protokoll=` werden auf die Vorschlagsseite weitergeleitet. Neue Protokoll-Links verweisen direkt dorthin. Die Protokollliste wird ausschließlich auf der Vorschlagsseite geladen.

Erkennungsergebnisse erscheinen neutral direkt unter „Aufgaben erkennen“, erst nach einem
Aufruf. Sie lassen sich schließen und werden beim Wechsel von Protokoll, Bereich oder Filter sowie
beim Weiterarbeiten entfernt. Später eintreffende Ergebnisse einer inzwischen verlassenen
Auswahl werden nicht erneut angezeigt. Der Leerzustand nennt den nächsten Schritt. Protokolle
stehen mit deutschen Datumsangaben und den neuesten Terminen zuerst in der Auswahl. Die
Aufgabenseite verzichtet auf eine redundante Einleitung und auf das Wasserzeichen hinter dem Text. Die Status-Segmente zeigen Zähler; beide Segmentsteuerungen haben mindestens 44 px hohe Tippflächen. Die aktive Auswahl verwendet einen helleren Hintergrund und Rahmen. Bei ausreichender Breite stehen Ansicht und Status nebeneinander, auf schmalen Geräten umbrechend. Projekt- und Personenfilter sind auch bei Vorschlägen zunächst eingeklappt.

Die Aufgabenliste trennt Projekt, Personen und Fälligkeit durch beschriftete Chips mit Symbolen. Termine erscheinen als „Heute“, „Morgen“ oder deutsches Datum; überfällige Aufgaben zeigen die Anzahl überfälliger Tage. Offene Aufgaben innerhalb der nächsten drei Tage und überfällige Aufgaben werden hervorgehoben. Ein Klick auf die Karte öffnet den Bearbeitungsdialog. Erledigte Titel sind gedämpft und durchgestrichen. Eine Checkbox links vor dem Titel markiert die Aufgabe als erledigt oder öffnet sie wieder. Der bestehende Toast steht am unteren Rand des sichtbaren Browserfensters mit Abstand zur Systemleiste und `role="status"`. Er bestätigt die Änderung und bietet zehn Sekunden lang „Rückgängig“ mit Versionsprüfung. Bearbeiten und Löschen stehen im Drei-Punkte-Menü; dieses verwendet auf dem Handy ein Bottom Sheet im vorhandenen App-Dialog mit genau einer Schließen-Aktion. Löschen benötigt die Bestätigung im vorhandenen App-Dialog. Tastaturfokus und Rückkehr nach Abbruch bleiben erhalten.

## Kanban-Ansicht

„Kanban“ zeigt ausschließlich offene und erledigte Aufgaben. Bei Status „Alle“ stehen beide Spalten nebeneinander, auf schmalen Bildschirmen untereinander. Bei „Offen“ oder „Erledigt“ erscheint die gewählte Spalte. Status-, Projekt- und persönlicher Filter gelten in Liste und Kanban gleichermaßen. „Als erledigt markieren“ und „Wieder öffnen“ verschieben Aufgaben zwischen den Spalten. Ungeprüfte Vorschläge bleiben außerhalb der Aufgabenansicht auf ihrer eigenen Seite. Dort ist „Ablehnen“ für Reviewende auch dann verfügbar, wenn die Protokollliste wegen eines SharePoint-Ausfalls nicht geladen wird.

## Projekte und Vorlagen

Unter „Projekte“ lassen sich Projekte anlegen, mit einer vorhandenen CampFlow-Aktion verknüpfen und nach Bestätigung im vorhandenen App-Dialog löschen. Die Liste zeigt die Anzahl offener Aufgaben. Beim Löschen bleiben alle Aufgaben, Vorlagen und CampFlow-Aktionen erhalten; die Aufgaben erscheinen danach unter „Ohne Projekt“. Projektlöschung, Ablösen der Aufgaben und Entfernen der angewendeten Checklisten erfolgen atomar mit Versionsprüfung.
Die Aktionsansicht führt ebenfalls zum Aufgabenmodul. Eine wiederverwendbare Vorlage enthält bis
zu 50 Aufgaben mit Beschreibung, Zuständigkeit und Abstand in Tagen zum Aktionsdatum: positive
Zahlen davor, negative danach. „Checkliste aus Vorlage“ legt sie für ein Projekt atomar an. Je
Projekt/Vorlage ist das einmal möglich, auch bei parallelen Anfragen. Spätere Vorlagenänderungen
ändern bestehende Aufgaben nicht; die Aufgaben lassen sich danach einzeln anpassen.

## Vorschläge aus Protokollen

Die Protokollliste verlinkt die zugehörige Ansicht. Nur die bereits für Protokolle eingetragenen
Reviewenden dürfen die Erkennung starten oder Vorschläge annehmen/ablehnen. Alle Leitenden dürfen
Aufgaben manuell anlegen und pflegen. Es erfolgt keine automatische Extraktion bei Freigabe und
keine automatische Zuweisung durch die KI.

Die Erkennung verwendet die DOCX-Auslesung, Word-Inhaltsfingerabdrücke und strukturierte Azure-
OpenAI-Anbindung aus #248. Zulässig sind unveränderte freigegebene/verschickte oder archivierte
Protokolle. Metadaten, Freigabestatus und Inhaltsversion werden vor der Verarbeitung und nach dem
Modellaufruf geprüft; nur die geprüften Bytes gehen ans Modell. Eingaben im Dokument sind Daten,
keine auszuführenden Anweisungen. Der vollständige Text ist auf 24.000 Zeichen begrenzt; längere
Dokumente werden abgelehnt, ohne sie unbemerkt zu kürzen. Maximal 30 Vorschläge mit überprüfbarer
Fundstelle werden übernommen. Ungültige Fristen werden verworfen, unbelegte Vorschläge ignoriert.

Reviewende prüfen Titel, Zuständigkeit, Fälligkeit und Fundstelle und können sie vor der Annahme
korrigieren oder einem Projekt zuordnen. Annahme prüft erneut die aktuelle Quelldatei. Veraltete
Vorschläge können abgelehnt und erneut erkannt werden. Erneute Erkennung derselben Inhaltsfassung
setzt keine Entscheidungen zurück und legt keine zweite Vorschlagsliste für eine bereits gespeicherte Inhaltsfassung an, auch wenn
das Modell die Titel bei einer Wiederholung anders formuliert. Bei einer
neuen Inhaltsfassung entstehen eigenständige Vorschläge; Reviewende müssen bereits übernommene
Aufgaben berücksichtigen. Bestätigte Aufgaben bleiben bei späteren Word-Änderungen eigenständig.
Quellprotokoll und Fundstelle bleiben sichtbar. Aufgaben aus Protokollen werden erledigt statt
physisch gelöscht, damit erneutes Erkennen sie nicht wieder anlegt.

`CONFIG.protokolle.aufgaben` enthält Deployment und Tageslimit (initial 20 pro Functions-Instanz),
mit derselben Azure-Ressource wie die Terminerkennung. Leere Deploymentwerte oder ein Limit von 0
schalten die Erkennung aus; manuelle Pflege bleibt verfügbar. Der Modellaufruf hat ein Timeout
von 20 Sekunden. Protokolltext und Modellantworten werden nicht geloggt. Die Protokollerkennung
startet ausschließlich auf ausdrücklichen Aufruf, ohne automatische Erkennung oder Erinnerungen
an die Protokollprüfung. Sie nutzt die bestehende Function App. Erinnerungsmails für fällige
Aufgaben sind davon unabhängig und im Abschnitt „Erinnerungsmails“ beschrieben.
Azure Global Standard kann weltweit verarbeiten; die
Datenschutzerklärung beschreibt Aufgabenverarbeitung und Ablage.

## Personen auswählen

Die Auswahl orientiert sich an GitHub Issues: ausgewählte Personen erscheinen als entfernbare
Tags mit ihrem Klarnamen. Das Suchfeld bleibt für weitere Personen frei; doppelte Auswahl wird
verhindert. Bis zu 20 Personen können gemeinsam zuständig sein. Listen, Kanban und Startseite
zeigen Klarnamen. „Nur mir zugewiesen“ prüft alle ausgewählten Logins, auch wenn der eigene nicht
an erster Stelle steht. Die Erledigung gilt wie bei einer GitHub-Issue für die gemeinsame Aufgabe.

Die additive Migration `0006_task_assignees.sql` speichert die Personenliste als JSON mit Namen
und Login. Bestehende Einzelzuweisungen werden weiter gelesen; ältere Clients können weiterhin
das einzelne `assignee`-Feld senden. Vorlagen und daraus erzeugte Checklisten übernehmen alle
Personen. Das bestehende ETag schützt Änderungen an der gesamten Personenliste atomar.

Die Zuständigkeitsfelder für Aufgaben und Vorlagen schlagen lokale SharePoint-Benutzer nach Name
oder Login vor. Bei Eingabe von „Hugo“ kann die passende Person mit vollständigem Namen und Login
per Maus, Touch oder Pfeiltasten/Enter ausgewählt werden. Gespeichert werden ihr Klarname und Login. Im Formular werden keine E-Mail-Adressen als Auswahltext angezeigt. Bei mehreren
Treffern entscheidet die Auswahl; ein Vorname allein wird nicht einer Person zugeordnet.
Die Benutzerliste ist ausschließlich für angemeldete Leitende verfügbar. Ein Ausfall verhindert
manuelles Eingeben und Speichern nicht. Die Namenskonvention verwendet ä/ö/ü → ae/oe/ue und ß → ss;
bei abweichendem Login ist die Auswahl der Person oder die direkte Login-Eingabe maßgeblich.

## Zuordnung von @Person-Tags

Wenn eine Aufgabe ausdrücklich einer Person zugewiesen ist und die Fundstelle ihren `@Name`-Tag
enthält, wird der vollständige Name mit den Benutzern der SharePoint-Site abgeglichen. Ein
eindeutiger Treffer verwendet deren Mitgliedschafts-Login (UPN), damit die bestätigte Aufgabe im
persönlichen Filter erscheint. Vollständige manuell eingegebene Namen nutzen die oben beschriebene Stammeskonvention. Mehrdeutige Tags,
unbekannte Tags und bloße Teilnehmendenlisten bleiben zur manuellen Prüfung stehen.

Neue Vorschläge erhalten diese Zuordnung bei der Erkennung. Bei bereits vorhandenen Vorschlägen
wird sie beim Öffnen von „Prüfen und annehmen“ vorgeschlagen, ohne die gespeicherte Aufgabe zu
ändern. Eigene Eingaben im Prüfdialog werden durch eine später eintreffende Zuordnung nicht
überschrieben. Die Annahme bleibt ausdrücklich und versionsgeprüft. Auch ohne verfügbare
Benutzerliste können Vorschläge manuell geprüft oder abgelehnt werden; die Abfrage ist auf fünf
Sekunden begrenzt. Die vorhandenen SharePoint-Berechtigungen genügen, kein Zugriff auf das gesamte
Entra-Benutzerverzeichnis ist erforderlich. Die Benutzerliste wird nicht an das KI-Modell gesendet.

## Projektzuordnung aus Protokollen

Bei einer neuen Erkennung berücksichtigt die KI Projektnamen, Abschnittsüberschriften und #Projekt-Tags. Nur Projektnamen, die im Protokoll vorkommen, werden übernommen. Ein eindeutig gleichnamiges bestehendes Projekt wird im Aufgabenvorschlag vorausgewählt. Die Zuordnung kann beim Prüfen geändert werden; bestehende Aufgaben werden nicht nachträglich umsortiert.

Neue Projektideen stehen zusammen mit dem Aufgabenvorschlag zur Prüfung. „Neues Projekt anlegen und Aufgabe zuordnen“ ist zunächst nicht ausgewählt. Nach ausdrücklicher Auswahl kann der Name geändert werden. Erst beim Annehmen werden Projekt und Aufgabenentscheidung in einer Transaktion gespeichert; ein inzwischen vorhandenes gleichnamiges Projekt wird verwendet. Parallele Annahmen erzeugen keine doppelten Projekte. Abbrechen, Ablehnen und Versionskonflikte legen kein Projekt an. Gleichnamige, mehrdeutige bestehende Projekte müssen manuell ausgewählt werden.

Migration `0007_task_project_suggestions.sql` ergänzt den Projektnamen-Vorschlag am Task. Preview-Seed 7 fügt eine erfundene Projektidee hinzu und ersetzt ausschließlich unveränderte, systemseitige „Preview:“-Titel durch natürliche Namen; eigene Umbenennungen bleiben erhalten.

## Ablage und Betrieb

Migration `0005_aufgaben.sql` legt im Schema `organisation` Projekte, Vorlagen, Aufgaben (inklusive
Vorschlagszuständen) und angewendete Checklisten an. Deployments wenden sie vor dem Code an.
Alle Änderungen vergleichen die geladene SQL-rowversion, Konflikte ergeben HTTP 409. Checklisten
und Erkennung werden unter Transaktionssperren gespeichert. SQL und SharePoint haben keine
verteilte Transaktion: Quelldateiprüfungen erfolgen unmittelbar vor dem SQL-Schreibzugriff.
PR-Previews erhalten ausschließlich erfundene Daten für jede Tabelle (`seedPreviewTasks`, Seed 7).
Es müssen keine zusätzlichen SharePoint-Spalten eingerichtet werden.

Favoriten der Startseite werden nur auf dem jeweiligen Gerät gespeichert, getrennt nach
SWA-Benutzer-ID (`phoenix:staff-favorites:v1:<userId>`). Nur bekannte, dauerhaft zugängliche Module
sind auswählbar. Leere, ungültige oder gesperrte Speicherzustände verhindern die Bedienung nicht;
bei gesperrtem Speicher gilt die Auswahl für die aktuelle Ansicht. Nikolaus-Verwaltungsmodule
bleiben in ihrem bestehenden, schaltbaren Bereich; die immer verfügbare Steuerung ist favorisierbar.
Die kommenden fünf nicht archivierten CampFlow-Aktionen werden nach Beginn sortiert. Fehler beim
Laden von Aktionen und Aufgaben werden unabhängig voneinander angezeigt und können erneut
versucht werden. Alle bisherigen Modulgruppen bleiben unterhalb der persönlichen Startseite.

## Kategorien im Leitendenbereich

Die Module sind nach ihrem Einsatz gegliedert:

- **Organisation:** Aufgaben, Protokolle, Leitende & Teams, Gruppenstunden, Anwesenheit und QR-Code.
- **Aktionen & Lager:** Aktionen, Fahrten und Sammelbestellungen für Material und Ausrüstung.
- **Kasse:** Belege, Eigenbeleg und Abrechnung.
- **Website pflegen:** Blog, Downloads und Fragen & Antworten.
- **Nikolausdienst:** bleibt als eigener, schaltbarer Bereich bestehen.

Aufgaben bleiben ein eigenständiges Modul in „Organisation“. Die persönliche Übersicht und
Favoriten stehen über den Kategorien; Favoriten sind unabhängig von der Kategorienzuordnung.

## Erinnerungsmails

Offene Aufgaben mit Fälligkeit und zugewiesenem Stammes-Login werden am Vortag und am
Fälligkeitstag berücksichtigt. Pro Person gibt es eine private Sammelmail pro Berliner Kalendertag,
mit Aufgaben, deutschem Datum, Projekt und Links zur App. Mehrere Zuständige erhalten jeweils ihre
eigene Mail. Vorschläge, erledigte/abgelehnte Aufgaben, vergangene Fristen, Aufgaben ohne Frist oder
ohne auflösbaren internen Login werden nicht versendet.

Der vorhandene stündliche GitHub-Zeitplan (`17 * * * *`) ruft auf `main` den Job
`task-reminders` auf. Die API beginnt ab 9 Uhr Europe/Berlin; Sommer-/Winterzeit und verzögerte
Läufe werden anhand der Berliner Uhr berücksichtigt. Weitere Aufrufe am selben Tag sind
idempotent. Der Versand startet nach dem Merge und Deployment auf `main`, nicht in PR-Previews.
Der Absender ist `kontakt@stamm-phoenix.de` über die vorhandene Microsoft-Graph-Mailberechtigung.
Die Einstellungen liegen in `CONFIG.taskReminders`; neue Secrets sind nicht erforderlich.

`POST /api/automation/aufgaben-erinnerungen` ist ein Maschinen-Endpunkt außerhalb der
Staff-Routen. Er akzeptiert ausschließlich ein kurzlebiges, kryptografisch geprüftes GitHub-OIDC-
Token des stündlichen `main`-Workflows dieses Repositories, mit eigener Audience, korrektem
Issuer, Subject, Ref und Workflow-Pfad. Ein normaler Staff-Login oder PR-Workflow genügt nicht.
Empfänger, Datum und Mailinhalt werden ausschließlich serverseitig bestimmt. Der Job erhält nur
Zähler und niemals Empfängeradressen oder Aufgabeninhalte.

Migration `0008_task_reminder_delivery.sql` speichert pro Empfänger/Tag einen versionsgeschützten
Versandversuch. Er wird vor dem Graph-Aufruf reserviert; parallele Aufrufe können dadurch nicht
dieselbe Sammelmail erneut senden. Vor dem Versand werden Status, Zuordnung und Frist nochmals
geprüft. Bei Transportfehlern oder Prozessabbrüchen bleibt der Versuch als unklar markiert und
wird nicht automatisch wiederholt. Auch HTTP-Retries des Mailtransports sind für diese Mails
ausgeschaltet. Der GitHub-Job meldet unbestätigte Sendungen als Fehler; im Absenderpostfach lässt
sich prüfen, ob die Mail angenommen wurde. Ein `sent`-Status bestätigt die Annahme durch Graph,
nicht die spätere Zustellung ins Empfängerpostfach.

Versandnachweise werden nach 60 Tagen gelöscht. Kleine Batches halten einzelne API-Aufrufe kurz;
der Job arbeitet den Rest in weiteren Aufrufen ab. Preview-Seed 8 fügt ausschließlich einen
fiktiven Versandnachweis hinzu. Die Vorschau-Datenbank und der Preview-Server sind vor jeglichem
Versand gesperrt. Tests verwenden einen gemockten Mailtransport und versenden keine echten Mails.

Migration `0009_task_recognition.sql` ergänzt das Erkennungsjournal und übernimmt bereits gespeicherte Protokollversionen. Preview-Seed 9 befüllt die neue Tabelle mit erfundenen Daten. Abgeschlossene Aufgabenerkennungen werden je Protokoll und Inhaltsversion gespeichert, auch ohne neue Vorschläge. Ein erneuter Aufruf derselben Version löst keinen weiteren KI-Aufruf aus. Nach einer Inhaltsänderung kann das Protokoll erneut erkannt werden. Projektzuordnungen und Projektlöschungen laufen unter derselben Transaktionssperre.

Datumsfelder für Aufgaben und Checklisten verwenden sichtbar `TT.MM.JJJJ`, prüfen echte Kalendertage und speichern weiterhin ISO-Daten. Der native Kalender bleibt über eine Schaltfläche erreichbar. Der Mailhinweis ist eingeklappt. Bei leeren Vorschlagsbeschreibungen wird die Fundstelle im Prüfdialog vorausgefüllt. Der Leitendenbereich verwendet eine kompakte Fußzeile mit Übersicht, Impressum, Datenschutz und ausdrücklich beschrifteter Version.
