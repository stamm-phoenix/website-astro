import { NIKOLAUS_CONFIG } from './nikolausConfig';

/** A tile on the start page of the Leitendenbereich. */
export interface StaffModule {
  href: string;
  title: string;
  description: string;
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
}

export const STAFF_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/sammelbestellungen',
    title: 'Sammelbestellungen',
    description:
      'Rüsthaus-Bestellungen sammeln, Bestelllisten exportieren und Zahlung sowie Auslieferung pflegen.',
    icon: 'M3 3h2l3 12h10l3-8H6M9 21h.01M18 21h.01',
  },
  {
    href: '/leitendenbereich/belege',
    title: 'Belege',
    description:
      'Kassenbelege fotografieren und einreichen; das Kassenteam prüft sie und überträgt sie nach CampFlow.',
    icon: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  },
  {
    href: '/leitendenbereich/protokolle',
    title: 'Protokolle',
    description:
      'Protokolle aus der Word-Vorlage anlegen, gemeinsam bearbeiten, freigeben und an alle Leitenden schicken.',
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  },
  {
    href: '/leitendenbereich/fragen-und-antworten',
    title: 'Fragen & Antworten',
    description: 'Fragen, Antworten und Themen der öffentlichen FAQ bearbeiten.',
    icon: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/aktionen',
    title: 'Aktionen',
    description:
      'Aktionen aus CampFlow mit Teilnehmendenlisten ansehen und im öffentlichen Kalender veröffentlichen.',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  {
    href: '/leitendenbereich/abrechnung',
    title: 'Abrechnung',
    description:
      'Einnahmen und Ausgaben einer Aktion nach Kategorien, Teilnehmende und möglicher KJR-Zuschuss.',
    icon: 'M4 3h16v18H4zM8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h8',
  },
  {
    href: '/leitendenbereich/gruppenstunden',
    title: 'Gruppenstunden',
    description: 'Zeiten, Orte und Beschreibungen der Gruppenstunden bearbeiten.',
    icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
  {
    href: '/leitendenbereich/leitende',
    title: 'Leitende & Teams',
    description: 'Leitende, Fotos und Teams (Stufen, Vorstand) verwalten.',
    icon: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
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
    icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  },
];

/** Modules of the Nikolausdienst, shown in their own section while `staffActive` is set. */
export const NIKOLAUS_MODULES: StaffModule[] = NIKOLAUS_CONFIG.staffActive
  ? [
      {
        href: '/leitendenbereich/nikolaus',
        title: 'Anmeldungen',
        description: 'Anmeldungen als Liste oder Terminmatrix ansehen, verlegen und absagen.',
        icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
      },
      {
        href: '/leitendenbereich/nikolaus-dispo',
        title: 'Dispo',
        description: 'Termine eines Tages auf die Teams verteilen und die Routen planen.',
        icon: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
      },
      {
        href: '/leitendenbereich/nikolaus-fahrt',
        title: 'Fahrt',
        description: 'Unterwegs: die Route des eigenen Teams abfahren und Besuche abhaken.',
        icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
      },
      {
        href: '/leitendenbereich/nikolaus-helfende',
        title: 'Helfende',
        description:
          'Helfende eintragen und auf Nikolaus, Krampus, Fahrer*in, Engerl und Küche verteilen.',
        icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1a6 6 0 0 1 12 0v1M16 11l2 2 4-4',
      },
    ]
  : [];

/** Sections of the start page of the Leitendenbereich; empty sections are not shown. */
const byPath = (...paths: string[]): StaffModule[] =>
  STAFF_MODULES.filter((module) => paths.includes(module.href.split('/').at(-1) ?? ''));

export const STAFF_MODULE_SECTIONS: { id: string; title: string; modules: StaffModule[] }[] = [
  {
    id: 'organisation',
    title: 'Organisation & Kasse',
    modules: byPath('aktionen', 'abrechnung', 'belege', 'sammelbestellungen', 'protokolle'),
  },
  {
    id: 'website',
    title: 'Website pflegen',
    modules: byPath('gruppenstunden', 'leitende', 'downloads', 'blog', 'fragen-und-antworten'),
  },
  { id: 'nikolaus', title: 'Nikolausdienst', modules: NIKOLAUS_MODULES },
];
