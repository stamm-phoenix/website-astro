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
}

/** A tile on the start page of the Leitendenbereich. */
export interface StaffModule extends StaffPage {
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
}

export const STAFF_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/aufgaben',
    reload: true,
    title: 'Aufgaben',
    description:
      'Offene und erledigte Aufgaben als Liste oder Kanban ansehen und Zuständigkeiten verwalten.',
    icon: 'M9 11l3 3 8-8M4 4h11M4 9h4M4 14h4M4 19h16',
  },
  {
    href: '/leitendenbereich/sammelbestellungen',
    title: 'Sammelbestellungen',
    description:
      'Rüsthaus-Bestellungen sammeln, Bestelllisten exportieren und Zahlung sowie Auslieferung pflegen.',
    intro: 'Bestellzeiträume anlegen, Mitglieder einladen und die Rüsthaus-Bestellungen verwalten.',
    icon: 'M3 3h2l3 12h10l3-8H6M9 21h.01M18 21h.01',
  },
  {
    href: '/leitendenbereich/belege',
    title: 'Belege',
    description:
      'Kassenbelege fotografieren und einreichen; das Kassenteam prüft sie und überträgt sie nach CampFlow.',
    intro:
      'Belege fotografieren und bei der Kasse einreichen. Die Kasse prüft sie vor und überträgt angenommene Belege nach CampFlow.',
    icon: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  },
  {
    href: '/leitendenbereich/eigenbeleg',
    title: 'Eigenbeleg',
    description:
      'Für Ausgaben ohne Originalbeleg einen Eigenbeleg auf dem Briefpapier des Stammes als PDF erstellen.',
    intro:
      'Für Ausgaben ohne Originalbeleg, z. B. am Parkautomaten oder bei einem verlorenen Kassenzettel: ausfüllen, als PDF herunterladen, unterschreiben und wie einen Kassenbeleg unter „Belege“ einreichen.',
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 17h2l5-5-2-2-5 5z',
  },
  {
    href: '/leitendenbereich/protokolle',
    title: 'Protokolle',
    description:
      'Protokolle aus der Word-Vorlage anlegen, gemeinsam bearbeiten, freigeben und an alle Leitenden schicken.',
    intro:
      'Protokolle direkt im Editor schreiben oder als Word, PDF und Text lesen, prüfen und gemeinsam weiterbearbeiten.',
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  },
  {
    href: '/leitendenbereich/qr-code',
    title: 'QR-Code',
    description:
      'QR-Codes für Links erstellen, Farbe und Form anpassen und als PNG herunterladen – ohne fremden Dienst.',
    intro:
      'QR-Code für einen Link oder Text erstellen, Farbe und Form anpassen und als PNG herunterladen. Alles passiert im Browser: ohne fremden Dienst, ohne Weiterleitung und ohne Ablaufdatum.',
    icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM6 6h1M17 6h1M6 17h1M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3',
  },
  {
    href: '/leitendenbereich/fragen-und-antworten',
    title: 'Fragen & Antworten',
    description: 'Fragen, Antworten und Themen der öffentlichen FAQ bearbeiten.',
    intro:
      'Fragen, Antworten und Themen bearbeiten. Entwürfe vorbereiten und Antworten veröffentlichen oder vorübergehend ausblenden.',
    icon: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/anwesenheit',
    title: 'Anwesenheit',
    description:
      'Abhaken, wer in der Gruppenstunde war, was ihr gemacht habt, und Verlauf je Stufe ansehen.',
    intro:
      'Pro Gruppenstunde abhaken, wer da war, und festhalten, was ihr gemacht habt. Namen von Kindern werden nach zwölf Monaten gelöscht.',
    icon: 'M9 4h6v3H9zM9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M9 14l2 2 4-4',
  },
  {
    href: '/leitendenbereich/aktionen',
    title: 'Aktionen',
    description:
      'Aktionen aus CampFlow mit Teilnehmendenlisten ansehen und im öffentlichen Kalender veröffentlichen.',
    intro:
      'Alle Aktionen aus CampFlow, als Liste oder Monatskalender. Öffne eine Aktion für die Teilnehmendenliste oder veröffentliche sie im Kalender der Website. Aktionen ohne CampFlow legst du hier ebenfalls an.',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  {
    href: '/leitendenbereich/aktionen/fahrten',
    title: 'Fahrten',
    description:
      'Fahrgemeinschaften für Hin- und Rückfahrt einer Aktion aus den Platzangaben in CampFlow planen.',
    parent: '/leitendenbereich/aktionen',
    icon: 'M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3zM7 13h.01M17 13h.01',
  },
  {
    href: '/leitendenbereich/abrechnung',
    title: 'Abrechnung',
    description:
      'Einnahmen und Ausgaben einer Aktion nach Kategorien, Teilnehmende und möglicher KJR-Zuschuss.',
    intro:
      'Wähle eine Aktion, um Teilnehmende, Einnahmen und Ausgaben sowie den möglichen Zuschuss vom Kreisjugendring Rosenheim zu sehen.',
    icon: 'M4 3h16v18H4zM8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h8',
  },
  {
    href: '/leitendenbereich/gruppenstunden',
    title: 'Gruppenstunden',
    description: 'Zeiten, Orte und Beschreibungen der Gruppenstunden bearbeiten.',
    intro:
      'Wochentage, Uhrzeiten, Orte und Beschreibungen der Gruppenstunden bearbeiten. Änderungen erscheinen sofort auf der Website.',
    icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/leitende',
    title: 'Leitende & Teams',
    description: 'Leitende, Fotos und Teams (Stufen, Vorstand) verwalten.',
    intro:
      'Leitende mit Foto, Kontaktdaten und Teams (Stufen, Vorstand) verwalten. Änderungen erscheinen sofort auf der Website.',
    icon: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  },
  {
    href: '/leitendenbereich/personen',
    title: 'Weitere Personen',
    description:
      'Altleitende und andere regelmäßig Beteiligte, die im Protokoll zur Auswahl stehen.',
    intro:
      'Altleitende und andere, die oft dabei sind, aber nicht in der Gruppe der Leitenden sind. Der Protokoll-Editor bietet sie neben den Leitenden zur Auswahl an.',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  },
  {
    href: '/leitendenbereich/downloads',
    title: 'Downloads',
    description: 'Dateien für die Downloads-Seite hochladen, umbenennen und löschen.',
    icon: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  },
  {
    href: '/leitendenbereich/blog',
    title: 'Blog',
    description: 'Blogbeiträge mit Bildern schreiben und veröffentlichen.',
    intro:
      'Blogbeiträge schreiben, bebildern und veröffentlichen. Entwürfe sind nur hier sichtbar.',
    icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  },
];

