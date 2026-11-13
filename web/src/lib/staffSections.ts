import { POSTFACH_MODULES } from './postfaecher';
import { STAFF_MODULES } from './staffModuleList';
import type { StaffModule } from './staffModuleTypes';

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
    id: 'email',
    title: 'E-Mail',
    modules: POSTFACH_MODULES,
  },
  {
    id: 'gruppen',
    title: 'Gruppen & Aktionen',
    modules: byPath(
      'anwesenheit',
      'mitglieder',
      'nami-abgleich',
      'schnupperanfragen',
      'aktionen',
      'fahrten',
      'fotos'
    ),
  },
  {
    id: 'essensplanung',
    title: 'Essensplanung',
    modules: byPath('essensplanungen', 'essensplanung-steuerung', 'essensplanung-zutaten'),
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
      'sammelbestellungen',
      'inventur'
    ),
  },
  {
    // Modules whose content appears on the public website
    id: 'website',
    title: 'Website pflegen',
    modules: byPath(
      'redaktion',
      'gruppenstunden',
      'gruppenstunden-hinweise',
      'leitende',
      'blog',
      'downloads',
      'fragen-und-antworten',
      'problemmeldungen',
      'qr-code'
    ),
  },
  {
    id: 'neues',
    title: 'Neu im Leitendenbereich',
    modules: byPath('neuigkeiten'),
  },
];
