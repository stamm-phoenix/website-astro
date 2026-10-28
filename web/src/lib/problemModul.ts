import { NIKOLAUS_MODULES, STAFF_MODULES } from './staffModules';

/** The name of the module a page of the Leitendenbereich belongs to; `''` elsewhere. */
export function problemModuleOf(path: string): string {
  if (!path.startsWith('/leitendenbereich')) return '';
  const own = [...STAFF_MODULES, ...NIKOLAUS_MODULES].find(
    (module) => path === module.href || path.startsWith(`${module.href}/`)
  );
  return own?.title ?? '';
}
