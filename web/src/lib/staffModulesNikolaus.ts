import type { StaffModule } from './staffModuleTypes';

export const NIKOLAUS_CONTROL_MODULE: StaffModule = {
  href: '/leitendenbereich/nikolaus-steuerung',
  title: 'Steuerung',
  shortcut: 'Nikolaus steuern',
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
