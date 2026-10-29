/**
 * Planungen of the Essensplanung in the mock API. It behaves like a PR preview: instead of
 * sending mails, the answers carry the link (`vorschauLink`). A demo Planung is ready at
 * `/essensplanung/planung#t=demo…` (see `DEMO_TOKEN`).
 */
import { randomBytes } from 'node:crypto';
import {
  addDays,
  darfBearbeiten,
  darfMitgliederVerwalten,
  daysBetween,
  loeschDatum,
  nummeriereTage,
} from '../../../api/lib/essen-planung-model';
import type {
  AnlegenInput,
  EinladungInput,
  MahlzeitInput,
  PlanungAnsicht,
  PlanungEinstellungenInput,
  PlanungRolle,
  PlanungZugang,
} from '../../../api/lib/essen-planung-model';
import type { Gericht } from '../../../api/lib/essen-gerichte-model';
import type { EssenPlanungUebersicht } from '../../src/lib/types';
import type { MockPlanungZutat } from './essensplanung-gerichte';
import { gerichteAnsicht } from './essensplanung-gerichte';
import { newEtag } from './util';

/** Opens the demo Planung as its owner. */
export const DEMO_TOKEN = 'demoDemoDemoDemoDemoDemoDemoDemoDemoDemoDem';

interface MockMitglied {
  id: number;
  etag: string;
  name: string;
  email: string | null;
  rolle: PlanungRolle;
  token: string | null;
  entzogen: boolean;
}

interface MockMahlzeit {
  id: number;
  etag: string;
  position: number;
  name: string;
  uhrzeit: string | null;
}

interface MockTag {
  id: number;
  etag: string;
  datum: string;
  mahlzeiten: MockMahlzeit[];
}

export interface MockPlanung {
  id: number;
  etag: string;
  name: string;
  mitgliederVerwalten: boolean;
  beitritt: string | null;
  lesen: string | null;
  seq: number;
  tage: MockTag[];
  mitglieder: MockMitglied[];
  aenderungen: PlanungAnsicht['aenderungen'];
  erstellt: string;
  geaendert: string;
  zutaten: MockPlanungZutat[];
  gerichte: Gericht[];
}

let nextId = 1;
const planungen: MockPlanung[] = [];
const anfragen = new Map<string, AnlegenInput & { planungId?: number }>();

export function neuesMockToken(): string {
  return randomBytes(32).toString('base64url');
}

function etag(): string {
  return newEtag('essen-planung');
}

/** A new id and version for the dishes of the mock (`essensplanung-gerichte.ts`). */
export function neueId(): number {
  return nextId++;
}

export const neuesEtag = etag;

const VORLAGE = ['Frühstück', 'Mittagessen', 'Kaffee & Kuchen', 'Abendessen', 'Mitternachtssnack'];

function neuerTag(datum: string, vorlage: string[]): MockTag {
  return {
    id: nextId++,
    etag: etag(),
    datum,
    mahlzeiten: vorlage.map((name, index) => ({
      id: nextId++,
      etag: etag(),
      position: index + 1,
      name,
      uhrzeit: null,
    })),
  };
}

function erstelle(input: AnlegenInput, token: string, vorlage: string[]): MockPlanung {
  const now = new Date().toISOString();
  const planung: MockPlanung = {
    id: nextId++,
    etag: etag(),
    name: input.planungName,
    mitgliederVerwalten: false,
    beitritt: null,
    lesen: null,
    seq: 1,
    tage: [],
    mitglieder: [],
    aenderungen: [],
    erstellt: now,
    geaendert: now,
    zutaten: [],
    gerichte: [],
  };
  const tage = daysBetween(input.ersterTag, input.letzterTag) + 1;
  for (let index = 0; index < tage; index++) {
    planung.tage.push(neuerTag(addDays(input.ersterTag, index), vorlage));
  }
  planung.mitglieder.push({
    id: nextId++,
    etag: etag(),
    name: input.name,
    email: input.email,
    rolle: 'besitzer',
    token,
    entzogen: false,
  });
  planung.aenderungen.unshift({
    seq: 1,
    at: now,
    wer: input.name,
    aktion: 'planung-angelegt',
    details: { name: input.planungName },
  });
  planungen.push(planung);
  return planung;
}

