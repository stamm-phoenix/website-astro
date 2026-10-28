import {
  NIKOLAUS_CONTROL_MODULE,
  NIKOLAUS_MODULES,
  STAFF_MODULES,
  STAFF_SUBPAGES,
} from './staffModules';

/**
 * The name of the module or page of the Leitendenbereich a path belongs to (the most specific
 * one, e.g. „Fahrten“ below „Aktionen“); `''` elsewhere.
 */
export function problemModuleOf(path: string): string {
  if (!path.startsWith('/leitendenbereich')) return '';
  const pages = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE, ...NIKOLAUS_MODULES, ...STAFF_SUBPAGES];
  const own = pages
    .filter((page) => path === page.href || path.startsWith(`${page.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return own?.title ?? '';
}
