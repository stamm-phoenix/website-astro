import type { ChangelogEntry } from './changelog';

/**
 * Die Neuigkeiten des Leitendenbereichs, die neueste zuerst. Jede Änderung, die Leitende bemerken,
 * bekommt hier einen Eintrag (siehe AGENTS.md, „Changelog“).
 *
 * - `id`: Datum plus Kurzname, z. B. `2026-10-20-neuigkeiten`. Das Datum steht vorn, weil die
 *   Bubble die IDs der Reihe nach vergleicht; eine neue ID ist größer als jede vorherige.
 * - `title`: kurz und konkret, benennt, was Leitende jetzt tun können.
 * - `changes`: ganze Sätze in der Du-Form, ohne Fachwörter. Nenne, was sich für Leitende ändert,
 *   nicht, wie es gebaut ist.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-20-neuigkeiten',
    date: '2026-10-20',
    title: 'Neuigkeiten im Leitendenbereich',
    changes: [
      'Unter „Neuigkeiten“ findest du ab jetzt, was sich im Leitendenbereich geändert hat.',
      'Eine kleine Zahl am Menü und auf der Startseite zeigt dir, wie viele Neuigkeiten du noch nicht gelesen hast.',
      'Wenn du die Neuigkeiten öffnest, gelten sie als gelesen. Das gilt auf allen deinen Geräten.',
      'Geht es um eine bestimmte Seite, etwa ein neues Modul, führt ein Link direkt dorthin.',
    ],
  },
  {
    id: '2026-10-19-wischen-und-beitraege',
    date: '2026-10-19',
    title: 'Wischen, Beiträge und eine neue Seitenleiste',
    changes: [
      'Auf dem Handy wischst du durch Fotos und Instagram-Bilder, ziehst das Menü und Bildansichten nach unten zum Schließen und zoomst Fotos mit zwei Fingern oder Doppeltipp.',
      'Im öffentlichen Kalender wechselst du mit einer Wischbewegung zwischen den Monaten.',
      'Am Computer gibt es eine Seitenleiste mit Suche, die du einklappen kannst. Auf dem Handy liegt eine Leiste mit deinen Favoriten unten am Rand, das Menü „Alle Bereiche“ öffnet sich darüber.',
      'Favoriten setzt du jetzt direkt am Bereich, in der Seitenleiste und im Menü, mit dem Stern oder mit langem Drücken.',
      {
        text: 'Neues Modul „Beiträge“: Es zeigt, wer für welche Aktion bezahlt hat. In der Teilnehmendenliste einer Aktion siehst du Beitrag, Zahlungsstand und Verwendungszweck, den du mit einem Klick kopierst.',
        href: '/leitendenbereich/beitraege',
      },
      'Du kannst CampFlow-Veranstaltungen, die keine echte Aktion sind (zum Beispiel Pulli-Bestellungen), als „Keine Aktion“ markieren. Sie verschwinden dann aus den Aktionslisten.',
      'Mit „Zum Inhalt springen“ überspringen Tastaturnutzende jetzt auch die Seitenleiste.',
    ],
  },
  {
    id: '2026-10-18-navigation-und-entwuerfe',
    date: '2026-10-18',
    title: 'Neue Leiste, Berliner Zeit und sicherere Entwürfe',
    changes: [
      'Der Leitendenbereich hat eine neue Navigation: unten eine Leiste mit deinen wichtigsten Bereichen, dazu „Alle Bereiche“ mit Suche statt des Burger-Menüs. Zuletzt genutzte Bereiche bietet dir die Leiste ebenfalls an.',
      'Alle Datums- und Uhrzeitangaben richten sich nach der Berliner Zeit, auch rund um den Jahreswechsel.',
      'Wenn deine Anmeldung abläuft oder jemand anderes dasselbe bearbeitet hat, bleiben deine Eingaben erhalten. Du lädst bewusst die aktuelle Fassung nach und musst nichts neu tippen.',
      'Bei technischen Problemen nennen alle Fehlermeldungen jetzt admin@stamm-phoenix.de.',
      'Im Protokoll-Editor erscheinen offene Aufgaben und Projekte an den Tagesordnungspunkten. Beim Freigeben werden die Aufgaben übernommen, und das Abhaken in einem Protokoll wird mit dem Aufgabenmodul abgeglichen.',
      'Antworten in Fragen & Antworten dürfen anklickbare Links enthalten.',
    ],
  },
  {
    id: '2026-10-17-textfelder',
    date: '2026-10-17',
    title: 'Ein Editor für alle Textfelder',
    changes: [
      'Alle längeren Textfelder (Blog, Protokolle, Beschreibungen) nutzen denselben Editor mit Überschriften, Listen, Tabellen und Checklisten.',
      'Im Protokoll wählst du, ob du formatiert oder in Markdown schreibst. Deine Wahl gilt auf allen Geräten.',
      'Die Tagesordnung eines Protokolls ist ein einziges Dokument. Du kannst Punkte darin verschieben, kopieren und mit Rückgängig zurücknehmen.',
      'Breite Tabellen sagen dir, dass sie seitlich scrollen. Checklisten-Kästchen lassen sich auf dem Handy gut treffen.',
    ],
  },
  {
    id: '2026-10-16-fotos-und-nikolaus',
    date: '2026-10-16',
    title: 'Fotos, Protokoll-Versand und ein klarerer Nikolausdienst',
    changes: [
      {
        text: 'Neues Modul „Fotos“: Du stöberst in der Fotobibliothek, lädst Bilder oder ganze Ordner als ZIP herunter und lädst eigene Fotos hoch. Auf dem Handy zoomst du Bilder und wischst durch sie.',
        href: '/leitendenbereich/fotos',
      },
      'Der Versand von Protokollen zeigt dir die Empfängerliste mit dem Grund jeder Adresse. Du kannst Adressen herausnehmen oder ergänzen. Mitglieder mit dem CampFlow-Label „Protokollempfang“ bekommen das Protokoll automatisch.',
      'Alle Leitenden dürfen Protokolle prüfen. Die Prüfung ist freiwillig.',
      'Beim Nikolausdienst sind viele Texte verständlicher geworden: Planungsmerkmale heißen jetzt „Merkmale“, Teams und Besuche werden in Worten gezählt, und ein Besuch dauert höchstens 45 Minuten.',
      'Familien sehen ab zwei Stunden vor dem Besuch gut sichtbar den Notfallkontakt.',
      'In der Einteilung werden fertige Teams zuerst besetzt. Du kannst andere Teamzahlen ausprobieren und siehst, warum eine Zahl nicht geht.',
      'Ein Blogbeitrag trennt Entwurf und Veröffentlichung deutlich. Bei Gruppenstunden liegt „Löschen“ unter „Weitere Aktionen“.',
      'Auf dem Handy lassen sich Filter und Tagesüberblick der Nikolausmodule einklappen.',
      'Die Sammelbestellungen, Gruppenstunden, Leitenden, Aktionen, Belege, Downloads und Favoriten liegen jetzt in einer eigenen Datenbank statt in SharePoint-Listen. Für dich ändert sich dadurch nichts.',
    ],
  },
  {
    id: '2026-10-15-hilfe-und-ablauf',
    date: '2026-10-15',
    title: 'Mehr Hilfe bei Fehlern und weniger verlorene Eingaben',
    changes: [
      'Fehlermeldungen sagen dir, was nicht geklappt hat, ob etwas gespeichert wurde und wen du ansprechen kannst. Die Hilfe-Adressen sind direkt anklickbar.',
      'Läuft deine Anmeldung ab, öffnet sich die neue Anmeldung in einem neuen Tab, und dein Entwurf bleibt in der alten Seite stehen.',
      'Wenn du eine Seite mit ungespeicherten Änderungen verlässt, fragt der Leitendenbereich mit einem eigenen Fenster nach.',
      'Die Abrechnung merkt sich deine Eingaben pro Aktion auf dem Gerät und löscht sie einen Monat nach der KJR-Frist.',
      'Ansichten und Filter heißen überall gleich und zeigen ihren Namen. Auswahlleisten sind auf dem Handy groß genug zum Antippen.',
      'Aktionen ohne KJR-Zuschuss lassen sich markieren. Im Protokoll-Editor sortierst du Tagesordnungspunkte per Ziehen und trägst Beginn und Ende ein.',
      'In der Anwesenheit steht jetzt, dass Häkchen sofort gespeichert werden.',
    ],
  },
  {
    id: '2026-10-14-startseite-und-protokolle',
    date: '2026-10-14',
    title: 'Neue Startseite, Protokoll-Editor und Aufgaben im Menü',
    changes: [
      'Die Startseite ist kompakter. Die Bereiche sind nach dem sortiert, was Leitende dort tun: Leitendenrunde, Gruppen & Aktionen, Kasse & Material und Website pflegen.',
      'Im Kopf jeder Seite findest du Menü, Abmelden und Hilfe-Adressen. Der Abmelden-Knopf fragt vorher nach.',
      {
        text: 'Du schreibst die Protokolle der Leitendenrunde direkt im Protokoll-Editor, mit Terminen, Markdown, Vorschau und Personenauswahl. Das Protokoll wird als PDF mit Deckblatt und Inhaltsverzeichnis abgelegt, geprüft und verschickt.',
        href: '/leitendenbereich/protokolle',
      },
      'Mit der Präsentation zeigst du ein Protokoll groß und gut lesbar auf dem Fernseher oder in der Bildschirmfreigabe.',
      'Die Anwesenheit hat ein eigenes Symbol. Dialoge und Seitenwechsel fragen nach, bevor ungespeicherte Eingaben verloren gehen, und die Einteilung des Nikolausdienstes fragt vor dem Wechsel der Ansicht.',
      'Alle Lade- und Fehlerzustände sehen gleich aus und bieten „Erneut versuchen“ an.',
      'Das Modul „Mitschriften“ ist wieder entfernt.',
    ],
  },
  {
    id: '2026-10-12-aufgaben',
    date: '2026-10-12',
    title: 'Aufgaben für die Leitendenrunde',
    changes: [
      {
        text: 'Neues Modul „Aufgaben“: Du verteilst Aufgaben an mehrere Personen, behältst Fristen im Blick und hakst Erledigtes ab. Aufgaben gibt es als Liste und als Kanban.',
        href: '/leitendenbereich/aufgaben',
      },
      'Personen wählst du mit Namensvorschlägen aus. Aufgaben und Projekte bündeln Vorhaben, Vorlagen helfen bei wiederkehrenden Aktionen.',
      'Aus Protokollen schlägt der Leitendenbereich Aufgaben vor, die du prüfst und übernimmst. Vergangene Fristen werden dabei nicht vorgeschlagen.',
      'Du bekommst auf Wunsch Erinnerungen per E-Mail an deine Aufgaben. Auf der Startseite siehst du deine eigenen offenen Aufgaben.',
      'Wer sich für den Nikolausdienst anmeldet oder einen Link für eine Sammelbestellung anfordert, bestätigt dafür eine kurze Sicherheitsabfrage ohne Cookies.',
      'Die Seite „Abrechnung“ warnt, wenn du zu viele Betreuende einträgst.',
    ],
  },
  {
    id: '2026-10-11-werkzeuge',
    date: '2026-10-11',
    title: 'Eigenbeleg, QR-Code und KJR-Fristen',
    changes: [
      {
        text: 'Der Eigenbeleg-Generator erstellt für Ausgaben ohne Originalbeleg ein PDF auf dem Briefpapier des Stammes.',
        href: '/leitendenbereich/eigenbeleg',
      },
      {
        text: 'Der QR-Code-Generator macht aus jedem Text einen QR-Code, auf Wunsch mit dem Phoenix oder der Lilie in der Mitte.',
        href: '/leitendenbereich/qr-code',
      },
      {
        text: 'In der Abrechnung öffnest du Einzelnachweise und änderst ihren Betrag für die aktuelle Sitzung.',
        href: '/leitendenbereich/abrechnung',
      },
      'Auf der Startseite stehen die KJR-Fristen vergangener Aktionen.',
      {
        text: 'Aufgaben liegen jetzt auch als Kanban-Tafel vor, und die Startseite zeigt deine eigenen Aufgaben. Mehr dazu steht im Eintrag vom 12. Oktober.',
        href: '/leitendenbereich/aufgaben',
      },
    ],
  },
  {
    id: '2026-10-08-anwesenheit-und-fahrten',
    date: '2026-10-08',
    title: 'Anwesenheit und Fahrten planen',
    changes: [
      {
        text: 'Neues Modul „Anwesenheit“: Du hakst bei jeder Gruppenstunde ab, wer da ist. Die Liste zeigt nur aktuelle CampFlow-Mitglieder, und vergangene Termine behalten ihren Namen im Verlauf.',
        href: '/leitendenbereich/anwesenheit',
      },
      {
        text: 'Neues Modul „Fahrten“: Du planst Fahrgemeinschaften für Aktionen. Leitende, die Plätze anbieten, fahren selbst, Geschwister und Leitende sitzen möglichst zusammen, und von Hand gesetzte Personen bleiben an ihrem Platz.',
        href: '/leitendenbereich/aktionen/fahrten',
      },
      'Fällt CampFlow aus, bekommst du eine klare Meldung statt einer Fehlerseite.',
      'Nikolausdienst, Blog und Fragen & Antworten liegen jetzt in einer Datenbank. Der Betrieb ist für dich unverändert.',
    ],
  },
  {
    id: '2026-10-07-protokolle-und-steuerung',
    date: '2026-10-07',
    title: 'Protokolle und Steuerung des Nikolausdienstes',
    changes: [
      {
        text: 'Neues Modul „Protokolle“: Du legst Protokolle aus der Word-Vorlage an, prüfst sie, gibst sie frei und schickst sie an alle Leitenden. Eine Vorschau zeigt das Protokoll, bevor es rausgeht.',
        href: '/leitendenbereich/protokolle',
      },
      'Das Datum der nächsten Leitendenrunde erkennt der Leitendenbereich selbst aus freigegebenen Protokollen. Du bestätigst oder lehnst es ab.',
      {
        text: 'Den Nikolausdienst steuerst du jetzt selbst unter „Steuerung“: Besuchstage und Zeiten, Anmeldung, Wartungsmodus und das Löschen der Daten nach der Saison.',
        href: '/leitendenbereich/nikolaus-steuerung',
      },
      'Blogbeiträge und Fragen & Antworten hast du jetzt auch auf der Website zum Bearbeiten: Angemeldete Leitende sehen dort Links zum Anlegen und Bearbeiten.',
    ],
  },
  {
    id: '2026-10-06-design-und-kontakt',
    date: '2026-10-06',
    title: 'Helles und dunkles Design, Kontaktformular',
    changes: [
      'Die Website und der Leitendenbereich gibt es in einem hellen und einem dunklen Design. Ein Schalter in der Kopfzeile wechselt das Design, und deine Wahl bleibt erhalten.',
      'Die Seite „Kontakt“ hat ein Formular. Du bekommst eine Eingangsbestätigung, und es meldet, wenn die Bestätigungsmail nicht ankam.',
      'Ergebnisse von Aktionen erscheinen zusätzlich in einem Popup, wenn die Meldung nicht im Bild ist. Dazu gehören das Hinzufügen von Artikeln, Bildern im Blog und Personen in der Abrechnung.',
      'Die Datenschutzerklärung nennt jetzt Rechtsgrundlage, Löschfristen und Datenschutzbeauftragte.',
      'Die Website lädt schneller, weil Bilder und Schriften kleiner sind.',
    ],
  },
  {
    id: '2026-10-05-abrechnung-und-kalender',
    date: '2026-10-05',
    title: 'Abrechnung und Kalender mit Monatsansicht',
    changes: [
      {
        text: 'Neues Modul „Abrechnung“: Du rechnest eine Aktion ab, mit Teilnehmenden- und Nachweisliste, Materialleihgebühren, Deckblatt und Belegen als PDF. Die KJR-Teilnahmeliste lädst du herunter, bezuschusst werden nur Teilnehmende aus dem Landkreis.',
        href: '/leitendenbereich/abrechnung',
      },
      'Postleitzahl und Wohnort der Teilnehmenden kommen aus CampFlow und lassen sich korrigieren. Einträge gehen nicht verloren, wenn du die Seite verlässt, ohne zu speichern.',
      'CampFlow-Aktionen erscheinen im öffentlichen Kalender. Vorab angelegte Einträge verknüpfst du später mit CampFlow, die Stufen werden aus den CampFlow-Gruppen vorbelegt.',
      'Der Kalender hat Januar bis Dezember, eine Monatsansicht (auch öffentlich), mehrtägige Aktionen als durchgehende Balken und ein ICS-Abo für dein Kalenderprogramm.',
      'Der Nikolausdienst funktioniert unterwegs auch ohne Netz: Routen und Haken bleiben auf dem Gerät und werden später abgeglichen.',
    ],
  },
  {
    id: '2026-10-02-belege',
    date: '2026-10-02',
    title: 'Kassenbelege einreichen',
    changes: [
      {
        text: 'Neues Modul „Belege“: Du fotografierst einen Kassenbeleg und reichst ihn ein. Die Kasse prüft ihn und überträgt angenommene Belege nach CampFlow.',
        href: '/leitendenbereich/belege',
      },
      'Eine Scan-Funktion macht aus dem Foto ein lesbares Bild. Eine automatische Vorprüfung meldet Auffälliges wie Alkohol, Tabak oder nicht jugendfreie Artikel, bevor die Kasse entscheidet.',
    ],
  },
  {
    id: '2026-10-01-sammelbestellungen',
    date: '2026-10-01',
    title: 'Sammelbestellungen',
    changes: [
      {
        text: 'Neues Modul „Sammelbestellungen“: Du sammelst Rüsthaus-Bestellungen, lädst Mitglieder ein und exportierst die Bestellliste.',
        href: '/leitendenbereich/sammelbestellungen',
      },
      'Häufig bestellte Artikel des Stammes stehen schon im Katalog. Abgeschlossene Bestellungen zeigen eine kompakte Ansicht.',
      'Zahlungen verfolgst du per Hand oder über CampFlow. Der Zuschuss für Aktionen wird mit der Kostenstelle der Sammlung verbucht.',
    ],
  },
  {
    id: '2026-09-30-fragen-und-antworten',
    date: '2026-09-30',
    title: 'Fragen und Antworten bearbeiten',
    changes: [
      {
        text: 'Die Fragen und Antworten der Website pflegst du jetzt im Leitendenbereich.',
        href: '/leitendenbereich/fragen-und-antworten',
      },
      'Einträge haben einen Status: Entwürfe sind nur für Leitende sichtbar, veröffentlichte Einträge für alle.',
      'Der Nikolausdienst vergleicht die Stufen der Helfenden mit CampFlow.',
    ],
  },
  {
    id: '2026-09-29-blog-und-instagram',
    date: '2026-09-29',
    title: 'Blog und Instagram auf der Startseite',
    changes: [
      {
        text: 'Neues Modul „Blog“: Du schreibst Beiträge mit Bildern und veröffentlichst sie. Blog und Instagram erscheinen gemeinsam als „Neues aus dem Stamm“ auf der Startseite, die Beiträge öffnen sich in einem Fenster.',
        href: '/leitendenbereich/blog',
      },
      'Instagram-Karussells blätterst du durch, und Reels spielen auf der Seite. Vorher fragt die Website nach, weil dabei Daten an Instagram gehen.',
      'Blogbeiträge ohne Titelbild zeigen mehr Text statt eines Platzhalters.',
      'Die Nikolaus-Schalter für den Leitendenbereich und die öffentlichen Seiten lassen sich getrennt umlegen.',
    ],
  },
  {
    id: '2026-09-28-nikolaus-planen',
    date: '2026-09-28',
    title: 'Nikolausdienst planen und abfahren',
    changes: [
      {
        text: 'Neues Modul „Dispo“: Du verteilst die Termine eines Tages auf die Teams. Die Karte zeigt die Routen entlang der Straßen.',
        href: '/leitendenbereich/nikolaus-dispo',
      },
      {
        text: 'Neues Modul „Helfende“: Du trägst Helfende mit ihren Posten ein und teilst sie auf Teams auf. Die Einteilung ist als lesbare Liste gespeichert.',
        href: '/leitendenbereich/nikolaus-helfende',
      },
      {
        text: 'Neues Modul „Route“: Dein Team fährt die Route ab und hakt Besuche ab. Die Dispo sieht den Stand sofort.',
        href: '/leitendenbereich/nikolaus-fahrt',
      },
      'Familien sehen eine Sendungsverfolgung zu ihrem Besuch und nach dem Besuch einen Hinweis auf die Löschung ihrer Daten und das nächste Jahr.',
      'Die Anmeldung für einen Tag schließt um Mitternacht des Tages. Der Nikolausdienst hat einen eigenen Abschnitt auf der Startseite.',
    ],
  },
  {
    id: '2026-09-25-leitendenbereich',
    date: '2026-09-25',
    title: 'Der Leitendenbereich startet',
    changes: [
      'Der Leitendenbereich ist online. Du meldest dich mit deinem Konto des Stammes an, andere kommen nicht hinein.',
      {
        text: 'Die Nikolaus-Anmeldungen siehst du als Liste oder Matrix. Du kannst Familien schreiben, Termine verlegen und Anmeldungen absagen. Überbuchte Termine werden markiert.',
        href: '/leitendenbereich/nikolaus',
      },
      {
        text: 'Das Modul „CampFlow-Aktionen“ zeigt die Aktionen aus CampFlow, ohne etwas zu ändern.',
        href: '/leitendenbereich/aktionen',
      },
      {
        text: 'Gruppenstunden, Leitende, Vorstand und Downloads der Website pflegst du direkt hier. Kontaktdaten gibt es nur für den Vorstand.',
        href: '/leitendenbereich/gruppenstunden',
      },
    ],
  },
];
