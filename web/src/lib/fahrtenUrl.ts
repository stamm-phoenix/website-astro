import type { Fahrt, FahrtAnpassungen } from './fahrtenPlan';
import type { FahrerPrioritaet, FahrerPrioritaeten } from './fahrtenPrioritaet';

// The URL holds the whole plan, so reloading keeps it and a link shares it.

const PARAM = {
  fahrer: 'fahrer',
  keinFahrer: 'kein-fahrer',
  entfernt: 'entfernt',
  verschoben: 'mit',
} as const;

function param(name: string, fahrt: Fahrt): string {
  return `${name}-${fahrt}`;
}

function idList(value: string | null): string[] {
  return (value ?? '').split(',').filter(Boolean);
}

/** Reads the changes of a direction from the URL, so a plan can be shared as a link. */
export function readAnpassungen(params: URLSearchParams, fahrt: Fahrt): FahrtAnpassungen {
  return {
    fahrer: idList(params.get(param(PARAM.fahrer, fahrt))),
    keinFahrer: idList(params.get(param(PARAM.keinFahrer, fahrt))),
    entfernt: idList(params.get(param(PARAM.entfernt, fahrt))),
    verschoben: idList(params.get(param(PARAM.verschoben, fahrt))).map((entry) => {
      const [person, fahrer = '-'] = entry.split(':');
      return [person, fahrer === '-' ? null : fahrer];
    }),
  };
}

/** Writes the changes of a direction into the URL parameters; empty lists are left out. */
export function writeAnpassungen(
  params: URLSearchParams,
  fahrt: Fahrt,
  anpassungen: FahrtAnpassungen
): void {
  const lists: [string, string[]][] = [
    [PARAM.fahrer, anpassungen.fahrer],
    [PARAM.keinFahrer, anpassungen.keinFahrer],
    [PARAM.entfernt, anpassungen.entfernt],
    [
      PARAM.verschoben,
      anpassungen.verschoben.map(([person, fahrer]) => `${person}:${fahrer ?? '-'}`),
    ],
  ];
  for (const [name, values] of lists) {
    if (values.length > 0) params.set(param(name, fahrt), values.join(','));
    else params.delete(param(name, fahrt));
  }
}

/** URL parameter of each priority that is not `normal`; it applies to both directions. */
const PRIORITAET_PARAM: Record<Exclude<FahrerPrioritaet, 'normal'>, string> = {
  zuerst: 'faehrt-gern',
  notfalls: 'nur-wenn-noetig',
};

/** Reads who drives first or only if needed; a person in both lists counts as `notfalls`. */
export function readPrioritaeten(params: URLSearchParams): FahrerPrioritaeten {
  const prioritaeten: Record<string, FahrerPrioritaet> = {};
  for (const prioritaet of ['zuerst', 'notfalls'] as const) {
    for (const id of idList(params.get(PRIORITAET_PARAM[prioritaet]))) {
      prioritaeten[id] = prioritaet;
    }
  }
  return prioritaeten;
}

/** Writes the priorities into the URL parameters; empty lists are left out. */
export function writePrioritaeten(params: URLSearchParams, prioritaeten: FahrerPrioritaeten): void {
  for (const prioritaet of ['zuerst', 'notfalls'] as const) {
    const ids = Object.keys(prioritaeten).filter((id) => prioritaeten[id] === prioritaet);
    if (ids.length > 0) params.set(PRIORITAET_PARAM[prioritaet], ids.join(','));
    else params.delete(PRIORITAET_PARAM[prioritaet]);
  }
}