// The demo Planung for `dev:mock`
erstelle(
  {
    email: 'leitung@example.test',
    name: 'Demo Leitung',
    planungName: 'Demo-Sommerlager',
    ersterTag: '2027-08-01',
    letzterTag: '2027-08-04',
  },
  DEMO_TOKEN,
  VORLAGE
);

export class MockPlanungFehler extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

const LINK_UNGUELTIG = () =>
  new MockPlanungFehler(
    404,
    'LINK_UNGUELTIG',
    'Dieser Link gilt nicht (mehr). Neue Links bekommst du auf der Seite „Essensplanung“ unter „Meine Planungen“.'
  );

export interface MockZugang {
  planung: MockPlanung;
  zugang: PlanungZugang;
  mitglied: MockMitglied | null;
}

export function zugangVon(token: unknown): MockZugang {
  if (typeof token !== 'string') throw LINK_UNGUELTIG();
  for (const planung of planungen) {
    const mitglied = planung.mitglieder.find((m) => m.token === token && !m.entzogen);
    if (mitglied) return { planung, zugang: mitglied.rolle, mitglied };
    if (planung.lesen === token) return { planung, zugang: 'lesen', mitglied: null };
  }
  throw LINK_UNGUELTIG();
}

export function ansichtVon(
  { planung, zugang, mitglied }: MockZugang,
  wartung: boolean,
  monate: number
): PlanungAnsicht {
  const verwalten = darfMitgliederVerwalten(zugang, planung.mitgliederVerwalten);
  const tage = nummeriereTage(
    planung.tage.map(({ id, etag: tagEtag, datum }) => ({ id, etag: tagEtag, datum })),
    planung.tage.flatMap((tag) => tag.mahlzeiten.map((m) => ({ ...m, tagId: tag.id })))
  );
  const letzter = tage.at(-1)?.datum;
  return {
    id: planung.id,
    etag: planung.etag,
    name: planung.name,
    seq: planung.seq,
    stand: `${planung.seq}.${wartung ? 1 : 0}.${monate}`,
    zugang,
    ichId: mitglied?.id ?? null,
    darfVerwalten: verwalten,
    mitgliederVerwalten: planung.mitgliederVerwalten,
    links: verwalten ? { beitritt: planung.beitritt, lesen: planung.lesen } : null,
    tage,
    mitglieder: planung.mitglieder
      .filter((m) => zugang !== 'lesen' && (verwalten || !m.entzogen))
      .map((m) => ({
        id: m.id,
        etag: m.etag,
        name: m.name,
        rolle: m.rolle,
        email: verwalten || m.id === mitglied?.id ? m.email : null,
        entzogen: m.entzogen,
        ich: m.id === mitglied?.id,
      })),
    loeschtAm: loeschDatum(letzter ?? planung.erstellt.slice(0, 10), monate),
    wartung,
    aenderungen: planung.aenderungen.slice(0, 30),
    ...gerichteAnsicht(planung),
  };
}

const NICHT_ERLAUBT = () =>
  new MockPlanungFehler(403, 'NICHT_ERLAUBT', 'Das dürfen nur die Besitzer:innen der Planung.');

