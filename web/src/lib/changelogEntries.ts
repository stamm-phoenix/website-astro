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
    id: '2026-10-29-04-essensplanung-teilnehmende',
    date: '2026-10-29',
    title: 'Essensplanung: Teilnehmende und Esser je Mahlzeit',
    changes: [
      'Im neuen Bereich Teilnehmende tragt ihr ein, wie viele aus welcher Gruppe mitessen, mit Ernährung, Unverträglichkeiten und ab bzw. bis zu welcher Mahlzeit sie da sind. Die Gruppen mit ihrem Faktor kommen aus der Vorlage und lassen sich anpassen.',
      'An jeder Mahlzeit legt ihr mit „Wer isst mit?“ fest, welche Gruppen dort nicht essen. Eine Tabelle zeigt für jede Mahlzeit, wie viele Personen und Portionen es sind, auch nach Ernährung.',
    ],
  },
  {
    id: '2026-10-29-03-essensplanung-umrechnung',
    date: '2026-10-29',
    title: 'Essensplanung: Löffel und Stück in Gramm umrechnen',
    changes: [
      'Fügt ihr einem Gericht eine Zutat in Gramm hinzu, rechnet der Dialog Teelöffel, Esslöffel oder Stück in Gramm um, etwa 2 EL Butter ≈ 30 g, und trägt das Ergebnis auf Wunsch als Menge ein.',
    ],
  },
  {
    id: '2026-10-29-02-essensplanung-einplanung',
    date: '2026-10-29',
    title: 'Essensplanung: Gerichte an Mahlzeiten einplanen',
    changes: [
      'Im Plan setzt ihr eure Gerichte jetzt an Mahlzeiten, mit Faktor (z. B. 0,5, wenn nur die Hälfte Nachtisch isst) und wer zuständig ist. Gerichte lassen sich zwischen Mahlzeiten verschieben, kopieren und sortieren.',
      'Der gedruckte Plan zeigt die Gerichte unter jeder Mahlzeit; an jedem Gericht seht ihr, wo es eingeplant ist.',
    ],
  },
  {
    id: '2026-10-29-01-essensplanung-gerichte',
    date: '2026-10-29',
    title: 'Essensplanung: Gerichte mit Zutaten',
    changes: [
      'In einer Planung legt ihr jetzt Gerichte an: Zutaten aus der Zutatenliste mit Menge und Einheit, für wen eine Zutat gilt (mit allem, vegetarisch, vegan, Unverträglichkeiten), Anleitung, Werkzeuge und Links. Fehlt eine Zutat in der Liste, legt ihr sie für eure Planung an.',
      'Die Seite warnt, wenn etwa Hackfleisch für Vegetarier:innen gedacht ist oder eine Ernährungsform kein Essen bekommt. Jedes Gericht lässt sich als Rezeptkarte drucken.',
    ],
  },
  {
    id: '2026-10-28-06-essensplanung-planungen',
    date: '2026-10-28',
    title: 'Essensplanung: Planungen anlegen und gemeinsam planen',
    changes: [
      'Unter stamm-phoenix.de/essensplanung legt ihr eine Planung für eine Aktion an, mit Tagen und Mahlzeiten. Ihr braucht dafür kein Konto: Ihr bekommt einen Link per Mail und ladet euer Küchenteam per Mail oder mit einem gemeinsamen Link ein. Änderungen der anderen seht ihr nach wenigen Sekunden.',
      'Gerichte, Einkaufsliste und Einkäufe folgen in den nächsten Schritten.',
      {
        text: 'In der Steuerung sehen Admins und Vorstand jetzt alle Planungen und wann sie gelöscht werden.',
        href: '/leitendenbereich/essensplanung-steuerung',
      },
    ],
  },
  {
    id: '2026-10-28-05-einteilung-bild',
    date: '2026-10-28',
    title: 'Nikolaus-Einteilung als Bild für die Gruppe',
    changes: [
      {
        text: 'In der Einteilung der Nikolaus-Helfenden ersetzt „Bild exportieren“ das Drucken. Du bekommst ein kompaktes Bild mit allen Tagen, Teams und der Küche, das du z. B. in die WhatsApp-Gruppe posten kannst. Am Handy öffnet sich dafür gleich das Teilen-Menü.',
        href: '/leitendenbereich/nikolaus-helfende',
      },
    ],
  },
  {
    id: '2026-10-28-04-problemmeldungen',
    date: '2026-10-28',
    title: 'Neu: Problemmeldungen der Website sichten',
    changes: [
      {
        text: 'Besuchende können über „Problem melden“ im Footer und bei Fehleranzeigen ein Problem der Website melden. Im neuen Bereich „Problemmeldungen“ siehst du jede Meldung mit den technischen Angaben und einer automatischen Einschätzung, ob sie plausibel oder Spam ist.',
        href: '/leitendenbereich/problemmeldungen',
      },
      'Du entscheidest, was mit einer Meldung passiert: Du kannst den Entwurf für GitHub bearbeiten und die Meldung verwerfen oder an GitHub senden. Vorher siehst du, was auf GitHub landet. Ohne dein „An GitHub senden“ entsteht dort nichts.',
      'Die Mail-Adresse für Rückfragen bleibt bei der Meldung und geht nicht nach GitHub. Verworfene Meldungen werden nach 30 Tagen gelöscht, an GitHub gesendete nach 90 Tagen, offene nach 180 Tagen.',
      '„Problem melden“ findest du auch im Leitendenbereich, im Fußbereich und bei Fehleranzeigen.',
      'In der Detailansicht siehst du, wer eine Meldung zuletzt bearbeitet hat und wann.',
    ],
  },
  {
    id: '2026-10-28-03-essensplanung-steuerung',
    date: '2026-10-28',
    title: 'Essensplanung: Steuerung für Admins und Vorstand',
    changes: [
      {
        text: 'Für die kommende Essensplanung gibt es eine Steuerung. Admins und Vorstand legen dort fest, ob auch Menschen außerhalb des Stammes Planungen anlegen dürfen, mit welchen Gruppen und Mahlzeiten eine neue Planung startet und wie lange Planungen aufbewahrt werden.',
        href: '/leitendenbereich/essensplanung-steuerung',
      },
      'Dort pflegt ihr auch die Zutatenliste, die alle Planungen teilen. Sie startet mit über 400 Zutaten aus der Küche des Bezirkslagers. Ob eine Zutat vegetarisch oder vegan ist und welche Allergene sie enthält, ist vorerst nur ein Vorschlag: Prüft die Einträge mit dem Filter „Nur ungeprüfte“ und hakt sie als geprüft ab.',
    ],
  },
  {
    id: '2026-10-28-02-kurzbeschreibung',
    date: '2026-10-28',
    title: 'Abrechnung: Kurzbeschreibung für den KJR',
    changes: [
      {
        text: 'Die Abrechnung einer Aktion hat einen neuen Bereich „Kurzbeschreibung“. Dort schreibst du die Zielsetzung der Aktion und einen groben Zeitplan und lädst beides als PDF auf dem Briefpapier des Stammes für den Antrag beim KJR herunter.',
        href: '/leitendenbereich/abrechnung',
      },
      'Die Tage der Aktion sind schon angelegt. Zeitblöcke fügst du einzeln oder mit „Mehrere Zeilen einfügen“ auf einmal hinzu (z. B. „8-9 Uhr Frühstück“), übernimmst den Ablauf vom Vortag, sortierst nach Uhrzeit und verschiebst Blöcke mit den Pfeilen oder mit der Maus, auch auf einen anderen Tag.',
      'Hast du den Zeitplan schon als Foto, PDF oder Excel-Tabelle, trägt „Aus Datei übernehmen“ ihn für dich ein. Prüfe die Blöcke danach.',
      'Oder du beschreibst den Ablauf mit „In eigenen Worten beschreiben“ als Text. Daraus werden einmal Zielsetzung und Zeitplan erstellt, die du anschließend wie gewohnt anpasst.',
      'Die Kurzbeschreibung gehört zu deinen Eingaben der Abrechnung und wird mit „Eingaben speichern“ gesichert.',
    ],
  },
  {
    id: '2026-10-28-01-belege-einnahmen-pdf',
    date: '2026-10-28',
    title: 'Belege: Einnahmen und PDFs einreichen',
    changes: [
      {
        text: 'Du kannst jetzt auch Einnahmen einreichen, etwa eine Spende oder bar eingenommene Beiträge: Wähle beim Einreichen „Einnahme“. Die Frage, wie bezahlt wurde, fällt dann weg, und die Kasse überträgt den Beleg als Einnahme nach CampFlow.',
        href: '/leitendenbereich/belege',
      },
      'Statt eines Fotos kannst du auch ein PDF hochladen, zum Beispiel eine Rechnung, die du per Mail bekommen hast (höchstens 5 MB). Die erste Seite wird als Vorschau gezeigt, nach CampFlow geht das ganze PDF.',
    ],
  },
  {
    id: '2026-10-26-03-beitraege-erstatten',
    date: '2026-10-26',
    title: 'Beiträge: „zu erstatten“ statt „zu viel bezahlt“',
    changes: [
      {
        text: 'Wurde ein Beitrag nach dem Bezahlen gesenkt, steht er in „Meine Beiträge“ jetzt als „… bekommst du zurück“ statt „zu viel bezahlt“. Du musst dafür nichts tun, die Kasse erstattet dir den Unterschied.',
        href: '/leitendenbereich',
      },
      {
        text: 'In der Liste der Beiträge heißt derselbe Status jetzt „… zu erstatten“, passend zum Filter „Zu erstatten“.',
        href: '/leitendenbereich/beitraege',
      },
    ],
  },
  {
    id: '2026-10-26-02-kostenstellen',
    date: '2026-10-26',
    title: 'Neu für Kasse und Vorstand: Kostenstellen',
    changes: [
      // No link: most Leitende may not open the page
      'Im neuen Bereich „Kostenstellen“ siehst du alle Kostenstellen aus CampFlow mit Einnahmen, Ausgaben und Saldo, und darunter dieselben Summen für jede Kategorie. Offene Beträge, etwa unbezahlte Beiträge oder noch nicht erstattete Auslagen, stehen dabei.',
      'Du kannst nach Kostenstelle oder Kategorie suchen, archivierte Kostenstellen dazunehmen, ein Jahr wählen (dann siehst du nur Kostenstellen mit Buchungen aus diesem Jahr, und alle Beträge gelten für dieses Jahr) und nach den höchsten Ausgaben oder Einnahmen sortieren. Ändern geht weiterhin in CampFlow.',
      'Den Bereich sehen nur die Kasse und der Vorstand.',
    ],
  },
  {
    id: '2026-10-26-01-belege-kostenstelle',
    date: '2026-10-26',
    title: 'Belege: Kostenstelle und Kategorie statt Aktion',
    changes: [
      {
        text: 'Beim Einreichen eines Belegs wählst du jetzt Kostenstelle und Kategorie wie in CampFlow, statt eine Aktion anzugeben. So geht auch Verpflegung für die Leitendenrunde, die zu keiner Aktion gehört.',
        href: '/leitendenbereich/belege',
      },
      'Im Feld „Kostenstelle“ suchst du Kostenstellen und Kategorien zugleich: Tippst du z. B. „leite“, bekommst du die Kostenstelle „Leitendenlager“ und die Kategorie „Leitendenrunde“ in „Allgemein“ angeboten. Eine Kategorie füllt beide Felder aus. Gibt es eine Kategorie in vielen Kostenstellen, grenzt du mit einem weiteren Wort ein, z. B. „verpflegung stammes“.',
      'Die Kategorien des KJR (Fahrtkosten, Verpflegungskosten, Miet- und Übernachtungskosten, Honorare, Arbeits- und Hilfsmittel) stehen bei jeder Kostenstelle zur Auswahl, auch wenn es sie dort noch nicht gibt.',
      'Du kannst Kostenstelle und Kategorie auch frei eintippen. Gibt es sie in CampFlow noch nicht, siehst du einen Hinweis; die Kasse legt sie beim Übertragen nach CampFlow automatisch an.',
    ],
  },
  {
    id: '2026-10-25-02-abstimmungen',
    date: '2026-10-25',
    title: 'Neu: Abstimmungen und Terminfindung',
    changes: [
      {
        text: 'Im neuen Bereich „Abstimmungen“ findest du Termine oder lässt über Vorschläge abstimmen, ähnlich wie bei Doodle oder einer Umfrage in WhatsApp. Trag Termine über den Kalender ein oder schreib beliebige Optionen hin, und leg fest, wie viele man wählen kann.',
        href: '/leitendenbereich/abstimmungen',
      },
      'Mit „Per Mail einladen“ lädst du die Leitendenrunde und alle mit dem Merkmal „Protokollempfang“ auf Knopfdruck ein, so wie beim Protokollversand; weitere Personen und Adressen kannst du dazunehmen. Jede Person bekommt ihren eigenen Link und kann ohne Anmeldung abstimmen und ihre Antwort später ändern.',
      'Über den Link für alle können auch Gäste mitmachen: Sie tragen nur ihren Namen ein.',
      'Wenn du es erlaubst, kann man bei jeder Option auch „Vielleicht“ sagen.',
      'Du legst fest, wer sieht, wer was gewählt hat: alle, die abstimmen, oder nur du. Dann sehen die anderen nur, wer abgestimmt hat, oder auf Wunsch keine Namen. Die Stimmen je Option sehen dann alle, sobald mindestens drei abgestimmt haben.',
      'Unter „Tabelle“ siehst du auf einen Blick, wer welche Option gewählt hat.',
      'Mit „An Abstimmung erinnern“ bekommen alle Eingeladenen, die noch nicht abgestimmt haben, eine Erinnerung. Wenn alles entschieden ist, beendest du die Abstimmung; das Ergebnis bleibt sichtbar.',
    ],
  },
  {
    id: '2026-10-25-01-meine-beitraege',
    date: '2026-10-25',
    title: 'Startseite: deine offenen Beiträge',
    changes: [
      {
        text: 'Unter „Für dich“ zeigt die neue Box „Meine Beiträge“ deine Beiträge aus CampFlow, bei denen noch etwas zu tun ist: noch nicht oder nur teilweise bezahlt, oder zu viel bezahlt, sodass du Geld zurückbekommst. Ein Klick auf den Verwendungszweck kopiert ihn für deine Überweisung.',
        href: '/leitendenbereich',
      },
      {
        text: 'Ob ein Beitrag deiner ist, erkennt die Seite an deiner Verknüpfung im Modul „Personen“, ohne Verknüpfung an deinem Namen.',
        href: '/leitendenbereich/personen',
      },
    ],
  },
  {
    id: '2026-10-24-04-startseite-bereiche',
    date: '2026-10-24',
    title: 'Deine Startseite',
    changes: [
      {
        text: 'Neuigkeiten stehen auf der Startseite direkt oben; „Deine Bereiche“ zeigt nur deine Favoriten und zuletzt besuchten Bereiche.',
        href: '/leitendenbereich',
      },
    ],
  },
  {
    id: '2026-10-24-03-belege-kasse-mail',
    date: '2026-10-24',
    title: 'Belege: Mail an die Kasse bei neuen Belegen',
    changes: [
      {
        text: 'Reichst du einen Beleg ein, bekommt jede Person im Team „Kasse“ eine Mail an ihre @stamm-phoenix.de-Adresse mit Geschäft, Datum, Betrag, Aktion und einem Button zu den Belegen. Das gilt auch, wenn du einen abgelehnten Beleg korrigiert erneut einreichst. So muss die Kasse nicht mehr selbst nachsehen, ob etwas Neues da ist.',
        href: '/leitendenbereich/belege',
      },
      'Lehnt die Kasse einen Beleg ab, bekommst du jetzt auch wirklich die Mail mit dem Grund.',
    ],
  },
  {
    id: '2026-10-24-02-fotos-link-benachrichtigung',
    date: '2026-10-24',
    title: 'Fotos: Link zum Ordner und Leitende benachrichtigen',
    changes: [
      {
        text: 'In jedem Ordner der Fotos kopiert „Link kopieren“ einen Link, der genau diesen Ordner öffnet. So kannst du ihn zum Beispiel im Chat teilen.',
        href: '/leitendenbereich/fotos',
      },
      'Nach dem Hochladen kannst du mit „Leitende benachrichtigen“ eine Mail an die Leitendenrunde schicken: Sie nennt, wie viele neue Fotos du in welchen Ordner hochgeladen hast, zeigt ein paar kleine Vorschaubilder und hat einen Button, der den Ordner öffnet. Die Mail geht wie das Protokoll an die Leitenden und alle mit dem Merkmal „Protokollempfang“. Du kannst Personen herausnehmen, weitere aus dem Modul „Personen“ auswählen, zum Beispiel Altleitende, oder jede andere Adresse eintragen.',
    ],
  },
  {
    id: '2026-10-24-01-mitglieder',
    date: '2026-10-24',
    title: 'Mitgliederliste aus CampFlow ansehen',
    changes: [
      {
        text: 'Im neuen Modul „Mitglieder“ siehst du alle Mitglieder aus CampFlow, sortiert nach Gruppen wie Wölflinge, Rover oder Leiter*innen. Du kannst nach Name, Mitgliedsnummer oder E-Mail suchen und mit einem Tipp auf ein Mitglied seine Angaben wie Adresse, Telefon und Geburtsdatum nachschlagen.',
        href: '/leitendenbereich/mitglieder',
      },
      'Ausgetretene Mitglieder findest du unter „Ausgetreten“. Ändern, aufnehmen und austragen geht weiterhin nur in CampFlow.',
    ],
  },
  {
    id: '2026-10-23-02-vorschlaege',
    date: '2026-10-23',
    title: 'Vorschläge beim Tippen, auch auf dem Handy',
    changes: [
      'Felder mit Vorschlägen zeigen ihre Liste jetzt direkt unter dem Feld, auch auf dem Handy. Die Liste findet dein Wort an jeder Stelle, egal ob groß oder klein geschrieben, und hebt es hervor. Du wählst per Tippen oder mit Pfeiltasten und Enter. Was nicht in der Liste steht, kannst du weiterhin einfach eintippen.',
      {
        text: 'Bei den Belegen schlagen „Ausgelegt von“ die Personen und „Aktion“ die Aktionen vor.',
        href: '/leitendenbereich/belege',
      },
      {
        text: 'Im Eigenbeleg schlägt „Aktion oder Zweck“ die Aktionen vor.',
        href: '/leitendenbereich/eigenbeleg',
      },
      {
        text: 'Bei Fragen & Antworten schlägt das Feld „Thema“ die vorhandenen Themen vor.',
        href: '/leitendenbereich/fragen-und-antworten',
      },
      {
        text: 'Im Nikolausdienst schlagen die Felder für Merkmale die schon vergebenen Merkmale vor.',
        href: '/leitendenbereich/nikolaus',
      },
      'In der Sammelbestellung schlägt die Variante eines Artikels die Varianten aus dem Katalog vor.',
    ],
  },
  {
    id: '2026-10-23-01-belege-erstattet',
    date: '2026-10-23',
    title: 'Belege: Erstattungsdatum und kürzere Liste „Meine Belege“',
    changes: [
      {
        text: 'Bei Belegen aus CampFlow steht jetzt, wann sie erstattet oder bezahlt wurden, z. B. „Erstattet am 25.06.2026“, in der Liste, in der Galerie und in den Details.',
        href: '/leitendenbereich/belege',
      },
      '„Meine Belege“ auf der Startseite zeigt nur noch Belege, die noch nicht erstattet sind, und die in den letzten 30 Tagen erstatteten. Ältere findest du in den Belegen mit „Nur meine Belege“.',
    ],
  },
  {
    id: '2026-10-22-01-teams',
    date: '2026-10-22',
    title: 'Zugang über die Teams in Microsoft Teams, Belege freigeben nur für die Kasse',
    changes: [
      'Der Leitendenbereich ist jetzt nur noch für Mitglieder des Teams „Leitende“ in Microsoft Teams offen. Siehst du nach dem Update „Kein Zugang“, melde dich einmal ab und wieder an.',
      {
        text: 'Belege annehmen, ablehnen und nach CampFlow übertragen kann nur noch das Team „Kasse“. Alle anderen reichen ihre Belege ein, korrigieren sie und sehen ihren Stand wie bisher.',
        href: '/leitendenbereich/belege',
      },
      'Kommst du neu in ein Team, gilt das ab deiner nächsten Anmeldung.',
    ],
  },
  {
    id: '2026-10-21-11-belege-campflow',
    date: '2026-10-21',
    title: 'Belege: alle Belege in einer Liste, auch aus CampFlow, und eigene auf der Startseite',
    changes: [
      {
        text: 'Die Belege zeigen jetzt alle Belege in einer Liste: die hier eingereichten und alle aus CampFlow, jeweils mit ihrer Quelle und ihrem Stand von „Eingereicht“ bis „Erstattet“ oder „Bezahlt“. Für die Belege aus CampFlow brauchst du keinen eigenen CampFlow-Zugang.',
        href: '/leitendenbereich/belege',
      },
      'Du kannst nach Quelle, Stand, Kostenstelle und Kategorie filtern. „Nur meine Belege“ zeigt die, die du ausgelegt hast, auch wenn jemand anderes sie eingereicht hat. In der Galerie siehst du die Belege als Kacheln mit größerem Bild; tippst du einen an, siehst du alle Seiten, auch bei Belegen, die in CampFlow noch nicht gebucht sind.',
      'Die automatische Prüfung eines Belegfotos ist gründlicher: Sie erkennt Alkohol und Tabak auch an abgekürzten Artikelnamen und merkt, wenn ein Teil des Belegs fehlt. Sie dauert dafür etwa zehn Sekunden; solange zeigt ein Balken „Beleg wird geprüft …“.',
      'Beim Einreichen wählst du, wie bezahlt wurde: mit deinem Geld, von jemand anderem ausgelegt (Namen aus dem Modul „Personen“ werden vorgeschlagen), vom Stamm oder als Umbuchung aufs Sparbuch. Das ersetzt das Feld „Bezahlt von“.',
      'Das Foto bearbeitest du mit einer kleinen Werkzeugleiste: zuschneiden, drehen, spiegeln, Farben wählen und auf das Originalfoto zurücksetzen. Du siehst dabei immer nur das Foto, wie es eingereicht wird; zum Zuschneiden ziehst du die Ecken auf den Beleg und schließt mit „Zuschneiden fertig“ ab.',
      'Ein quer oder verkehrt herum fotografierter Beleg wird vor der Prüfung automatisch aufrecht gedreht; die Prüfung ist dadurch schneller und genauer. Beim automatischen Zuschneiden bleibt ein Rand stehen, und die Prüfung meldet nur noch fehlenden Inhalt, nicht mehr fehlende Papierränder.',
      'Auf der Startseite zeigt die neue Box „Meine Belege“ die Belege, die du ausgelegt hast, mit ihrem Stand, vom Einreichen bis zur Erstattung.',
      'Als Kasse überträgst du einen angenommenen Beleg direkt aus dem Beleg heraus nach CampFlow. Du wählst nur noch Kostenstelle und Kategorie; die Kostenstelle, die so heißt wie die Aktion, ist schon ausgewählt. CampFlow bekommt das Foto, Geschäft, Bemerkung, Datum und Betrag, und bei einer Auslage die Person oder „Sparbuch“ unter „Auslage durch“.',
      'Danach siehst du die neue Belegnummer aus CampFlow, und der Beleg wird hier gelöscht. Ging beim Übertragen etwas schief, kannst du es einfach noch einmal versuchen: Ein schon angekommener Beleg wird nicht doppelt angelegt.',
    ],
  },
  {
    id: '2026-10-21-10-schneller-laden',
    date: '2026-10-21',
    title: 'Seiten zeigen ihre Daten schneller',
    changes: [
      'Nach einer Pause von ein paar Minuten zeigen die Seiten ihre Daten schneller als bisher.',
      'Aktionen, Abrechnung und Anwesenheit warten seltener auf CampFlow. Hast du gerade etwas in CampFlow geändert, siehst du es hier spätestens nach einer Minute.',
      {
        text: 'Die Liste der Protokolle lädt schneller.',
        href: '/leitendenbereich/protokolle',
      },
      'Ein Protokoll im Protokoll-Editor und ein Blogbeitrag im Editor gehen schneller auf.',
      'Die Startseite zeigt deine Favoriten schneller und baut sie beim erneuten Öffnen nicht neu auf.',
      'Anwesenheit, Protokolle, Sammelbestellungen, Blog und Abrechnung zeigen beim erneuten Öffnen sofort den zuletzt geladenen Stand und holen den neuesten dahinter.',
      'Die Seiten des Nikolausdienstes und die Listen von Belegen, Aufgaben, Fragen und Blog laden schneller.',
      'Belege, Eigenbeleg, Fotos und Aufgaben laden die Aktionen aus CampFlow erst nach ihren eigenen Daten, damit die Seite schneller da ist.',
    ],
  },
  {
    id: '2026-10-21-09-dispo-karte',
    date: '2026-10-21',
    title: 'Die Dispo gibt es jetzt auch als große Karte',
    changes: [
      {
        text: 'In der Dispo kannst du oben zwischen „Liste“ und „Karte“ wechseln. Die Karte zeigt die Termine und Fahrten aller Teams groß und lässt sich mit dem Mausrad zoomen.',
        href: '/leitendenbereich/nikolaus-dispo',
      },
      'Zeig auf einen Termin, um Familie, Adresse, Uhrzeit und Kinder zu sehen. Zeig auf eine Fahrt, um zu sehen, wann das Team losfährt, ankommt und wie lange es unterwegs ist. Auf dem Handy tippst du dafür.',
      'Neben der Karte blendest du Teams ein und aus, springst zur Route eines Teams und zu Terminen nach Ende des gebuchten Termins. Bei einem gewählten Termin kannst du das Team wechseln, es festhalten oder ihn in der Liste zeigen.',
      'In der Liste bringt dich „Auf der Karte zeigen“ bei jedem Termin zurück zur Karte. Mit „Großansicht“ füllt die Karte den ganzen Bildschirm.',
      'Zeigst du auf eine Fahrt, werden die beiden Termine an ihren Enden auf der Karte und in der Liste daneben hervorgehoben.',
      'Bei jedem Team steht jetzt, wie viele Kilometer es insgesamt fährt, in der Karte und in der Liste.',
      'Unten links auf der großen Karte wählst du zwischen heller und dunkler Karte, unabhängig vom Design der Seite.',
    ],
  },
  {
    id: '2026-10-21-08-nikolaus-dispo-abend',
    date: '2026-10-21',
    title: 'Die Dispo am Besuchsabend umplanen',
    changes: [
      {
        text: 'Abgehakte Besuche bleiben in der Dispo bei ihrem Team und stehen am Anfang der Tour. Auch „Neu berechnen“ verschiebt sie nicht mehr.',
        href: '/leitendenbereich/nikolaus-dispo',
      },
      'Gibst du am Abend einen Termin einem anderen Team, kommt er hinter die Besuche, die dieses Team schon abgehakt hat. Die Zeiten der übrigen Termine rechnet die Dispo ab dem letzten Abhaken, also mit der echten Verspätung.',
      'Hat ein Team einen Besuch abgehakt, nachdem du die Dispo geöffnet hast, speichert die Dispo deine Änderungen nicht. Sie sagt dir dann, dass du neu laden sollst.',
    ],
  },
  {
    id: '2026-10-21-07-nikolaus-merkmale-fahrer',
    date: '2026-10-21',
    title: '„Nicht zu Familien mit“ gilt nicht für Fahrer*innen',
    changes: [
      {
        text: '„Nicht zu Familien mit“ gilt jetzt nur noch, wenn jemand als Nikolaus, Krampus oder Engerl eingeteilt ist. Als Fahrer*in kann die Person auch in ein Team mit so einer Familie, weil sie die Familie nicht besucht.',
        href: '/leitendenbereich/nikolaus-helfende',
      },
      {
        text: 'Auch die Dispo hält Familien nur noch wegen Nikolaus, Krampus oder Engerl von einem Team fern, nicht mehr wegen der Fahrer*in.',
        href: '/leitendenbereich/nikolaus-dispo',
      },
    ],
  },
  {
    id: '2026-10-21-06-nikolaus-fahrzeiten',
    date: '2026-10-21',
    title: 'Die Dispo rechnet mit dem Verkehr am Besuchsabend',
    changes: [
      {
        text: 'Die Dispo rechnet die Fahrzeiten jetzt mit dem üblichen Verkehr zu Beginn des Besuchstags. Die vorgeschlagenen Touren passen dadurch besser zum echten Abend.',
        href: '/leitendenbereich/nikolaus-dispo',
      },
      'Die Orte der Adressen und die Wege der Teams auf der Karte kommen von einem neuen Kartendienst. Fällt dir ein Haus an der falschen Stelle auf, schreib an admin@stamm-phoenix.de.',
      'Auch die Karten selbst kommen jetzt von diesem Kartendienst, mit deutschen Ortsnamen und im dunklen Design mit einer dunklen Karte.',
      'Der Link „Karte“ bei einer Anmeldung und die Navigation in der Fahrtansicht öffnen auf iPhone, iPad und Mac jetzt Apple Karten, auf allen anderen Geräten Google Maps.',
      'In der Steuerung gibt es den Bereich „Adresssuche“ nicht mehr. Die Adresssuche bleibt nicht mehr hängen, du musst dort nichts mehr freigeben.',
    ],
  },
  {
    id: '2026-10-21-05-erklaerungen',
    date: '2026-10-21',
    title: 'Weniger Erklärtext, Erklärungen hinter dem (i)',
    changes: [
      'Statt langer Erklärsätze sagen Beschriftungen und Buttons jetzt selbst, was passiert.',
      'Regeln und Hintergründe findest du hinter dem (i) neben einer Überschrift oder einem Feld. Tippe darauf, um die Erklärung zu lesen.',
      '„Was ist das?“ unter der Seitenüberschrift ist ebenfalls zu einem (i) neben der Überschrift geworden.',
      '„Eigenbeleg erstellen“ steht jetzt direkt neben „Beleg einreichen“, und das Archivieren einer Sammelbestellung fragt vorher nach.',
    ],
  },
  {
    id: '2026-10-21-04-personen',
    date: '2026-10-21',
    title: 'Dein Konto ist mit deiner Person in CampFlow verknüpft',
    changes: [
      {
        text: 'Aus „Weitere Personen“ wird „Personen“. Dort wird jedes Konto der Leitenden einmal mit der passenden Person in CampFlow verknüpft. Gibt es in CampFlow genau eine Person mit demselben Namen, schlägt die Seite sie vor, und du übernimmst den Vorschlag mit einem Klick.',
        href: '/leitendenbereich/personen',
      },
      'In Teilnehmendenlisten, bei Fahrten, in der Abrechnung, bei Beiträgen, Sammelbestellungen und Protokoll-Empfängern steht jetzt „(ich)“ hinter deinem eigenen Eintrag. Deine Anmeldung zu einer Aktion wird an deiner E-Mail-Adresse aus CampFlow erkannt, auch wenn du dich dort mit einem anderen Namen angemeldet hast.',
      'Altleitende und weitere Personen pflegst du wie bisher auf derselben Seite.',
    ],
  },
  {
    id: '2026-10-21-03-aufgaben-seitenwechsel',
    date: '2026-10-21',
    title: 'Aufgaben öffnen ohne Neuladen',
    changes: [
      {
        text: 'Die Aufgaben öffnen sich wie die anderen Bereiche, ohne dass die ganze Seite neu lädt. Das gilt auch für Projekte, Vorlagen und Aufgabenvorschläge.',
        href: '/leitendenbereich/aufgaben',
      },
    ],
  },
  {
    id: '2026-10-21-02-ohne-neuladen',
    date: '2026-10-21',
    title: 'Weniger Neuladen beim Weitergehen',
    changes: [
      {
        text: 'Nach dem Löschen eines Protokolls kommst du ohne Neuladen zurück zur Liste.',
        href: '/leitendenbereich/protokolle',
      },
      {
        text: 'Nach dem Anlegen einer Sammelbestellung geht die Seite der neuen Bestellung ohne Neuladen auf.',
        href: '/leitendenbereich/sammelbestellungen',
      },
      'Nach dem Löschen eines Blogbeitrags kommst du ohne Neuladen zurück zur Liste.',
    ],
  },
  {
    id: '2026-10-20-06-bedienung',
    date: '2026-10-20',
    title: 'Am Handy schneller ans Ziel',
    changes: [
      'Die Blogliste zeigt auch am Handy lesbare Titel, Datum und Aktionen. Die Startseite hält beim Laden Platz für deine Bereiche frei.',
      {
        text: 'Die Anwesenheit fragt nach, bevor eine ungespeicherte Notiz beim Wechsel der Stufe, des Datums oder der Ansicht verloren geht.',
        href: '/leitendenbereich/anwesenheit',
      },
      'Eine ausdrücklich für Funklöcher gespeicherte Route lässt sich im selben Tab auch ohne Verbindung neu laden, bis die zwölf Stunden abgelaufen sind. Das gilt auch für nachträglich hinzugefügte Nikolaustage.',
      'In der Route steht der nächste Besuch mit Navigation, Anrufen und Abhaken vor den weiteren Informationen.',
      'Im Protokoll kannst du Sitzungsdaten und Teilnehmende aufklappen. Die Aktionsleiste lässt am Handy mehr Platz zum Schreiben.',
      {
        text: 'Deine Ergänzungen zur Abrechnung kannst du für deinen Account speichern und auf deinen anderen Geräten weiterbearbeiten. Die Seite warnt vor ungespeicherten Änderungen und schützt vor dem Überschreiben einer neueren Fassung.',
        href: '/leitendenbereich/abrechnung',
      },
      'Die Speicherfrist deiner Abrechnung folgt auch nachträglich geänderten Aktionsdaten in CampFlow. Verspätete Ladeantworten überschreiben keine neu geöffneten Eingaben.',
      'Bei erneuter Anmeldung in der iPhone-App kommen auch deine ungespeicherten Abrechnungseingaben zurück. Punkte und Datumsangaben im Downloadnamen behalten beim Umbenennen die Dateiendung.',
      'Nach fehlgeschlagenem Speichern oder Zurücksetzen bleiben deine Abrechnungseingaben beim erneuten Versuch erhalten. Eine abgelaufene Speicherfrist wird erklärt.',
      'Sterne zum Auswählen deiner Favoriten sind am Handy sichtbar und antippbar.',
      'Bei Belegen verschwinden korrigierte Feldfehler sofort. Die Bestellliste weist auf seitlich erreichbare Spalten und fehlgeschlagene Preisabfragen hin. Warnungen zu entfernten Artikeln verschwinden beim erneuten Laden.',
      'In der Nikolaus-Steuerung bleibt Speichern beim Scrollen erreichbar. Vor dem Ausschalten der Verwaltung für alle fragt die Seite nach.',
    ],
  },
  {
    id: '2026-10-20-05-app-und-menue',
    date: '2026-10-20',
    title: 'Feste Plätze im mobilen Menü und schärferes App-Logo',
    changes: [
      'Die untere Menüleiste zeigt deine Favoriten und feste Standardbereiche. Beim Seitenwechsel bleiben die Bereiche an ihrem Platz.',
      'Die App bekommt ein schärferes Startlogo und einen dunklen Hintergrund für die untere Android-Leiste. Bereits installierte Apps übernehmen diese Änderungen nach einer Aktualisierung durch den Browser; bei Bedarf kannst du die App neu installieren.',
    ],
  },
  {
    id: '2026-10-20-04-neuigkeiten',
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
    id: '2026-10-20-03-eingaben-nach-neuer-anmeldung',
    date: '2026-10-20',
    title: 'Eingaben bleiben nach einer neuen Anmeldung erhalten',
    changes: [
      'In der iPhone-App öffnet „Neu anmelden“ keinen neuen Tab mehr, sondern meldet dich im selben Fenster neu an.',
      'Läuft deine Anmeldung ab, während ein Bearbeiten-Fenster offen ist, kommen deine Eingaben nach der neuen Anmeldung zurück. Das Fenster öffnet sich wieder, und die Felder sind ausgefüllt, auch Auswahlfelder, Zuständige bei Aufgaben und Wünsche von Helfenden.',
      {
        text: 'Bei einem Beleg sagt die Seite vor der neuen Anmeldung, dass das gewählte Foto dabei verloren gehen kann.',
        href: '/leitendenbereich/belege',
      },
    ],
  },
  {
    id: '2026-10-20-02-anwesenheit-entschuldigt-und-ausgefallen',
    date: '2026-10-20',
    title: 'Anwesenheit mit entschuldigten Kindern und ausgefallenen Gruppenstunden',
    changes: [
      {
        text: 'In der Anwesenheit wählst du für jedes Kind „Anwesend“, „Entschuldigt“ oder „Abwesend“. Die Auswahl wird sofort gespeichert.',
        href: '/leitendenbereich/anwesenheit',
      },
      'Fällt eine Gruppenstunde aus, markierst du sie als „Ausgefallen“. Dabei werden die Einträge der Kinder und Gäste gelöscht, und die Seite fragt vorher nach, wenn schon etwas eingetragen ist.',
      'Der Verlauf zeigt die Kinder im Schnitt pro Monat als Säulendiagramm und als Tabelle, dazu Entschuldigte, Gäste und ausgefallene Gruppenstunden. Ausgefallene Gruppenstunden zählen nicht in den Schnitt.',
      'Hat sich die Anwesenheit geändert, seit du die Seite geladen hast, lässt sich die Gruppenstunde nicht ausfallen lassen oder löschen. Die Seite sagt das, und du lädst die aktuelle Fassung.',
    ],
  },
  {
    id: '2026-10-20-01-leitendenbereich-als-app',
    date: '2026-10-20',
    title: 'Der Leitendenbereich als App auf dem Handy',
    changes: [
      'Du kannst den Leitendenbereich auf den Startbildschirm legen. Er öffnet sich dann in einem eigenen Fenster ohne Adressleiste, mit dem Phoenix-Symbol und dem Namen „Leitende“.',
      'Auf Android wählst du im Chrome-Menü „App installieren“, auf dem iPhone in Safari „Teilen“ und „Zum Home-Bildschirm“.',
      'Die App meldet dich an und führt dich danach zur Übersicht. Die Leisten sind in DPSG-Blau, und die Statusleiste folgt dem hellen oder dunklen Design.',
      'Ohne Verbindung sagt eine offene Seite, dass sie geöffnet bleiben soll. Deine Eingaben bleiben stehen, und Speichern geht erst wieder mit Verbindung.',
    ],
  },
  {
    id: '2026-10-19-01-wischen-und-beitraege',
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
    id: '2026-10-18-01-navigation-und-entwuerfe',
    date: '2026-10-18',
    title: 'Neue Leiste, Berliner Zeit und sicherere Entwürfe',
    changes: [
      'Der Leitendenbereich hat eine neue Navigation: unten eine Leiste mit deinen wichtigsten Bereichen, dazu „Alle Bereiche“ mit Suche statt des Burger-Menüs. Zuletzt genutzte Bereiche bietet dir die Leiste ebenfalls an.',
      'Alle Datums- und Uhrzeitangaben richten sich nach der Berliner Zeit, auch rund um den Jahreswechsel.',
      'Wenn deine Anmeldung abläuft oder jemand anderes dasselbe bearbeitet hat, bleiben deine Eingaben erhalten. Du lädst bewusst die aktuelle Fassung nach und musst nichts neu tippen.',
      'Bei technischen Problemen nennen alle Fehlermeldungen jetzt admin@stamm-phoenix.de.',
      {
        text: 'Im Protokoll-Editor erscheinen offene Aufgaben und Projekte an den Tagesordnungspunkten. Beim Freigeben werden die Aufgaben übernommen, und das Abhaken in einem Protokoll wird mit dem Aufgabenmodul abgeglichen.',
        href: '/leitendenbereich/protokolle',
      },
      {
        text: 'Antworten in Fragen & Antworten dürfen anklickbare Links enthalten.',
        href: '/leitendenbereich/fragen-und-antworten',
      },
    ],
  },
  {
    id: '2026-10-17-01-textfelder',
    date: '2026-10-17',
    title: 'Ein Editor für alle Textfelder',
    changes: [
      'Alle längeren Textfelder (Blog, Protokolle, Beschreibungen) nutzen denselben Editor mit Überschriften, Listen, Tabellen und Checklisten.',
      {
        text: 'Im Protokoll wählst du, ob du formatiert oder in Markdown schreibst. Deine Wahl gilt auf allen Geräten.',
        href: '/leitendenbereich/protokolle',
      },
      {
        text: 'Die Tagesordnung eines Protokolls ist ein einziges Dokument. Du kannst Punkte darin verschieben, kopieren und mit Rückgängig zurücknehmen.',
        href: '/leitendenbereich/protokolle',
      },
      'Breite Tabellen sagen dir, dass sie seitlich scrollen. Checklisten-Kästchen lassen sich auf dem Handy gut treffen.',
    ],
  },
  {
    id: '2026-10-16-01-fotos-und-nikolaus',
    date: '2026-10-16',
    title: 'Fotos, Protokoll-Versand und ein klarerer Nikolausdienst',
    changes: [
      {
        text: 'Neues Modul „Fotos“: Du stöberst in der Fotobibliothek, lädst Bilder oder ganze Ordner als ZIP herunter und lädst eigene Fotos hoch. Auf dem Handy zoomst du Bilder und wischst durch sie.',
        href: '/leitendenbereich/fotos',
      },
      {
        text: 'Der Versand von Protokollen zeigt dir die Empfängerliste mit dem Grund jeder Adresse. Du kannst Adressen herausnehmen oder ergänzen. Mitglieder mit dem CampFlow-Label „Protokollempfang“ bekommen das Protokoll automatisch.',
        href: '/leitendenbereich/protokolle',
      },
      {
        text: 'Alle Leitenden dürfen Protokolle prüfen. Die Prüfung ist freiwillig.',
        href: '/leitendenbereich/protokolle',
      },
      'Beim Nikolausdienst sind viele Texte verständlicher geworden: Planungsmerkmale heißen jetzt „Merkmale“, Teams und Besuche werden in Worten gezählt, und ein Besuch dauert höchstens 45 Minuten.',
      'Familien sehen ab zwei Stunden vor dem Besuch gut sichtbar den Notfallkontakt.',
      'In der Einteilung werden fertige Teams zuerst besetzt. Du kannst andere Teamzahlen ausprobieren und siehst, warum eine Zahl nicht geht.',
      {
        text: 'Ein Blogbeitrag trennt Entwurf und Veröffentlichung deutlich.',
        href: '/leitendenbereich/blog',
      },
      {
        text: 'Bei Gruppenstunden liegt „Löschen“ unter „Weitere Aktionen“.',
        href: '/leitendenbereich/gruppenstunden',
      },
      'Auf dem Handy lassen sich Filter und Tagesüberblick der Nikolausmodule einklappen.',
      'Die Sammelbestellungen, Gruppenstunden, Leitenden, Aktionen, Belege, Downloads und Favoriten liegen jetzt in einer eigenen Datenbank statt in SharePoint-Listen. Für dich ändert sich dadurch nichts.',
    ],
  },
  {
    id: '2026-10-15-01-hilfe-und-ablauf',
    date: '2026-10-15',
    title: 'Mehr Hilfe bei Fehlern und weniger verlorene Eingaben',
    changes: [
      'Fehlermeldungen sagen dir, was nicht geklappt hat, ob etwas gespeichert wurde und wen du ansprechen kannst. Die Hilfe-Adressen sind direkt anklickbar.',
      'Läuft deine Anmeldung ab, öffnet sich die neue Anmeldung in einem neuen Tab, und dein Entwurf bleibt in der alten Seite stehen.',
      'Wenn du eine Seite mit ungespeicherten Änderungen verlässt, fragt der Leitendenbereich mit einem eigenen Fenster nach.',
      {
        text: 'Die Abrechnung merkt sich deine Eingaben pro Aktion auf dem Gerät und löscht sie einen Monat nach der KJR-Frist.',
        href: '/leitendenbereich/abrechnung',
      },
      'Ansichten und Filter heißen überall gleich und zeigen ihren Namen. Auswahlleisten sind auf dem Handy groß genug zum Antippen.',
      {
        text: 'Aktionen ohne KJR-Zuschuss lassen sich markieren.',
        href: '/leitendenbereich/aktionen',
      },
      {
        text: 'Im Protokoll-Editor sortierst du Tagesordnungspunkte per Ziehen und trägst Beginn und Ende ein.',
        href: '/leitendenbereich/protokolle',
      },
      'In der Anwesenheit steht jetzt, dass Häkchen sofort gespeichert werden.',
    ],
  },
  {
    id: '2026-10-14-01-startseite-und-protokolle',
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
    id: '2026-10-12-01-aufgaben',
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
      {
        text: 'Die Seite „Abrechnung“ warnt, wenn du zu viele Betreuende einträgst.',
        href: '/leitendenbereich/abrechnung',
      },
    ],
  },
  {
    id: '2026-10-11-01-werkzeuge',
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
    id: '2026-10-08-01-anwesenheit-und-fahrten',
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
    id: '2026-10-07-01-protokolle-und-steuerung',
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
    id: '2026-10-06-01-design-und-kontakt',
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
    id: '2026-10-05-01-abrechnung-und-kalender',
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
    id: '2026-10-02-01-belege',
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
    id: '2026-10-01-01-sammelbestellungen',
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
    id: '2026-09-30-01-fragen-und-antworten',
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
    id: '2026-09-29-01-blog-und-instagram',
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
    id: '2026-09-28-01-nikolaus-planen',
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
    id: '2026-09-25-01-leitendenbereich',
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
