# Aufgaben und persönliche Startseite (#153, #140)

Das Modul `/leitendenbereich/aufgaben` ist die gemeinsame Aufgabenablage für Aktionen und andere
Projekte. Aufgaben haben Titel, Beschreibung, Zuständigkeit (Name oder Stammes-Login), optionale
Fälligkeit und Erledigt-Status. Der persönliche Filter vergleicht den Login, ohne Groß-/Kleinschreibung.
Die Startseite zeigt zuerst die dem eigenen Login zugewiesenen offenen Aufgaben, ansonsten die
nächsten offenen Aufgaben des Stammes. Vorschläge und abgelehnte Vorschläge zählen nicht als offen.

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
