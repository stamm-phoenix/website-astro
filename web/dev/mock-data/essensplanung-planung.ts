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
  MAX_EINPLANUNGEN_PRO_MAHLZEIT,
  neuesteVersion,
  nummeriereTage,
} from '../../../api/lib/essen-planung-model';
import type {
  AnlegenInput,
  EinladungInput,
  EinplanungInput,
  MahlzeitInput,
  PlanungAnsicht,
  PlanungEinstellungenInput,
  PlanungRolle,
  PlanungZugang,
} from '../../../api/lib/essen-planung-model';
import type { Gericht } from '../../../api/lib/essen-gerichte-model';
import type { EinplanungStatus, Verbrauch } from '../../../api/lib/essen-kochen-model';
import type { Einkauf } from '../../../api/lib/essen-einkaeufe-model';
import type { EssenPlanungUebersicht } from '../../src/lib/types';
import type { MockPlanungZutat } from './essensplanung-gerichte';
import type { PlanungGruppe, Teilnehmende } from '../../../api/lib/essen-teilnehmende-model';
import type { EinkaufPosten, Geschaeft, ZusatzPosten } from '../../../api/lib/essen-einkauf-model';
import type { MockPackEintrag } from './essensplanung-packliste';
import { essenKatalogStand } from './essensplanung';
import { belegeAnsicht } from './essensplanung-belege';
import {
  gruppenAusVorlage,
  pruefeAnwesenheit,
  sortiereTeilnehmende,
  verschiebeGrenzen,
} from './essensplanung-teilnehmende';
import { gerichteAnsicht } from './essensplanung-gerichte';

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

export interface MockEinplanung {
  id: number;
  etag: string;
  gerichtId: number;
  position: number;
  faktor: number;
  zustaendigId: number | null;
  zustaendigText: string;
  status: EinplanungStatus;
  verbrauch: Verbrauch[];
}

interface MockMahlzeit {
  id: number;
  etag: string;
  position: number;
  name: string;
  uhrzeit: string | null;
  einplanungen: MockEinplanung[];
  /** The groups that do not eat at this meal. */
  ohneGruppen: number[];
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
  gruppen: PlanungGruppe[];
  teilnehmende: Teilnehmende[];
  geschaefte: Geschaeft[];
  bestand: EinkaufPosten[];
  zusatzbedarf: ZusatzPosten[];
  einkaeufe: Einkauf[];
  packliste: MockPackEintrag[];
}

let nextId = 1;
const planungen: MockPlanung[] = [];
const anfragen = new Map<string, AnlegenInput & { planungId?: number }>();

export function neuesMockToken(): string {
  return randomBytes(32).toString('base64url');
}

let etagZaehler = 0;

/** Growing like the rowversions of the database, which `gerichtStand` compares. */
function etag(): string {
  return `"${(++etagZaehler).toString(16).padStart(16, '0')}"`;
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
      einplanungen: [],
      ohneGruppen: [],
    })),
  };
}

type GruppenVorlage = { name: string; faktor: number }[];

function erstelle(
  input: AnlegenInput,
  token: string,
  vorlage: string[],
  gruppen: GruppenVorlage
): MockPlanung {
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
    gruppen: gruppenAusVorlage(gruppen),
    teilnehmende: [],
    geschaefte: [],
    bestand: [],
    zusatzbedarf: [],
    einkaeufe: [],
    packliste: [],
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
  VORLAGE,
  [
    { name: 'Wö', faktor: 0.7 },
    { name: 'Jupfi', faktor: 0.8 },
    { name: 'Pfadi', faktor: 1 },
    { name: 'Rover', faktor: 1.2 },
    { name: 'Leitende', faktor: 1.2 },
  ]
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
    planung.tage.flatMap((tag) =>
      tag.mahlzeiten.map((m) => ({
        ...m,
        tagId: tag.id,
        einplanungen: m.einplanungen.map(({ zustaendigText, ...e }) => ({
          ...e,
          zustaendig:
            e.zustaendigId === null
              ? zustaendigText
              : (planung.mitglieder.find((x) => x.id === e.zustaendigId)?.name ?? ''),
        })),
      }))
    )
  );
  const letzter = tage.at(-1)?.datum;
  return {
    id: planung.id,
    etag: planung.etag,
    name: planung.name,
    seq: planung.seq,
    stand: `${planung.seq}.${wartung ? 1 : 0}.${monate}.${essenKatalogStand()}`,
    katalogStand: essenKatalogStand(),
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
    gruppen: planung.gruppen.slice().sort((a, b) => a.position - b.position),
    teilnehmende: sortiereTeilnehmende(planung),
    geschaefte: planung.geschaefte.slice().sort((a, b) => a.position - b.position),
    bestand: planung.bestand,
    zusatzbedarf: planung.zusatzbedarf,
    einkaeufe: planung.einkaeufe.slice().sort((a, b) => a.position - b.position || a.id - b.id),
    packliste: planung.packliste.map(({ zustaendigText, ...eintrag }) => ({
      ...eintrag,
      zustaendig:
        eintrag.zustaendigId === null
          ? zustaendigText
          : (planung.mitglieder.find((m) => m.id === eintrag.zustaendigId)?.name ?? ''),
    })),
    belege: belegeAnsicht(planung),
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

export function konflikt(): MockPlanungFehler {
  return new MockPlanungFehler(409, 'CONFLICT', 'Jemand anderes hat das gerade geändert.');
}

export function nichtGefunden(): MockPlanungFehler {
  return new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');
}

export function feld(field: string, message: string): MockPlanungFehler {
  return new MockPlanungFehler(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
    [field]: message,
  });
}

