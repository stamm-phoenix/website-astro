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

Der Standardstatus ist „Offen“. Die Darstellung Liste/Kanban wird im Browser unter `phoenix:task-presentation:v1` gespeichert und bei erneutem Aufruf wiederhergestellt; blockierter Speicher verhindert die Bedienung nicht. Die Aufgabenansicht enthält getrennte Segmentsteuerungen für die Darstellung „Liste / Kanban“ und den Status „Alle / Offen / Erledigt“. Projekt und „Nur mir zugewiesen“ stehen unter „Filter (N aktiv)“, zunächst eingeklappt. Der persönliche Filter ist ein Schalter mit mindestens 44 px hoher Tippfläche. Beim Wechsel der Darstellung bleiben alle Filter erhalten. „Aufgabe anlegen“ ist die gefüllte Hauptaktion, „Checkliste aus Vorlage“ bleibt eine Outline-Aktion.

Projekte, Vorlagen und Aufgabenvorschläge haben eigene Unterseiten (`/leitendenbereich/aufgaben/projekte`, `/vorlagen` und `/vorschlaege` unter demselben Aufgabenpfad), eigene Überschriften und Brotkrümel. Die Links stehen getrennt unter „Planung und Verwaltung“ unterhalb der Aufgabenliste. Offene Vorschläge sind zusätzlich mit einem Zähler und direktem Link oben sichtbar. Auf diesen Seiten gibt es keine Liste-/Kanban- oder Aufgabenstatus-Schalter. Der Rückweg zur Aufgabenliste ist ausdrücklich verlinkt. Bestehende Protokoll-Links mit `?protokoll=` werden auf die Vorschlagsseite weitergeleitet. Neue Protokoll-Links verweisen direkt dorthin. Die Protokollliste wird ausschließlich auf der Vorschlagsseite geladen.

Erkennungsergebnisse erscheinen neutral direkt unter „Aufgaben erkennen“, erst nach einem
Aufruf. Sie lassen sich schließen und werden beim Wechsel von Protokoll, Bereich oder Filter sowie
beim Weiterarbeiten entfernt. Später eintreffende Ergebnisse einer inzwischen verlassenen
Auswahl werden nicht erneut angezeigt. Der Leerzustand nennt den nächsten Schritt. Protokolle
stehen mit deutschen Datumsangaben und den neuesten Terminen zuerst in der Auswahl. Die
Aufgabenseite verzichtet auf eine redundante Einleitung und auf das Wasserzeichen hinter dem Text. Die Status-Segmente zeigen Zähler; beide Segmentsteuerungen haben mindestens 44 px hohe Tippflächen. Die aktive Auswahl verwendet einen helleren Hintergrund und Rahmen. Bei ausreichender Breite stehen Ansicht und Status nebeneinander, auf schmalen Geräten umbrechend. Projekt- und Personenfilter sind auch bei Vorschlägen zunächst eingeklappt.

Die Aufgabenliste trennt Projekt, Personen und Fälligkeit durch beschriftete Chips mit Symbolen. Termine erscheinen als „Heute“, „Morgen“ oder deutsches Datum; überfällige Aufgaben zeigen die Anzahl überfälliger Tage. Offene Aufgaben innerhalb der nächsten drei Tage und überfällige Aufgaben werden hervorgehoben. Ein Klick auf die Karte öffnet den Bearbeitungsdialog. Erledigte Titel sind gedämpft und durchgestrichen. Eine Checkbox links vor dem Titel markiert die Aufgabe als erledigt oder öffnet sie wieder. Der bestehende Toast steht am unteren Rand des sichtbaren Browserfensters mit Abstand zur Systemleiste und `role="status"`. Er bestätigt die Änderung und bietet zehn Sekunden lang „Rückgängig“ mit Versionsprüfung. Bearbeiten und Löschen stehen im Drei-Punkte-Menü; dieses verwendet auf dem Handy ein eigenes Bottom Sheet im App-Stil mit genau einer Schließen-Aktion. Löschen benötigt die Bestätigung im vorhandenen App-Dialog. Tastaturfokus und Rückkehr nach Abbruch bleiben erhalten.

## Kanban-Ansicht

