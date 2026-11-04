import type { StaffModule } from './staffModules';
const FALLBACK = ['aufgaben', 'aktionen', 'belege', 'anwesenheit', 'mitglieder', 'protokolle'];
/** Input modules have already been filtered by permissions and seasonal availability. */
export function commonTaskModules(
  modules: StaffModule[],
  counts: Record<string, number>
): StaffModule[] {
  const count = (href: string): number =>
    Number.isSafeInteger(counts[href]) && counts[href] > 0 ? counts[href] : 0;
  const popular = modules.filter((module) => count(module.href) > 0);
  if (popular.reduce((total, module) => total + count(module.href), 0) < 20) {
    return modules.filter((module) =>
      FALLBACK.some((name) => module.href === '/leitendenbereich/' + name)
    );
  }
  return popular
    .sort((a, b) => count(b.href) - count(a.href) || a.href.localeCompare(b.href))
    .slice(0, 4);
}
