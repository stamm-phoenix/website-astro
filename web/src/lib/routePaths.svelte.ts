import { postApi } from './api';
import type { DispoAssignment } from './nikolausDispo';
interface RoutePaths {
  path: (date: string, team: string, ids: string[] | undefined) => [number, number][] | null;
}
export function createRoutePaths(
  getSource: () => { date: string | undefined; assignment: DispoAssignment }
): RoutePaths {
  /** Wait this long after the last change before asking for the course along the roads. */
  const ROUTE_PATH_DELAY_MS = 600;

  /** Course of each team's route along the roads, with the route it was requested for. */
  let routePaths = $state.raw<Record<string, { key: string; path: [number, number][] }>>({});
  /** Route last requested per team; not reactive, so a failed request is not repeated. */
  const requestedPaths: Record<string, string> = {};

  function routeKey(ids: string[] | undefined): string {
    return (ids ?? []).join(',');
  }

  // Fetch the courses along the roads for the map once the routes stop changing. Until the
  // answer arrives (or without the routing service) the map draws straight lines.
  $effect(() => {
    const source = getSource();
    if (!source.date) return;
    const current = $state.snapshot(source.assignment) as DispoAssignment;
    const day = source.date;
    const timer = setTimeout(async () => {
      const missing = Object.entries(current).filter(
        ([team, ids]) => ids.length > 0 && requestedPaths[`${day}/${team}`] !== routeKey(ids)
      );
      if (missing.length === 0) return;
      for (const [team, ids] of missing) requestedPaths[`${day}/${team}`] = routeKey(ids);
      try {
        const { paths } = await postApi<{ paths: Record<string, [number, number][] | null> }>(
          `/intern/nikolaus/dispo/routes?date=${encodeURIComponent(day)}`,
          { routes: Object.fromEntries(missing) }
        );
        const next = { ...routePaths };
        for (const [team, ids] of missing) {
          const path = paths[team];
          if (path) next[team] = { key: `${day}/${routeKey(ids)}`, path };
        }
        routePaths = next;
      } catch {
        // Only cosmetic: the map keeps its straight lines
      }
    }, ROUTE_PATH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  return {
    path(date, team, ids) {
      return routePaths[team]?.key === `${date}/${routeKey(ids)}` ? routePaths[team].path : null;
    },
  };
}