/** Checks the right, bumps the counter and logs the change. */
export function aendere(
  z: MockZugang,
  aktion: string,
  details: Record<string, unknown>,
  work: () => void,
  recht: 'bearbeiten' | 'verwalten' | 'besitzer' = 'bearbeiten'
): void {
  if (!darfBearbeiten(z.zugang)) {
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  }
  if (recht === 'besitzer' && z.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  if (recht === 'verwalten' && !darfMitgliederVerwalten(z.zugang, z.planung.mitgliederVerwalten)) {
    throw NICHT_ERLAUBT();
  }
  work();
  z.planung.seq++;
  z.planung.etag = etag();
  z.planung.geaendert = new Date().toISOString();
  z.planung.aenderungen.unshift({
    seq: z.planung.seq,
    at: z.planung.geaendert,
    wer: z.mitglied?.name ?? '',
    aktion,
    details,
  });
}

function konflikt(): MockPlanungFehler {
  return new MockPlanungFehler(409, 'CONFLICT', 'Jemand anderes hat das gerade geändert.');
}

function nichtGefunden(): MockPlanungFehler {
  return new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');
}

function feld(field: string, message: string): MockPlanungFehler {
  return new MockPlanungFehler(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
    [field]: message,
  });
}

export function anfrage(input: AnlegenInput): string {
  const token = neuesMockToken();
  anfragen.set(token, { ...input });
  return token;
}

export function bestaetige(token: unknown, vorlage: string[]): string {
  const eintrag = typeof token === 'string' ? anfragen.get(token) : undefined;
  if (!eintrag) {
    throw new MockPlanungFehler(
      404,
      'ANFRAGE_UNGUELTIG',
      'Dieser Bestätigungslink ist abgelaufen oder gilt nicht.'
    );
  }
  if (eintrag.planungId) {
    throw new MockPlanungFehler(409, 'SCHON_ANGELEGT', 'Diese Planung ist schon angelegt.');
  }
  const besitzerToken = neuesMockToken();
  eintrag.planungId = erstelle(eintrag, besitzerToken, vorlage).id;
  return besitzerToken;
}

/** New links for all Planungen of an address; the old links stop working. */
export function neueLinks(email: string): { planungName: string; token: string }[] {
  return planungen.flatMap((planung) =>
    planung.mitglieder
      .filter((m) => m.email === email && !m.entzogen)
      .map((m) => {
        m.token = neuesMockToken();
        return { planungName: planung.name, token: m.token };
      })
  );
}

export function beitrittPlanung(token: unknown): MockPlanung {
  const planung = planungen.find((p) => typeof token === 'string' && p.beitritt === token);
  if (!planung) throw LINK_UNGUELTIG();
  return planung;
}

export function beitreten(token: unknown, name: string, email: string | null): string {
  const planung = beitrittPlanung(token);
  const persoenlich = neuesMockToken();
  const mitglied: MockMitglied = {
    id: nextId++,
    etag: etag(),
    name,
    email,
    rolle: 'bearbeiten',
    token: persoenlich,
    entzogen: false,
  };
  aendere({ planung, zugang: 'bearbeiten', mitglied }, 'mitglied-beigetreten', { name }, () => {
    planung.mitglieder.push(mitglied);
  });
  return persoenlich;
}

