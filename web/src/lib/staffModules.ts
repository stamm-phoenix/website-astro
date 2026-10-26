/** A page of the Leitendenbereich. `StaffLayout.astro` builds its title, header and breadcrumb from it. */
export interface StaffPage {
  href: string;
  /** Name on the start page. */
  title: string;
  /** Heading, breadcrumb and browser title, when the page needs more context than `title`. */
  heading?: string;
  /** Short description for the start page and the meta description. */
  description: string;
  /** Text under the heading; `description` when omitted. */
  intro?: string;
  /** href of the page above this one in the breadcrumb; the start page when omitted. */
  parent?: string;
  /** Links to the page load it in full instead of a view transition. */
  reload?: boolean;
  /** Show the intro as a paragraph; otherwise it waits behind the „(i)“ next to the heading, so the content starts high up. */
  introOpen?: boolean;
}

/** A tile on the start page of the Leitendenbereich. */
export interface StaffModule extends StaffPage {
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
  /** Other words people search for, beyond title and description (`staffSearch.ts`). */
  keywords?: string[];
  /** The title with `|` where a long word may break in narrow places (tiles, the bar). */
  wrap?: string;
  /**
   * Only for these roles of the teams (`CONFIG.staff.teams`), one of them is enough; the module is
   * hidden from everyone else. Its API checks the teams with `hasTeam`; the page itself stays under
   * `team_leitende`, because a route of its own in `staticwebapp.config.json` could only allow
   * these roles instead of Leitende, not in addition.
   */
  roles?: string[];
}

/** The page that lists the changes of the Leitendenbereich; its bubble counts the unread ones. */
export const CHANGELOG_PATH = '/leitendenbereich/neuigkeiten';