„Kanban“ zeigt ausschließlich offene und erledigte Aufgaben. Bei Status „Alle“ stehen beide Spalten nebeneinander, auf schmalen Bildschirmen untereinander. Bei „Offen“ oder „Erledigt“ erscheint die gewählte Spalte. Status-, Projekt- und persönlicher Filter gelten in Liste und Kanban gleichermaßen. „Als erledigt markieren“ und „Wieder öffnen“ verschieben Aufgaben zwischen den Spalten. Ungeprüfte Vorschläge bleiben außerhalb der Aufgabenansicht auf ihrer eigenen Seite. Dort ist „Ablehnen“ auch dann verfügbar, wenn die Protokollliste wegen eines SharePoint-Ausfalls nicht geladen wird.

## Projekte und Vorlagen

Unter „Projekte“ lassen sich Projekte anlegen, mit einer vorhandenen CampFlow-Aktion verknüpfen und nach Bestätigung im vorhandenen App-Dialog löschen. Die Liste zeigt die Anzahl offener Aufgaben. Beim Löschen bleiben alle Aufgaben, Vorlagen und CampFlow-Aktionen erhalten; die Aufgaben erscheinen danach unter „Ohne Projekt“. Projektlöschung, Ablösen der Aufgaben und Entfernen der angewendeten Checklisten erfolgen atomar mit Versionsprüfung.
Die Aktionsansicht führt ebenfalls zum Aufgabenmodul. Eine wiederverwendbare Vorlage enthält bis
zu 50 Aufgaben mit Beschreibung, Zuständigkeit und Abstand in Tagen zum Aktionsdatum: positive
Zahlen davor, negative danach. „Checkliste aus Vorlage“ legt sie für ein Projekt atomar an. Je
Projekt/Vorlage ist das einmal möglich, auch bei parallelen Anfragen. Spätere Vorlagenänderungen
ändern bestehende Aufgaben nicht; die Aufgaben lassen sich danach einzeln anpassen.

## Vorschläge aus Protokollen

Die Protokollliste verlinkt die zugehörige Ansicht. Alle Leitenden dürfen die Erkennung starten,
Vorschläge annehmen oder ablehnen und Aufgaben manuell anlegen und pflegen. Es erfolgt keine automatische Extraktion bei Freigabe und
keine automatische Zuweisung durch die KI.

Die Erkennung verwendet die DOCX-Auslesung, Word-Inhaltsfingerabdrücke und strukturierte Azure-
OpenAI-Anbindung aus #248. Zulässig sind unveränderte freigegebene/verschickte oder archivierte
Protokolle. Metadaten, Freigabestatus und Inhaltsversion werden vor der Verarbeitung und nach dem
Modellaufruf geprüft; nur die geprüften Bytes gehen ans Modell. Eingaben im Dokument sind Daten,
keine auszuführenden Anweisungen. Der vollständige Text ist auf 24.000 Zeichen begrenzt; längere
Dokumente werden abgelehnt, ohne sie unbemerkt zu kürzen. Maximal 30 Vorschläge mit überprüfbarer
Fundstelle werden übernommen. Ungültige Fristen werden verworfen, unbelegte Vorschläge ignoriert.

Leitende prüfen Titel, Zuständigkeit, Fälligkeit und Fundstelle und können sie vor der Annahme
korrigieren oder einem Projekt zuordnen. Annahme prüft erneut die aktuelle Quelldatei. Veraltete
Vorschläge können abgelehnt und erneut erkannt werden. Erneute Erkennung derselben Inhaltsfassung
setzt keine Entscheidungen zurück und legt keine zweite Vorschlagsliste für eine bereits gespeicherte Inhaltsfassung an, auch wenn
das Modell die Titel bei einer Wiederholung anders formuliert. Bei einer
neuen Inhaltsfassung entstehen eigenständige Vorschläge; bereits übernommene
Aufgaben müssen dabei berücksichtigt werden. Bestätigte Aufgaben bleiben bei späteren Word-Änderungen eigenständig.
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

Die Zuständigkeitsfelder für Aufgaben und Vorlagen schlagen Entra-Personen nach Name
oder Login vor. Bei Eingabe von „Hugo“ kann die passende Person mit vollständigem Namen und Login
per Maus, Touch oder Pfeiltasten/Enter ausgewählt werden. Gespeichert werden ihr Klarname und Login. Im Formular werden keine E-Mail-Adressen als Auswahltext angezeigt. Bei mehreren
Treffern entscheidet die Auswahl; ein Vorname allein wird nicht einer Person zugeordnet.
Die Personenliste stammt aus den transitiven Mitgliedern der konfigurierten Entra-Gruppe
„Leitende“ (`CONFIG.taskDirectory.groupId`). Berücksichtigt werden Personenkonten mit Vor- und
Nachnamen und Login unter `stamm-phoenix.de`. Autocomplete und Aufgabenerkennung verwenden
dieselbe Quelle. Gleichzeitige Abfragen werden zusammengefasst; erfolgreiche Ergebnisse bleiben
fünf Minuten im Arbeitsspeicher, bei Ausfällen höchstens zehn Minuten. Danach bleiben manuelle
Namen und Vorschläge ohne automatische Login-Zuordnung möglich.

