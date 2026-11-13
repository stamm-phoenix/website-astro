import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as gerichteEndpoints from '../../endpoints/essensplanung-gerichte';
import * as teilnehmendeEndpoints from '../../endpoints/essensplanung-teilnehmende';
import * as packliste from '../../endpoints/essensplanung-packliste';
import type { PlanungAnsicht } from '../../lib/essen-planung-model';
import { call, json } from './essensplanung';

/** Requests of the packing list for the database tests. */

export type Fehler = { fields: Record<string, string> };

export async function gericht(
  t: TestContext,
  token: string,
  name: string,
  werkzeuge: string[]
): Promise<number> {
  const antwort = await call(
    t,
    gerichteEndpoints.EssensplanungGerichte,
    'POST',
    'planung/gerichte',
    {
      token,
      body: { name, personen: 10, werkzeuge },
    }
  );
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<{ id: number }>(antwort).id;
}

export async function einplanen(
  t: TestContext,
  token: string,
  mahlzeitId: number,
  gerichtId: number
): Promise<PlanungAnsicht> {
  const antwort = await call(
    t,
    teilnehmendeEndpoints.EssensplanungEinplanungen,
    'POST',
    'planung/einplanungen',
    { token, body: { mahlzeitId, gerichtId } }
  );
  assert.equal(antwort.status, 201, JSON.stringify(antwort.jsonBody));
  return json<PlanungAnsicht>(antwort);
}

export function neu(t: TestContext, token: string, body: object) {
  return call(t, packliste.EssensplanungPackliste, 'POST', 'planung/packliste', { token, body });
}

export function werkzeug(t: TestContext, token: string, body: object) {
  return call(t, packliste.EssensplanungPackWerkzeug, 'PUT', 'planung/packliste/werkzeug', {
    token,
    body,
  });
}

export function aendern(t: TestContext, token: string, id: number, body: object) {
  return call(t, packliste.EssensplanungPackEintrag, 'PATCH', `planung/packliste/${id}`, {
    token,
    params: { id: String(id) },
    body,
  });
}

export function abhaken(t: TestContext, token: string, id: number, body: object) {
  return call(
    t,
    packliste.EssensplanungPackZuteilung,
    'PATCH',
    `planung/packliste/zuteilung/${id}`,
    { token, params: { id: String(id) }, body }
  );
}

export function loeschen(t: TestContext, token: string, id: number, ifMatch: string) {
  return call(t, packliste.EssensplanungPackEintrag, 'DELETE', `planung/packliste/${id}`, {
    token,
    params: { id: String(id) },
    ifMatch,
  });
}

/** The persons of an entry as `[name, gepackt]`. */
export function personen(eintrag: PlanungAnsicht['packliste'][number]): [string, boolean][] {
  return eintrag.zuteilungen.map((z) => [z.name, z.gepackt]);
}