export const STAFF_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/aufgaben',
    title: 'Aufgaben',
    description: 'Aufgaben verteilen, Fristen im Blick behalten und Erledigtes abhaken.',
    keywords: ['todo', 'erledigen', 'frist', 'kanban', 'projekt', 'vorlage', 'zuständig'],
    icon: 'M9 11l3 3 8-8M4 4h11M4 9h4M4 14h4M4 19h16',
  },
  {
    href: '/leitendenbereich/sammelbestellungen',
    title: 'Sammelbestellungen',
    description:
      'Rüsthaus-Bestellungen der Mitglieder sammeln, bestellen und Zahlung sowie Auslieferung festhalten.',
    wrap: 'Sammel|bestellungen',
    keywords: ['rüsthaus', 'kluft', 'bestellen', 'bestellung', 'halstuch', 'material'],
    icon: 'M3 3h2l3 12h10l3-8H6M9 21h.01M18 21h.01',
  },
  {
    href: '/leitendenbereich/belege',
    title: 'Belege',
    description:
      'Kassenbelege fotografieren und einreichen, und alle Belege aus CampFlow mit ihrem Stand ansehen.',
    intro:
      'Belege fotografieren und bei der Kasse einreichen. Lehnt die Kasse einen Beleg ab, bekommst du die Begründung per Mail und kannst ihn korrigiert erneut einreichen. Die Belege aus CampFlow kannst du hier nur ansehen; gebucht und erstattet wird in CampFlow. „Neu laden“ holt den aktuellen Stand aus CampFlow.',
    keywords: ['kasse', 'kassenzettel', 'quittung', 'rechnung', 'geld', 'auslage', 'erstattung'],
    icon: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  },
  {
    href: '/leitendenbereich/eigenbeleg',
    title: 'Eigenbeleg',
    description: 'Für Ausgaben ohne Kassenzettel einen Eigenbeleg als PDF erstellen.',
    intro:
      'Für Ausgaben ohne Originalbeleg, z. B. am Parkautomaten oder bei einem verlorenen Kassenzettel: ausfüllen, als PDF herunterladen, unterschreiben und wie einen Kassenbeleg unter „Belege“ einreichen.',
    keywords: ['kasse', 'quittung', 'parkautomat', 'ohne beleg', 'pdf', 'geld'],
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 17h2l5-5-2-2-5 5z',
  },
  {
    href: '/leitendenbereich/protokolle',
    title: 'Protokolle',
    description:
      'Protokolle der Leitendenrunde schreiben, freigeben und an alle Leitenden schicken.',
    intro:
      'Eine Person schreibt, alle anderen lesen live mit. Nach der Freigabe, auf Wunsch mit Review, liegt das Protokoll als PDF im Protokoll-Ordner und geht an alle Leitenden.',
    keywords: ['leiterrunde', 'leitendenrunde', 'sitzung', 'treffen', 'word', 'mitschrift'],
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  },
  {
    href: '/leitendenbereich/abstimmungen',
    title: 'Abstimmungen',
    wrap: 'Abstim|mungen',
    description:
      'Termine finden oder über Vorschläge abstimmen, die Leitendenrunde und Gäste per Mail einladen und erinnern.',
    intro:
      'Wie Doodle oder eine Umfrage in WhatsApp: Du legst eine Frage mit Terminen oder anderen Optionen an. Leitende stimmen hier ab, alle anderen über ihren Link aus der Einladung oder über den Link für alle, bei dem sie ihren Namen eintragen. Ändern, einladen und erinnern kann nur, wer die Abstimmung angelegt hat.',
    keywords: [
      'doodle',
      'umfrage',
      'termin',
      'terminfindung',
      'abstimmen',
      'entscheidung',
      'datum',
      'whatsapp',
    ],
    icon: 'M4 20h16M7 16v-6M12 16V4M17 16v-9',
  },
  {
    href: '/leitendenbereich/qr-code',
    title: 'QR-Code-Generator',
    wrap: 'QR-Code-|Generator',
    description: 'QR-Codes für Links erstellen, Farbe und Form anpassen und als PNG herunterladen.',
    intro:
      'QR-Code für einen Link oder Text erstellen, Farbe und Form anpassen und als PNG herunterladen. Die Codes laufen nicht ab.',
    keywords: ['qr', 'link', 'code', 'plakat'],
    icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM6 6h1M17 6h1M6 17h1M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3',
  },
  {
    href: '/leitendenbereich/fragen-und-antworten',
    title: 'Fragen & Antworten',
    description: 'Fragen, Antworten und Themen der öffentlichen FAQ bearbeiten.',
    keywords: ['faq', 'fragen', 'antworten', 'website'],
    icon: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/anwesenheit',
    title: 'Anwesenheit',
    description:
      'Eintragen, wer in der Gruppenstunde war oder entschuldigt fehlte, was ihr gemacht habt, und Verlauf je Stufe ansehen.',
    intro: 'Namen von Kindern werden nach zwölf Monaten gelöscht; die Zahlen bleiben.',
    wrap: 'Anwesen|heit',
    keywords: [
      'kinder',
      'gruppenstunde',
      'teilnehmende',
      'liste',
      'da gewesen',
      'abhaken',
      'entschuldigt',
      'ausgefallen',
    ],
    icon: 'M9 4h6v3H9zM9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M9 14l2 2 4-4',
  },
  {
    href: '/leitendenbereich/mitglieder',
    title: 'Mitglieder',
    description: 'Die Mitglieder aus CampFlow nach Gruppen ansehen und ihre Angaben nachschlagen.',
    intro:
      'Die Mitgliederliste aus CampFlow zum Nachschlagen. Ändern, aufnehmen und austragen geht nur in CampFlow. Bankverbindungen, Gesundheitsangaben und Notizen werden hier nicht angezeigt.',
    keywords: [
      'mitgliederliste',
      'mitgliederverwaltung',
      'campflow',
      'gruppe',
      'stufe',
      'kinder',
      'adresse',
      'telefon',
      'geburtstag',
      'kontakt',
      'eltern',
    ],
    icon: 'M4 4h16v16H4zM9.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 16a3 3 0 0 1 6 0M15 9h3M15 13h3',
  },
  {
    href: '/leitendenbereich/aktionen',
    title: 'Aktionen',
    description:
      'Aktionen aus CampFlow mit Teilnehmendenlisten ansehen und im öffentlichen Kalender veröffentlichen.',
    intro:
      'Titel, Datum und Anmeldelink kommen aus CampFlow; hier wählst du Stufen und Beschreibung für den Kalender der Website. Aktionen ohne CampFlow legst du hier an.',
    keywords: [
      'termine',
      'kalender',
      'lager',
      'fahrt',
      'campflow',
      'teilnehmende',
      'anmeldungen',
      'bezahlt',
      'verwendungszweck',
    ],
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  {
    href: '/leitendenbereich/aktionen/fahrten',
    title: 'Fahrten',
    description: 'Fahrgemeinschaften für Hin- und Rückfahrt einer Aktion planen.',
    parent: '/leitendenbereich/aktionen',
    keywords: ['auto', 'mitfahren', 'fahrgemeinschaft', 'plätze', 'anreise'],
    icon: 'M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3zM7 13h.01M17 13h.01',
  },
  {
    href: '/leitendenbereich/abrechnung',
    title: 'Abrechnung',
    description:
      'Einnahmen und Ausgaben einer Aktion nach Kategorien, Teilnehmende und möglicher KJR-Zuschuss.',
    intro:
      'KJR ist der Kreisjugendring Rosenheim. Er bezuschusst ein Defizit für Teilnehmende aus dem Landkreis; die Abrechnung zeigt, was möglich ist.',
    keywords: ['kasse', 'kjr', 'zuschuss', 'kreisjugendring', 'einnahmen', 'ausgaben', 'geld'],
    icon: 'M4 3h16v18H4zM8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h8',
  },
  {
    href: '/leitendenbereich/beitraege',
    title: 'Beiträge',
    description:
      'Nachschauen, wer für welche Aktion schon bezahlt hat – die Beiträge aus CampFlow, nur zum Lesen.',
    icon: 'M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9',
    keywords: [
      'bezahlt',
      'zahlung',
      'überweisung',
      'teilnehmerbeitrag',
      'mitgliedsbeitrag',
      'offen',
    ],
  },
  {
    href: '/leitendenbereich/kostenstellen',
    title: 'Kostenstellen',
    wrap: 'Kosten|stellen',
    description:
      'Einnahmen, Ausgaben und Saldo je Kostenstelle und Kategorie aus CampFlow – für Kasse und Vorstand.',
    intro:
      'Summen aller Buchungen in CampFlow über den gesamten Zeitraum, je Kostenstelle und je Kategorie. „Offen“ ist der Teil, der noch keiner Zahlung auf dem Konto zugeordnet ist: bei Einnahmen zum Beispiel unbezahlte Beiträge, bei Ausgaben noch nicht erstattete Auslagen. Nur die Kasse und der Vorstand sehen diesen Bereich.',
    roles: ['team_kasse', 'team_vorstand'],
    keywords: [
      'kasse',
      'vorstand',
      'kategorie',
      'saldo',
      'einnahmen',
      'ausgaben',
      'haushalt',
      'budget',
      'statistik',
      'auswertung',
      'geld',
    ],
    icon: 'M21 12a9 9 0 1 1-9-9v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  },
  {
    href: '/leitendenbereich/gruppenstunden',
    title: 'Gruppenstunden',
    description: 'Zeiten, Orte und Beschreibungen der Gruppenstunden bearbeiten.',
    intro: 'Änderungen erscheinen sofort auf der Website.',
    wrap: 'Gruppen|stunden',
    keywords: ['uhrzeit', 'wochentag', 'ort', 'website'],
    icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/leitende',
    title: 'Leitende & Teams',
    description: 'Leitende, Fotos und Teams (Stufen, Vorstand) verwalten.',
    intro: 'Änderungen erscheinen sofort auf der Website.',
    keywords: ['vorstand', 'stufe', 'team', 'foto', 'kontakt', 'website'],
    icon: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  },
  {
    href: '/leitendenbereich/personen',
    title: 'Personen',
    description:
      'Leitende mit ihrer Person in CampFlow verknüpfen, Altleitende und weitere Beteiligte pflegen.',
    intro:
      'Über die Verknüpfung erkennen die Module dich in CampFlow, z. B. mit „(ich)“ in Teilnehmendenlisten. Altleitende und andere, die oft dabei sind, bietet der Protokoll-Editor neben den Leitenden zur Auswahl an.',
    keywords: [
      'altleitende',
      'protokoll',
      'gäste',
      'campflow',
      'microsoft',
      'konto',
      'verknüpfen',
      'weitere personen',
    ],
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  },
  {
    href: '/leitendenbereich/fotos',
    title: 'Fotos',
    description:
      'Fotos und Videos von Aktionen ansehen, herunterladen und vom Handy in die Foto-Ablage hochladen.',
    intro: 'Löschen geht nur in SharePoint.',
    keywords: ['bilder', 'videos', 'hochladen', 'sharepoint'],
    icon: 'M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  },
  {
    href: '/leitendenbereich/downloads',
    title: 'Downloads',
    description: 'Dateien für die Downloads-Seite hochladen, umbenennen und löschen.',
    keywords: ['datei', 'pdf', 'formular', 'hochladen', 'website'],
    icon: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  },
  {
    href: '/leitendenbereich/blog',
    title: 'Blog',
    description: 'Blogbeiträge mit Bildern schreiben und veröffentlichen.',
    intro: 'Entwürfe sind nur hier sichtbar, nicht auf der Website.',
    keywords: ['beitrag', 'bericht', 'news', 'neuigkeiten', 'website'],
    icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  },
  {
    href: CHANGELOG_PATH,
    title: 'Neuigkeiten',
    description:
      'Nachlesen, was sich im Leitendenbereich geändert hat und was du jetzt Neues nutzen kannst.',
    intro:
      'Hier steht, was sich im Leitendenbereich geändert hat, die neueste Änderung zuerst. Die Zahl am Menü zeigt, wie viele Neuigkeiten du noch nicht gelesen hast.',
    keywords: ['changelog', 'änderungen', 'neu', 'update', 'version', 'was ist neu'],
    icon: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  },
];

/** The Steuerung of the Nikolausdienst: always shown, it switches the other modules on and off. */
export const NIKOLAUS_CONTROL_MODULE: StaffModule = {
  href: '/leitendenbereich/nikolaus-steuerung',
  title: 'Steuerung',
  description:
    'Nikolausdienst einrichten, Anmeldung und Verwaltung ein- und ausschalten, Daten nach der Aktion löschen.',
  heading: 'Nikolaus-Steuerung',
  keywords: ['nikolaus', 'einschalten', 'ausschalten', 'wartung', 'löschen'],
  icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

/**
 * Modules of the Nikolausdienst, shown in their own section while the Nikolausverwaltung is
 * switched on in the Steuerung (checked in the browser, see `NikolausStaffSection.svelte`).
 */
export const NIKOLAUS_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/nikolaus',
    title: 'Anmeldungen',
    wrap: 'Anmel|dungen',
    description: 'Anmeldungen als Liste oder Terminübersicht ansehen, verlegen und absagen.',
    heading: 'Nikolaus-Anmeldungen',
    keywords: ['nikolaus', 'familien', 'termine', 'buchungen'],
    icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
  },
  {
    href: '/leitendenbereich/nikolaus-dispo',
    title: 'Dispo',
    description: 'Termine eines Tages auf die Teams verteilen und die Routen planen.',
    heading: 'Nikolaus-Dispo',
    intro:
      'Die Berechnung verteilt die bestätigten Termine mit möglichst wenig Fahrzeit. Termine lassen sich von Hand einem anderen Team zuweisen; festgehaltene bleiben beim Neuberechnen.',
    parent: '/leitendenbereich/nikolaus',
    keywords: ['nikolaus', 'teams', 'route', 'planen', 'verteilen'],
    icon: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  },
  {
    href: '/leitendenbereich/nikolaus-fahrt',
    title: 'Route',
    description: 'Unterwegs: die Route des eigenen Teams abfahren und Besuche abhaken.',
    heading: 'Route',
    intro: 'Jeder abgehakte Besuch ist sofort in der Dispo zu sehen.',
    parent: '/leitendenbereich/nikolaus',
    keywords: ['nikolaus', 'unterwegs', 'besuche', 'navigation'],
    icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  },
  {
    href: '/leitendenbereich/nikolaus-helfende',
    title: 'Helfende',
    description:
      'Helfende eintragen und auf Nikolaus, Krampus, Fahrer*in, Engerl und Küche verteilen.',
    heading: 'Nikolaus-Helfende',
    parent: '/leitendenbereich/nikolaus',
    keywords: ['nikolaus', 'krampus', 'engerl', 'fahrer', 'küche', 'helfer'],
    icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a6 6 0 0 1 12 0v1M16 11l2 2 4-4',
  },
];

/** Keep the modules in the order of the category, independent of the favorites catalog. */
const byPath = (...paths: string[]): StaffModule[] =>
  paths.flatMap((path) => STAFF_MODULES.filter((module) => module.href.split('/').at(-1) === path));

/**
 * Sections of the start page of the Leitendenbereich; empty sections are not shown. The
 * section „Nikolausdienst“ is rendered by `NikolausStaffSection.svelte`.
 */
export const STAFF_MODULE_SECTIONS: { id: string; title: string; modules: StaffModule[] }[] = [
  {
    id: 'leitendenrunde',
    title: 'Leitendenrunde',
    modules: byPath('aufgaben', 'protokolle', 'abstimmungen', 'personen'),
  },
  {
    id: 'gruppen',
    title: 'Gruppen & Aktionen',
    modules: byPath('anwesenheit', 'mitglieder', 'aktionen', 'fahrten', 'fotos'),
  },
  {
    id: 'kasse',
    title: 'Kasse & Material',
    modules: byPath(
      'belege',
      'eigenbeleg',
      'abrechnung',
      'beitraege',
      'kostenstellen',
      'sammelbestellungen'
    ),
  },
  {
    // Modules whose content appears on the public website
    id: 'website',
    title: 'Website pflegen',
    modules: byPath(
      'gruppenstunden',
      'leitende',
      'blog',
      'downloads',
      'fragen-und-antworten',
      'qr-code'
    ),
  },
  {
    id: 'neues',
    title: 'Neu im Leitendenbereich',
    modules: byPath('neuigkeiten'),
  },
];

/** The start page of the Leitendenbereich. */
export const STAFF_HOME: StaffPage = {
  href: '/leitendenbereich',
  title: 'Leitendenbereich',
  description: 'Interner Bereich für die Leitenden des DPSG Stamm Phoenix.',
};

/** Pages below a module that have no tile of their own. */
export const STAFF_SUBPAGES: StaffPage[] = [
  {
    href: '/leitendenbereich/aufgaben/projekte',
    title: 'Projekte',
    description: 'Projekte bündeln Aufgaben für Aktionen und andere Vorhaben.',
    parent: '/leitendenbereich/aufgaben',
  },
  {
    href: '/leitendenbereich/aufgaben/vorlagen',
    title: 'Vorlagen',
    description: 'Wiederverwendbare Vorlagen für die Aufgaben einer Aktion.',
    parent: '/leitendenbereich/aufgaben',
  },
  {
    href: '/leitendenbereich/aufgaben/vorschlaege',
    title: 'Aufgabenvorschläge',
    description: 'Aufgabenvorschläge aus Protokollen prüfen und übernehmen.',
    parent: '/leitendenbereich/aufgaben',
  },
  {
    href: '/leitendenbereich/abstimmungen/abstimmung',
    title: 'Abstimmung',
    description: 'Bei einer Abstimmung mitmachen, das Ergebnis ansehen und dazu einladen.',
    parent: '/leitendenbereich/abstimmungen',
  },
  {
    href: '/leitendenbereich/aktionen/aktion',
    title: 'Aktion',
    description: 'Teilnehmende einer Aktion aus CampFlow.',
    parent: '/leitendenbereich/aktionen',
  },
  {
    href: '/leitendenbereich/abrechnung/detail',
    title: 'Aktion',
    heading: 'Abrechnung einer Aktion',
    description: 'Teilnehmende, Einnahmen und Ausgaben und KJR-Zuschuss einer Aktion.',
    parent: '/leitendenbereich/abrechnung',
  },
  {
    href: '/leitendenbereich/blog/beitrag',
    title: 'Beitrag',
    description: 'Einen Blogbeitrag schreiben, bebildern und veröffentlichen.',
    parent: '/leitendenbereich/blog',
  },
  {
    href: '/leitendenbereich/protokolle/protokoll',
    title: 'Protokoll',
    description: 'Ein Protokoll der Leitendenrunde schreiben oder live mitlesen.',
    parent: '/leitendenbereich/protokolle',
  },
  {
    href: '/leitendenbereich/protokolle/praesentation',
    title: 'Präsentation',
    heading: 'Präsentation des Protokolls',
    description:
      'Ein Protokoll der Leitendenrunde live und gut lesbar für Fernseher und Bildschirmfreigabe.',
    parent: '/leitendenbereich/protokolle/protokoll',
  },
  {
    href: '/leitendenbereich/sammelbestellungen/detail',
    title: 'Sammelbestellung',
    description:
      'Bestellliste, Nachrichten, Zahlung und Auslieferung einer Sammelbestellung verwalten.',
    parent: '/leitendenbereich/sammelbestellungen',
  },
  {
    href: '/leitendenbereich/wieder-angemeldet',
    title: 'Wieder angemeldet',
    description: 'Nach einer abgelaufenen Anmeldung zurück zum Speichern im anderen Tab.',
    intro:
      'Du bist wieder angemeldet. Schließe diesen Tab und tippe im anderen Tab noch einmal auf „Speichern“.',
    introOpen: true,
  },
];

const STAFF_PAGES: StaffPage[] = [
  STAFF_HOME,
  ...STAFF_MODULES,
  NIKOLAUS_CONTROL_MODULE,
  ...NIKOLAUS_MODULES,
  ...STAFF_SUBPAGES,
];

/** The registered page at `path`; throws so that an unregistered page fails the build. */
export function staffPage(path: string): StaffPage {
  const href = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const page = STAFF_PAGES.find((entry) => entry.href === href);
  if (!page) throw new Error(`${href} fehlt in STAFF_MODULES oder STAFF_SUBPAGES.`);
  return page;
}

/** The pages above `page`, starting with the start page; empty for the start page itself. */
export function staffBreadcrumbs(page: StaffPage): StaffPage[] {
  if (page.href === STAFF_HOME.href) return [];
  const parent = staffPage(page.parent ?? STAFF_HOME.href);
  return [...staffBreadcrumbs(parent), parent];
}

/** The bar on the phone offers these to fill places not occupied by favorites. */
export const STAFF_DEFAULT_QUICK: string[] = [
  '/leitendenbereich/aufgaben',
  '/leitendenbereich/belege',
  '/leitendenbereich/aktionen',
];

/** The module `page` belongs to: the page itself or the nearest page above it with a tile. */
export function staffModuleOf(page: StaffPage): StaffModule | null {
  const modules = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE, ...NIKOLAUS_MODULES];
  const own = modules.find((module) => module.href === page.href);
  if (own) return own;
  return page.parent && page.parent !== STAFF_HOME.href
    ? staffModuleOf(staffPage(page.parent))
    : null;
}

/**
 * Modules that can be favorites, in the order favorites are shown everywhere (start page, bar on
 * the phone); `loadFavorites` sorts by it.
 */
export const STAFF_FAVORITE_PATHS: string[] = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE].map(
  (module) => module.href
);