Die KI erhält Anzeigenamen und Vornamen mit kurzlebigen Kandidatennummern, keine E-Mail-Adressen,
Logins oder Entra-Konto-IDs aus der Personenliste. Die verwendete Bereitstellung ist
`gpt-4.1-mini` auf `website-astro-openai` (Global Standard, siehe Datenschutz).
`assigneeId` muss auf die übergebene Liste zeigen. Der Server akzeptiert nur eindeutige, in der
Fundstelle vorkommende Namen: vollständige Namen, Vornamen oder explizit konfigurierte Kurzformen
(`CONFIG.taskDirectory.shortNames`, zunächst Kathi/Kati für Katharina). Gruppen wie PGR und
mehrdeutige Namen bleiben manuell. Migration 0011 erhält die ursprüngliche Namensform; die
Vorschlagskarte und der Prüfdialog zeigen etwa „Kathi → Katharina Muster“. Erst „Annehmen“
bestätigt die Zuordnung. Bereits gespeicherte Vorschläge können beim Öffnen mit denselben
Namensregeln ergänzt werden, sofern sie als ältere Vorschläge ohne gespeicherte KI-Entscheidung vorliegen. Migration 0013 speichert bestätigte und abgelehnte KI-Zuordnungen getrennt; eine Ablehnung wird beim Öffnen nicht erneut automatisch zugeordnet. Benötigte Graph-Berechtigung: `GroupMember.Read.All` und `User.Read.All` als Application
Permission mit Admin Consent, siehe `docs/protokolle.md`.

## Zuordnung vorhandener Vorschläge

Beim Öffnen von „Prüfen und annehmen“ wird ein noch nicht zugeordneter Name anhand derselben
Entra-Liste und Namensregeln geprüft. Eigene Eingaben im Dialog werden durch eine später
eintreffende Zuordnung nicht überschrieben. Die gespeicherte Aufgabe bleibt bis zur ausdrücklich
bestätigten, versionsgeprüften Annahme unverändert. Bei Ausfall der Personenliste (fünf Sekunden
Zeitlimit) bleiben manuelle Prüfung und Ablehnung möglich.

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

Favoriten der Startseite liegen pro Account in Azure SQL (`organisation.staff_favorites`, Schlüssel
ist die SWA-Benutzer-ID) und gelten so auf jedem Gerät; `GET`/`PUT /api/intern/favoriten` liest
bzw. ersetzt die eigene Auswahl. Jedes Häkchen speichert sofort; schlägt das fehl, bleibt die
Auswahl stehen und lässt sich mit „Erneut speichern“ nachholen; bis dahin fragt die Seite vor dem
Verlassen nach. Hat ein Account noch nie Favoriten gespeichert, übernimmt die Startseite einmalig die
frühere Auswahl aus dem Browser (`phoenix:staff-favorites:v1:<userId>`, `PUT` mit `takeover: true`)
und löscht sie dort; hat der Account inzwischen auf einem anderen Gerät gespeichert, gilt diese
Auswahl. Laden und Speichern laufen über `web/src/lib/staffFavoritesStore.svelte.ts`. Nur bekannte, dauerhaft zugängliche
Module sind auswählbar; unbekannte Pfade werden beim Laden ignoriert. Nikolaus-Verwaltungsmodule
bleiben in ihrem bestehenden, schaltbaren Bereich; die immer verfügbare Steuerung ist favorisierbar.
Favoriten erscheinen als Zeile mit Links; ausgewählt und entfernt werden sie über „Favoriten
auswählen“. Darunter stehen nächste Aktionen (nicht archiviert, nach Beginn sortiert), offene
Aufgaben und KJR-Fristen als drei Karten nebeneinander, jeweils mit höchstens drei Einträgen
(KJR-Fristen vollständig) und einem Link zur ganzen Liste. Ist ein Bereich fertig geladen und leer,
wird seine Karte zu einer Zeile mit Häkchen („Keine offenen Aufgaben“), damit er nicht mit einem
Ladefehler verwechselt wird. Fehler beim Laden von Aktionen und Aufgaben werden unabhängig
voneinander in der Karte angezeigt und können erneut versucht werden. Alle bisherigen
Modulgruppen bleiben unterhalb der persönlichen Startseite.

