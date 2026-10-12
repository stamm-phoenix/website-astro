# Aufgaben und persönliche Startseite (#153, #140)

Das Modul `/leitendenbereich/aufgaben` ist die gemeinsame Aufgabenablage für Aktionen und andere
Projekte. Aufgaben haben Titel, Beschreibung, eine oder mehrere zuständige Personen mit Klarname und Stammes-Login, optionale
Fälligkeit und Erledigt-Status. Vollständige zweiteilige Namen werden nach der Stammeskonvention als `vorname.nachname@stamm-phoenix.de` gespeichert. Der persönliche Filter erkennt auch bereits gespeicherte vollständige Namen, ohne Groß-/Kleinschreibung. Einzelne Vornamen bleiben ohne explizite Auswahl manuell.
Die Startseite zeigt zuerst die dem eigenen Login zugewiesenen offenen Aufgaben, ansonsten die
nächsten offenen Aufgaben des Stammes. Vorschläge und abgelehnte Vorschläge zählen nicht als offen.

Vorschläge mit einer Fälligkeit vor heute werden in der Vorschlagsliste und im Kanban ausgeblendet.
Die Erkennung speichert nur Vorschläge ohne Fälligkeit oder mit einer Fälligkeit ab heute
(Kalendertag in Europe/Berlin). Bereits angenommene Aufgaben bleiben auch bei überschrittener
Fälligkeit sichtbar. Bestehende Vorschläge und Prüfentscheidungen werden nicht gelöscht.

## Mobile Bedienung

Die Tab-Leiste lässt sich horizontal scrollen; Randverläufe zeigen weitere Tabs an. Der aktive
Tab wird beim Laden, Auswählen und nach Größenänderungen sichtbar gehalten. „Aufgabe anlegen“ ist
die gefüllte Hauptaktion, „Checkliste aus Vorlage“ bleibt eine Outline-Aktion. Projektfilter und
„Nur mir zugewiesen“ sind gruppiert; das gesamte Checkbox-Label ist mindestens 44 px hoch.

Erkennungsergebnisse erscheinen neutral direkt unter „Aufgaben erkennen“, erst nach einem
Aufruf. Sie lassen sich schließen und werden beim Wechsel von Protokoll, Tab oder Filter sowie
beim Weiterarbeiten entfernt. Später eintreffende Ergebnisse einer inzwischen verlassenen
Auswahl werden nicht erneut angezeigt. Der Leerzustand nennt den nächsten Schritt. Protokolle
stehen mit deutschen Datumsangaben und den neuesten Terminen zuerst in der Auswahl. Die
Aufgabenseite hat eine kürzere Einleitung und kein Wasserzeichen hinter dem Text.

## Kanban-Ansicht

„Kanban“ zeigt Vorschläge, offene und erledigte Aufgaben nebeneinander; auf schmalen Bildschirmen
stehen die Spalten untereinander. Projekt- und persönlicher Filter gelten für alle Spalten.
„Erledigt“ und „Wieder öffnen“ verschieben Aufgaben zwischen den Spalten. Vorschläge bleiben bis
zur ausdrücklichen Prüfung und Annahme in ihrer eigenen Spalte. „Ablehnen“ ist für Reviewende
auch dann verfügbar, wenn die Protokollliste wegen eines SharePoint-Ausfalls nicht geladen wird.

## Projekte und Vorlagen

Unter „Projekte“ lassen sich Projekte anlegen und mit einer vorhandenen CampFlow-Aktion verknüpfen.
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
von 20 Sekunden. Protokolltext und Modellantworten werden nicht geloggt. Es gibt keine Timer,
Erinnerungen oder neue Function App. Azure Global Standard kann weltweit verarbeiten; die
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

## Ablage und Betrieb

Migration `0005_aufgaben.sql` legt im Schema `organisation` Projekte, Vorlagen, Aufgaben (inklusive
Vorschlagszuständen) und angewendete Checklisten an. Deployments wenden sie vor dem Code an.
Alle Änderungen vergleichen die geladene SQL-rowversion, Konflikte ergeben HTTP 409. Checklisten
und Erkennung werden unter Transaktionssperren gespeichert. SQL und SharePoint haben keine
verteilte Transaktion: Quelldateiprüfungen erfolgen unmittelbar vor dem SQL-Schreibzugriff.
PR-Previews erhalten ausschließlich erfundene Daten für jede Tabelle (`seedPreviewTasks`, Seed 5).
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
