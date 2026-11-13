/** Essensplanung: shared helpers of the routes below and the demo Planung. */
import type { EssenListe, EssenMockResult } from './mock-data/essensplanung';
import { essenEinstellungen } from './mock-data/essensplanung';
import * as essenPlanung from './mock-data/essensplanung-planung';
import { fuelleDemoPlanung } from './mock-data/essensplanung-demo';
import { error, json, noContent, notFound, str } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { PRINCIPAL } from './mockAuth';

// The demo Planung gets its dishes, plan and participants once
fuelleDemoPlanung();

// Essensplanung: Steuerung for the teams Admin and Vorstand (docs/essensplanung.md)
export const ESSEN_NOT_ALLOWED = (): MockResult | null =>
  ['team_admin', 'team_vorstand'].some((role) => PRINCIPAL.userRoles.includes(role))
    ? null
    : error(403, 'NOT_IN_TEAM', 'Die Steuerung der Essensplanung ist nur für Admin und Vorstand.');

export function essenListe(value: string | undefined): EssenListe | undefined {
  return value === 'zutaten' || value === 'kategorien' || value === 'unvertraeglichkeiten'
    ? value
    : undefined;
}

export function essenResult(result: EssenMockResult, body: () => unknown): MockResult {
  if (result === 'not-found') return notFound();
  if (result === 'conflict')
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen von jemand anderem geändert.');
  if ('field' in result)
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      [result.field]: result.message,
    });
  return json(body(), 'id' in result && result.id !== undefined ? 201 : 200);
}

// Essensplanung: public pages, access by the token of a link; answers like a PR preview
export function essenSite(req: MockRequest, path: string, param: string, token: string): string {
  const host = str(req.headers.host, 'localhost:4321');
  return `http://${host}${path}#${new URLSearchParams({ [param]: token })}`;
}

export function essenFehler(caught: unknown): MockResult {
  if (caught instanceof essenPlanung.MockPlanungFehler)
    return error(caught.status, caught.code, caught.message, caught.fields);
  throw caught;
}

export function essenZugang(req: MockRequest): essenPlanung.MockZugang {
  return essenPlanung.zugangVon(req.headers['x-essensplanung-token']);
}

export function essenAnsicht(zugang: essenPlanung.MockZugang) {
  const einstellungen = essenEinstellungen();
  return essenPlanung.ansichtVon(zugang, einstellungen.wartung, einstellungen.aufbewahrungMonate);
}

/** Runs a change of a Planung and answers with the new view (or `extra` around it). */
export function essenAendern(
  req: MockRequest,
  work: (zugang: essenPlanung.MockZugang) => Record<string, unknown> | void,
  status = 200
): MockResult {
  try {
    const zugang = essenZugang(req);
    if (essenEinstellungen().wartung)
      return error(503, 'MAINTENANCE', 'Die Essensplanung wird gerade gewartet.');
    const extra = work(zugang);
    if (req.method === 'DELETE' && req.path === '/api/essensplanung/planung') return noContent();
    return json(extra ? { ansicht: essenAnsicht(zugang), ...extra } : essenAnsicht(zugang), status);
  } catch (caught) {
    return essenFehler(caught);
  }
}