export function anfrage(input: AnlegenInput): string {
  const token = neuesMockToken();
  anfragen.set(token, { ...input });
  return token;
}

export function bestaetige(token: unknown, vorlage: string[], gruppen: GruppenVorlage): string {
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
  eintrag.planungId = erstelle(eintrag, besitzerToken, vorlage, gruppen).id;
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
  // Deleting covers the meals and their dishes, like `tagStand`
  const stand = datum
    ? tag.etag
    : neuesteVersion([tag.etag, ...tag.mahlzeiten.map(mahlzeitStandVon)]);
  if (stand !== ifMatch) throw konflikt();
  if (datum && z.planung.tage.some((t) => t.datum === datum && t.id !== id)) {
    throw feld('datum', 'Diesen Tag gibt es in der Planung schon.');
  }
  aendere(z, datum ? 'tag-geaendert' : 'tag-geloescht', { datum: datum ?? tag.datum }, () => {
    if (datum) {
      const vorher = tag.datum;
      tag.datum = datum;
      try {
        pruefeAnwesenheit(z.planung);
      } catch (error: unknown) {
        tag.datum = vorher;
        throw error;
      }
      tag.etag = etag();
    } else {
      verschiebeGrenzen(
        z.planung,
        tag.mahlzeiten.map((m) => m.id)
      );
      z.planung.tage.splice(z.planung.tage.indexOf(tag), 1);
    }
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
    const mahlzeit = {
      id: nextId++,
      etag: etag(),
      position: tag.mahlzeiten.length + 1,
      ...input,
      einplanungen: [],
      ohneGruppen: [],
    };
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
  if ((input ? mahlzeit.etag : mahlzeitStandVon(mahlzeit)) !== ifMatch) throw konflikt();
  if (!input) {
    aendere(z, 'mahlzeit-geloescht', { name: mahlzeit.name, datum: tag.datum }, () => {
      verschiebeGrenzen(z.planung, [mahlzeit.id]);
      tag.mahlzeiten.splice(tag.mahlzeiten.indexOf(mahlzeit), 1);
      tag.mahlzeiten
        .sort((a, b) => a.position - b.position)
        .forEach((m, index) => (m.position = index + 1));
    });
    return;
  }
  aendere(z, 'mahlzeit-geaendert', { name: input.name, datum: tag.datum }, () => {
    if (input.position !== undefined) {
      const vorher = new Map(
        tag.mahlzeiten.map((m) => [m, { position: m.position, etag: m.etag }])
      );
      sortiere(tag, mahlzeit, input.position);
      try {
        pruefeAnwesenheit(z.planung);
      } catch (error: unknown) {
        for (const [m, alt] of vorher) Object.assign(m, alt);
        throw error;
      }
    }
    mahlzeit.name = input.name;
    mahlzeit.uhrzeit = input.uhrzeit;
    mahlzeit.etag = etag();
  });
}

function mahlzeitStandVon(mahlzeit: MockMahlzeit): string {
  return neuesteVersion([mahlzeit.etag, ...mahlzeit.einplanungen.map((e) => e.etag)]);
}

function sortiereEinplanungen(
  mahlzeit: MockMahlzeit,
  einplanung?: MockEinplanung,
  position?: number
) {
  const rest = mahlzeit.einplanungen
    .filter((e) => e !== einplanung)
    .sort((a, b) => a.position - b.position);
  if (einplanung)
    rest.splice(
      Math.min(Math.max((position ?? rest.length + 1) - 1, 0), rest.length),
      0,
      einplanung
    );
  rest.forEach((e, index) => {
    if (e.position !== index + 1) {
      e.position = index + 1;
      e.etag = etag();
    }
  });
  mahlzeit.einplanungen = rest;
}

function pruefeEinplanung(z: MockZugang, input: EinplanungInput, bisher: number | null = null) {
  const ziel = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten.map((mahlzeit) => ({ tag, mahlzeit })))
    .find(({ mahlzeit }) => mahlzeit.id === input.mahlzeitId);
  if (!ziel) throw feld('mahlzeitId', 'Diese Mahlzeit gibt es nicht mehr.');
  const gericht = z.planung.gerichte.find((g) => g.id === input.gerichtId);
  if (!gericht) throw feld('gerichtId', 'Dieses Gericht gibt es nicht mehr.');
  if (
    input.zustaendigId !== null &&
    input.zustaendigId !== bisher &&
    !z.planung.mitglieder.some((m) => m.id === input.zustaendigId && !m.entzogen)
  )
    throw feld('zustaendigId', 'Bitte aus der Liste wählen.');
  return { ...ziel, gericht };
}

function platz(mahlzeit: MockMahlzeit): void {
  if (mahlzeit.einplanungen.length >= MAX_EINPLANUNGEN_PRO_MAHLZEIT)
    throw feld('mahlzeitId', `Höchstens ${MAX_EINPLANUNGEN_PRO_MAHLZEIT} Gerichte pro Mahlzeit.`);
}

/** Plans a dish at a meal, like `essen-einplanung.ts`. */
export function einplanen(z: MockZugang, input: EinplanungInput, position?: number): void {
  const { tag, mahlzeit, gericht } = pruefeEinplanung(z, input);
  platz(mahlzeit);
  const details = { name: gericht.name, mahlzeit: mahlzeit.name, datum: tag.datum };
  aendere(z, 'einplanung-neu', details, () => {
    const einplanung: MockEinplanung = {
      id: nextId++,
      etag: etag(),
      gerichtId: gericht.id,
      position: mahlzeit.einplanungen.length + 1,
      faktor: input.faktor,
      zustaendigId: input.zustaendigId,
      zustaendigText: input.zustaendigId === null ? input.zustaendigText : '',
      status: 'offen',
      verbrauch: [],
    };
    mahlzeit.einplanungen.push(einplanung);
    sortiereEinplanungen(mahlzeit, einplanung, position);
  });
}

/** Changes, moves (`input`) or deletes (null) a planned dish. */
export function einplanungAendern(
  z: MockZugang,
  id: number,
  input: EinplanungInput | null,
  ifMatch: unknown,
  position?: number
): void {
  const quelle = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten.map((mahlzeit) => ({ tag, mahlzeit })))
    .find(({ mahlzeit }) => mahlzeit.einplanungen.some((e) => e.id === id));
  if (!quelle) throw nichtGefunden();
  const einplanung = quelle.mahlzeit.einplanungen.find((e) => e.id === id)!;
  const gericht = z.planung.gerichte.find((g) => g.id === einplanung.gerichtId)!;
  if (!input) {
    if (einplanung.etag !== ifMatch) throw konflikt();
    const details = { name: gericht.name, mahlzeit: quelle.mahlzeit.name, datum: quelle.tag.datum };
    aendere(z, 'einplanung-geloescht', details, () => {
      quelle.mahlzeit.einplanungen.splice(quelle.mahlzeit.einplanungen.indexOf(einplanung), 1);
      sortiereEinplanungen(quelle.mahlzeit);
    });
    return;
  }
  const { tag, mahlzeit } = pruefeEinplanung(
    z,
    { ...input, gerichtId: einplanung.gerichtId },
    einplanung.zustaendigId
  );
  const verschoben = mahlzeit !== quelle.mahlzeit;
  if (verschoben) platz(mahlzeit);
  if (einplanung.etag !== ifMatch) throw konflikt();
  const details = {
    name: gericht.name,
    mahlzeit: mahlzeit.name,
    datum: tag.datum,
    ...(verschoben ? { verschoben: true } : {}),
  };
  aendere(z, 'einplanung-geaendert', details, () => {
    Object.assign(einplanung, {
      etag: etag(),
      faktor: input.faktor,
      zustaendigId: input.zustaendigId,
      zustaendigText: input.zustaendigId === null ? input.zustaendigText : '',
    });
    if (verschoben) {
      quelle.mahlzeit.einplanungen.splice(quelle.mahlzeit.einplanungen.indexOf(einplanung), 1);
      sortiereEinplanungen(quelle.mahlzeit);
      mahlzeit.einplanungen.push(einplanung);
      sortiereEinplanungen(mahlzeit, einplanung, position);
    } else if (position !== undefined) sortiereEinplanungen(mahlzeit, einplanung, position);
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
