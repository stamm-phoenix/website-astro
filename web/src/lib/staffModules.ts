import { STAFF_MODULES } from './staffModuleList';
import type { StaffModule, StaffPage } from './staffModuleTypes';
import { NIKOLAUS_CONTROL_MODULE, NIKOLAUS_MODULES } from './staffModulesNikolaus';
import { STAFF_HOME, STAFF_SUBPAGES } from './staffSubpages';

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
