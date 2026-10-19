import type { StaffModule } from './staffModules';

/** A group of modules as the menu and the start page show it. */
export interface StaffModuleGroup {
  id: string;
  title: string;
  modules: StaffModule[];
}

/** Lower case without accents, so „Rüsthaus“ is found with „rusthaus“ and „rüst“ alike. */
function normalize(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Scores a module for every word of the query; 0 if a word matches nothing. */
function score(module: StaffModule, group: StaffModuleGroup, words: string[]): number {
  const title = normalize(module.title);
  const keywords = (module.keywords ?? []).map(normalize);
  const rest = normalize(`${module.description} ${group.title}`);
  let total = 0;
  for (const word of words) {
    if (title.startsWith(word)) total += 8;
    else if (title.includes(word)) total += 5;
    else if (keywords.some((keyword) => keyword.startsWith(word))) total += 4;
    else if (keywords.some((keyword) => keyword.includes(word))) total += 2;
    else if (rest.includes(word)) total += 1;
    else return 0;
  }
  return total;
}

/**
 * The groups with the modules matching `query` in title, keywords, description or group name,
 * the best match first: within each group and across the groups, so the first module shown is
 * the one Enter opens. Every group as it is for an empty query. A module shown in two groups
 * appears only in the first.
 */
export function searchStaffModules(query: string, groups: StaffModuleGroup[]): StaffModuleGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  const seen = new Set<string>();
  return groups
    .map((group) => {
      const scored = group.modules
        .filter((module) => !seen.has(module.href))
        .map((module) => ({ module, score: score(module, group, words) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      for (const entry of scored) seen.add(entry.module.href);
      return {
        group: { ...group, modules: scored.map((entry) => entry.module) },
        best: scored[0]?.score ?? 0,
      };
    })
    .filter((entry) => entry.best > 0)
    .sort((a, b) => b.best - a.best)
    .map((entry) => entry.group);
}

/**
 * The areas of a person: the favorites in their order, then the recently used ones that are not
 * favorites, at most `limit`. Paths without a known module are skipped.
 */
export function yourStaffModules(
  favorites: string[],
  recent: string[],
  modules: StaffModule[],
  limit: number
): StaffModule[] {
  if (limit <= 0) return [];
  const result: StaffModule[] = [];
  for (const href of [...favorites, ...recent]) {
    const module = modules.find((entry) => entry.href === href);
    if (module && !result.includes(module)) result.push(module);
    if (result.length === limit) break;
  }
  return result;
}
