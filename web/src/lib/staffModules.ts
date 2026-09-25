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
    href: '/leitendenbereich/aktionen',
    title: 'Aktionen',
    description: 'Aktionen aus CampFlow mit den Teilnehmendenlisten ansehen.',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
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
  // Only shown while the Nikolausdienst booking is active
  ...(NIKOLAUS_CONFIG.active
    ? [
        {
          href: '/leitendenbereich/nikolaus',
          title: 'Nikolaus',
          description: 'Anmeldungen zum Nikolausdienst als Liste oder Terminmatrix ansehen.',
          icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
        },
      ]
    : []),
];