## Kategorien im Leitendenbereich

Die Module sind nach ihrem Einsatz gegliedert:

- **Leitendenrunde:** Aufgaben, Protokolle und Weitere Personen (Auswahl im Protokoll).
- **Gruppen & Aktionen:** Anwesenheit, Aktionen und Fahrten.
- **Kasse & Material:** Belege, Eigenbeleg, Abrechnung und Sammelbestellungen.
- **Website pflegen:** Gruppenstunden, Leitende & Teams, Blog, Downloads, Fragen & Antworten und QR-Code, also alles, was auf der öffentlichen Website erscheint.
- **Nikolausdienst:** bleibt als eigener, schaltbarer Bereich bestehen (Anmeldungen, Dispo, Route, Helfende, Steuerung).

Aufgaben bleiben ein eigenständiges Modul in „Leitendenrunde“. Die persönliche Übersicht und
Favoriten stehen über den Kategorien; Favoriten sind unabhängig von der Kategorienzuordnung.

## Erinnerungsmails

Offene Aufgaben mit Fälligkeit und zugewiesenem Stammes-Login werden am Vortag und am
Fälligkeitstag berücksichtigt. Pro Person gibt es eine private Sammelmail pro Berliner Kalendertag,
mit Aufgaben, deutschem Datum, Projekt und Links zur App. Mehrere Zuständige erhalten jeweils ihre
eigene Mail. Vorschläge, erledigte/abgelehnte Aufgaben, vergangene Fristen, Aufgaben ohne Frist oder
ohne auflösbaren internen Login werden nicht versendet.

Der Versand läuft in einer eigenständigen Azure Function App über einen Timer Trigger
(`0 17 * * * *`). Die verwaltete HTTP-API der Static Web App unterstützt keine Timer.
Der Worker beginnt ab 9 Uhr Europe/Berlin; Sommer-/Winterzeit und verspätete Läufe werden
anhand der Berliner Uhr berücksichtigt. Weitere Läufe am selben Tag sind idempotent.
GitHub Actions testet und deployt ausschließlich Code und löst keine Erinnerungsmails aus.
Es gibt keinen öffentlichen HTTP-Endpunkt für den Reminder-Versand.

Der Absender ist `kontakt@stamm-phoenix.de` über die vorhandene Microsoft-Graph-Mailberechtigung.
Der Worker verwendet die bestehende Website-App-Identität für Graph und Azure SQL. Nur das
Website-Zertifikat wird als Azure App Setting übernommen, keine weiteren Website-Secrets.
Der neue Betriebsschalter `TASK_REMINDERS_ENABLED` ist standardmäßig aus. Timer und HTTP-App
haben getrennte Package-Einstiegspunkte, sodass die Vorschau keinen Timer registriert.
Einrichtung und Aktivierung: [Azure-Timer-Betrieb](aufgaben-timer.md).

Migration `0008_task_reminder_delivery.sql` speichert pro Empfänger/Tag einen versionsgeschützten
Versandversuch. Er wird vor dem Graph-Aufruf reserviert; parallele Aufrufe können dadurch nicht
dieselbe Sammelmail erneut senden. Vor dem Versand werden Status, Zuordnung und Frist nochmals
geprüft. Bei Verbindungsabbrüchen ohne bestätigte Antwort oder Prozessabbrüchen bleibt der Versuch als unklar markiert und
wird nicht automatisch wiederholt. Nur HTTP 429 wird nach 45 Minuten erneut versucht; HTTP 408 und 5xx bleiben wegen eines möglichen bereits erfolgten Versands unklar. Andere 4xx sind terminale Fehler. Auch HTTP-Retries des Mailtransports sind für diese Mails
ausgeschaltet. Die Azure Function meldet neu unbestätigte Sendungen einmalig als fehlgeschlagene Ausführung; im Absenderpostfach lässt
sich prüfen, ob die Mail angenommen wurde. Ein `sent`-Status bestätigt die Annahme durch Graph,
nicht die spätere Zustellung ins Empfängerpostfach.

Versandnachweise werden nach 60 Tagen gelöscht. Kleine Batches halten einzelne API-Aufrufe kurz;
der Timer-Worker arbeitet den Rest direkt in weiteren Batches ab und begrenzt sich auf acht Minuten. Preview-Seed 8 fügt ausschließlich einen
fiktiven Versandnachweis hinzu. Die Vorschau-Datenbank und der Preview-Server sind vor jeglichem
Versand gesperrt. Tests verwenden einen gemockten Mailtransport und versenden keine echten Mails.