export function einladen(z: MockZugang, input: EinladungInput): string {
  if (z.planung.mitglieder.some((m) => m.email === input.email && !m.entzogen)) {
    throw feld('email', 'Diese Adresse ist schon Mitglied.');
  }
  if (input.rolle === 'besitzer' && z.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  const token = neuesMockToken();
  aendere(
    z,
    'mitglied-eingeladen',
    { name: input.name, rolle: input.rolle },
    () => {
      z.planung.mitglieder.push({
        id: nextId++,
        etag: etag(),
        name: input.name,
        email: input.email,
        rolle: input.rolle,
        token,
        entzogen: false,
      });
    },
    'verwalten'
  );
  return token;
}

function mitgliedVon(z: MockZugang, id: number): MockMitglied {
  const mitglied = z.planung.mitglieder.find((m) => m.id === id && !m.entzogen);
  if (!mitglied) throw nichtGefunden();
  return mitglied;
}

export function neuerLink(z: MockZugang, id: number): { token: string; email: string } {
  const mitglied = mitgliedVon(z, id);
  if (!mitglied.email) throw feld('email', 'Für dieses Mitglied ist keine Mailadresse hinterlegt.');
  const token = neuesMockToken();
  aendere(
    z,
    'mitglied-link',
    { name: mitglied.name },
    () => {
      mitglied.token = token;
    },
    'verwalten'
  );
  return { token, email: mitglied.email };
}

export function mitgliedAendern(
  z: MockZugang,
  id: number,
  rolle: PlanungRolle | null,
  ifMatch: unknown
): void {
  const mitglied = mitgliedVon(z, id);
  if (mitglied.etag !== ifMatch) throw konflikt();
  if ((mitglied.rolle === 'besitzer' || rolle) && z.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  const besitzer = z.planung.mitglieder.filter((m) => m.rolle === 'besitzer' && !m.entzogen);
  if (mitglied.rolle === 'besitzer' && rolle !== 'besitzer' && besitzer.length <= 1) {
    throw feld('rolle', 'Eine Planung braucht mindestens eine Besitzer:in.');
  }
  aendere(
    z,
    rolle ? 'mitglied-geaendert' : 'mitglied-entzogen',
    { name: mitglied.name },
    () => {
      if (rolle) mitglied.rolle = rolle;
      else {
        mitglied.entzogen = true;
        mitglied.token = null;
      }
      mitglied.etag = etag();
    },
    'verwalten'
  );
}

export function eigenerName(z: MockZugang, name: string): void {
  if (!z.mitglied)
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  const vorher = z.mitglied.name;
  aendere(z, 'name-geaendert', { name, vorher }, () => {
    z.mitglied!.name = name;
    z.mitglied!.etag = etag();
  });
}

export function gemeinsamerLink(z: MockZugang, art: 'beitritt' | 'lesen', an: boolean): void {
  aendere(
    z,
    art === 'beitritt' ? 'link-beitritt' : 'link-lesen',
    { an },
    () => {
      z.planung[art === 'beitritt' ? 'beitritt' : 'lesen'] = an ? neuesMockToken() : null;
    },
    'verwalten'
  );
}

export function planungAendern(z: MockZugang, input: PlanungEinstellungenInput): void {
  // A field someone else changed since the form was filled is a conflict
  if (
    (input.name?.vorher !== undefined && input.name.vorher !== z.planung.name) ||
    (input.mitgliederVerwalten?.vorher !== undefined &&
      input.mitgliederVerwalten.vorher !== z.planung.mitgliederVerwalten)
  ) {
    throw konflikt();
  }
  aendere(
    z,
    'planung-geaendert',
    { name: input.name?.neu ?? z.planung.name },
    () => {
      if (input.name) z.planung.name = input.name.neu;
      if (input.mitgliederVerwalten) z.planung.mitgliederVerwalten = input.mitgliederVerwalten.neu;
    },
    'besitzer'
  );
}

export function planungLoeschen(z: MockZugang): void {
  if (z.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  planungen.splice(planungen.indexOf(z.planung), 1);
}

function tagVon(z: MockZugang, id: number): MockTag {
  const tag = z.planung.tage.find((t) => t.id === id);
  if (!tag) throw nichtGefunden();
  return tag;
}

export function tagHinzufuegen(z: MockZugang, datum: string, vorlage: string[]): void {
  if (z.planung.tage.some((t) => t.datum === datum))
    throw feld('datum', 'Diesen Tag gibt es in der Planung schon.');
  aendere(z, 'tag-neu', { datum }, () => {
    z.planung.tage.push(neuerTag(datum, vorlage));
  });
}

export function tagAendern(
  z: MockZugang,
  id: number,
  datum: string | null,
  ifMatch: unknown
): void {
  const tag = tagVon(z, id);
  if (tag.etag !== ifMatch) throw konflikt();
  if (datum && z.planung.tage.some((t) => t.datum === datum && t.id !== id)) {
    throw feld('datum', 'Diesen Tag gibt es in der Planung schon.');
  }
  aendere(z, datum ? 'tag-geaendert' : 'tag-geloescht', { datum: datum ?? tag.datum }, () => {
    if (datum) {
      tag.datum = datum;
      tag.etag = etag();
    } else z.planung.tage.splice(z.planung.tage.indexOf(tag), 1);
  });
}

function sortiere(tag: MockTag, mahlzeit: MockMahlzeit, position: number): void {
  const rest = tag.mahlzeiten.filter((m) => m !== mahlzeit).sort((a, b) => a.position - b.position);
  rest.splice(Math.min(Math.max(position - 1, 0), rest.length), 0, mahlzeit);
  rest.forEach((m, index) => {
    if (m.position !== index + 1) {
      m.position = index + 1;
      m.etag = etag();
    }
  });
}

export function mahlzeitHinzufuegen(
  z: MockZugang,
  tagId: number,
  input: MahlzeitInput,
  position?: number
): void {
  const tag = tagVon(z, tagId);
  aendere(z, 'mahlzeit-neu', { name: input.name, datum: tag.datum }, () => {
    const mahlzeit = { id: nextId++, etag: etag(), position: tag.mahlzeiten.length + 1, ...input };
    tag.mahlzeiten.push(mahlzeit);
    if (position !== undefined) sortiere(tag, mahlzeit, position);
  });
}

function mahlzeitVon(z: MockZugang, id: number): { tag: MockTag; mahlzeit: MockMahlzeit } {
  for (const tag of z.planung.tage) {
    const mahlzeit = tag.mahlzeiten.find((m) => m.id === id);
    if (mahlzeit) return { tag, mahlzeit };
  }
  throw nichtGefunden();
}

export function mahlzeitAendern(
  z: MockZugang,
  id: number,
  input: (MahlzeitInput & { position?: number }) | null,
  ifMatch: unknown
): void {
  const { tag, mahlzeit } = mahlzeitVon(z, id);
  if (mahlzeit.etag !== ifMatch) throw konflikt();
  if (!input) {
    aendere(z, 'mahlzeit-geloescht', { name: mahlzeit.name, datum: tag.datum }, () => {
      tag.mahlzeiten.splice(tag.mahlzeiten.indexOf(mahlzeit), 1);
      tag.mahlzeiten
        .sort((a, b) => a.position - b.position)
        .forEach((m, index) => (m.position = index + 1));
    });
    return;
  }
  aendere(z, 'mahlzeit-geaendert', { name: input.name, datum: tag.datum }, () => {
    mahlzeit.name = input.name;
    mahlzeit.uhrzeit = input.uhrzeit;
    mahlzeit.etag = etag();
    if (input.position !== undefined) sortiere(tag, mahlzeit, input.position);
  });
}

export function planungenUebersicht(monate: number): EssenPlanungUebersicht[] {
  return [...planungen]
    .sort((a, b) => b.id - a.id)
    .map((planung) => {
      const daten = planung.tage.map((t) => t.datum).sort();
      const letzter = daten.at(-1) ?? null;
      const aktiv = planung.mitglieder.filter((m) => !m.entzogen);
      return {
        id: planung.id,
        etag: planung.etag,
        name: planung.name,
        ersterTag: daten[0] ?? null,
        letzterTag: letzter,
        erstelltAm: planung.erstellt,
        geaendertAm: planung.geaendert,
        besitzer: aktiv
          .filter((m) => m.rolle === 'besitzer')
          .map((m) => ({ name: m.name, email: m.email })),
        mitglieder: aktiv.length,
        loeschtAm: loeschDatum(letzter ?? planung.erstellt.slice(0, 10), monate),
      };
    });
}

export function planungLoeschenSteuerung(
  id: number,
  ifMatch: unknown
): 'ok' | 'conflict' | 'not-found' {
  const planung = planungen.find((p) => p.id === id);
  if (!planung) return 'not-found';
  if (planung.etag !== ifMatch) return 'conflict';
  planungen.splice(planungen.indexOf(planung), 1);
  return 'ok';
}
