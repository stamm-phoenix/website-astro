import type { StaffPage } from './staffModuleTypes';

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
    description:
      'Teilnehmende, Einnahmen und Ausgaben, KJR-Zuschuss und Kurzbeschreibung einer Aktion.',
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