Migration `0009_task_recognition.sql` ergänzt das Erkennungsjournal und übernimmt bereits gespeicherte Protokollversionen. Preview-Seed 9 befüllt die neue Tabelle mit erfundenen Daten. Abgeschlossene Aufgabenerkennungen werden je Protokoll und Inhaltsversion gespeichert, auch ohne neue Vorschläge. Ein erneuter Aufruf derselben Version löst keinen weiteren KI-Aufruf aus. Nach einer Inhaltsänderung kann das Protokoll erneut erkannt werden. Projektzuordnungen, Checklisten und Projektlöschungen teilen eine Transaktionssperre je Projekt, auch unter READ_COMMITTED_SNAPSHOT. Die SQL-Testdatenbanken verwenden denselben Isolationsmodus. Die Titelprüfung für Projektideen ist separat mit manuellen Titeländerungen serialisiert.

Datumsfelder für Aufgaben und Checklisten verwenden sichtbar `TT.MM.JJJJ`, prüfen echte Kalendertage und speichern weiterhin ISO-Daten. Der native Kalender bleibt über eine Schaltfläche erreichbar. Der Mailhinweis ist eingeklappt. Bei leeren Vorschlagsbeschreibungen wird die Fundstelle im Prüfdialog vorausgefüllt. Der Aufgabenbereich verwendet eine kompakte Fußzeile mit Übersicht, Impressum, Datenschutz und ausdrücklich beschrifteter Version.

## Aufbau und Fehlerfälle

Liste, Vorschläge, Projekte und Vorlagen sind getrennte Svelte-Inseln. `aufgabenStore.svelte.ts`
lädt gemeinsame Daten und verwirft überholte Antworten. Die vier Formulare besitzen ihre eigenen
Entwürfe; Filter und Datumsdarstellung liegen in reinen Hilfsfunktionen. Statuswechsel und Änderungen bestehender Aufgaben übernehmen die API-Antwort mit aktuellem ETag direkt in den Store. Rückgängig benötigt keinen zweiten Ladeaufruf. Bei übrigen Formularen wird ein fehlgeschlagenes Neuladen nach erfolgreicher Speicherung ausdrücklich gemeldet.
Alle erfolgreichen Schreibaktionen verwenden den unteren Toast; Erkennungsergebnisse bleiben
bei der auslösenden Aktion. Die kompakte Fußzeile wird ausschließlich im Aufgabenbereich über
den Footer-Slot eingebunden.

Migration `0010_task_reminder_retry.sql` ergänzt terminale Fehler und zeitversetzte Wiederholungen.
Nur HTTP 429 wird nach 45 Minuten erneut versucht. Die Reservierung bleibt währenddessen
als `retryable` gespeichert, damit spätere Empfänger in weiteren Batches bedient werden.
Andere 4xx außer 408 werden als `failed` einmal gemeldet. HTTP 408, sämtliche 5xx und
Verbindungsabbrüche bleiben `uncertain`, um Doppelversand zu vermeiden. Mehr als fünf Minuten
alte `attempted`-Einträge werden atomar nach `uncertain` überführt und einmal gemeldet. Noch gedrosselte Empfänger eines vergangenen Berliner Kalendertags werden beim nächsten Lauf einmal als fehlgeschlagen gemeldet.
Empfängeradressen stammen nur aus gespeicherten Logins. Manuelle Namen ohne Verzeichnistreffer
bleiben ohne Login und erhalten keine Mail.

Die bereits auf Vorschauen angewendeten Migrationen bleiben unverändert (AGENTS.md). Das
Kompatibilitätsfeld bleibt im API-/SQL-Modell, wird in den neuen Formularen jedoch aus der
Personenliste abgeleitet und nicht separat bearbeitet.

### Abgrenzung der Protokollmigration

PDF/TXT-Unterstützung und die Umstellung der Protokoll-Metadaten werden separat weitergeführt.
Migration 0012 sowie ihre Typen und erfundenen Preview-Daten bleiben unverändert, da sie bereits
in der Preview angewendet wurden. Die Tabellen werden von den Protokoll-Endpunkten dieses PRs
noch nicht verwendet. Es gibt hier keinen Produktions-Import-Gate und keine Bereinigung von SharePoint.

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