/** The Steuerung of the Nikolausdienst: always shown, it switches the other modules on and off. */
export const NIKOLAUS_CONTROL_MODULE: StaffModule = {
  href: '/leitendenbereich/nikolaus-steuerung',
  title: 'Steuerung',
  description:
    'Besuchstage und Zeiten, Anmeldung und Verwaltung an- und ausschalten, Wartungsmodus und Daten nach der Aktion löschen.',
  heading: 'Nikolaus-Steuerung',
  intro:
    'Hier wird der Nikolausdienst eingerichtet: an welchen Tagen und zu welchen Zeiten er unterwegs ist, ob Familien sich anmelden können und ob die Module im Leitendenbereich zu sehen sind. Nach der Aktion werden hier die Daten gelöscht.',
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
    description: 'Anmeldungen als Liste oder Terminmatrix ansehen, verlegen und absagen.',
    heading: 'Nikolaus-Anmeldungen',
    intro:
      'Alle Anmeldungen zum Nikolausdienst – als filterbare Liste oder als Matrix über Tage und Zeitslots.',
    icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
  },
  {
    href: '/leitendenbereich/nikolaus-dispo',
    title: 'Dispo',
    description: 'Termine eines Tages auf die Teams verteilen und die Routen planen.',
    heading: 'Nikolaus-Dispo',
    intro:
      'Verteilt die bestätigten Termine eines Tages auf die Teams, mit möglichst wenig Fahrzeit und ohne Verspätungen. Du kannst Termine von Hand einem anderen Team zuweisen. Mit „Team festhalten“ bleibt die Zuordnung beim Neuberechnen erhalten.',
    parent: '/leitendenbereich/nikolaus',
    icon: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  },
  {
    href: '/leitendenbereich/nikolaus-fahrt',
    title: 'Route',
    description: 'Unterwegs: die Route des eigenen Teams abfahren und Besuche abhaken.',
    heading: 'Nikolaus-Route',
    intro:
      'Eure Route aus der Dispo: Team wählen, von Familie zu Familie fahren und jeden Besuch abhaken. Die Disposition sieht den Stand sofort.',
    parent: '/leitendenbereich/nikolaus',
    icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  },
  {
    href: '/leitendenbereich/nikolaus-helfende',
    title: 'Helfende',
    description:
      'Helfende eintragen und auf Nikolaus, Krampus, Fahrer*in, Engerl und Küche verteilen.',
    heading: 'Nikolaus-Helfende',
    intro:
      'Wer übernimmt an welchem Tag welchen Posten? Trage die Helfenden ein und lass sie auf die Teams verteilen. Tags verhindern zum Beispiel, dass Leitende ihre eigene Gruppe besuchen.',
    parent: '/leitendenbereich/nikolaus',
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
    modules: byPath('aufgaben', 'protokolle', 'personen'),
  },
  {
    id: 'gruppen',
    title: 'Gruppen & Aktionen',
    modules: byPath('anwesenheit', 'aktionen', 'fahrten'),
  },
  {
    id: 'kasse',
    title: 'Kasse & Material',
    modules: byPath('belege', 'eigenbeleg', 'abrechnung', 'sammelbestellungen'),
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
    reload: true,
  },
  {
    href: '/leitendenbereich/aufgaben/vorlagen',
    title: 'Vorlagen',
    description: 'Wiederverwendbare Vorlagen für die Aufgaben einer Aktion.',
    parent: '/leitendenbereich/aufgaben',
    reload: true,
  },
  {
    href: '/leitendenbereich/aufgaben/vorschlaege',
    title: 'Aufgabenvorschläge',
    description: 'Aufgaben, die die KI aus Protokollen vorschlägt, prüfen und übernehmen.',
    parent: '/leitendenbereich/aufgaben',
    reload: true,
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
    heading: 'Beitrag bearbeiten',
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
