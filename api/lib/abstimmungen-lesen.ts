import { getDb, toVersion } from './db';
import type { Db } from './db';
import { abstimmungEinsicht, abstimmungErgebnis } from './abstimmung-model';
import type {
  AbstimmungAnsicht,
  AbstimmungDetail,
  AbstimmungMailArt,
  AbstimmungRohdaten,
  AbstimmungSichtbarkeit,
  AbstimmungTeilnahme,
  AbstimmungUebersicht,
} from './abstimmung-model';
import { abstimmungLink } from './abstimmungen-basis';
import type { AbstimmungIdentitaet } from './abstimmungen-basis';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** A row of `abstimmung.abstimmung`. */
export interface AbstimmungKopf {
  id: number;
  version: Buffer;
  titel: string;
  beschreibung: string;
  max_auswahl: number | null;
  vielleicht: boolean;
  sichtbarkeit: AbstimmungSichtbarkeit;
  link_token: string;
  erstellt_von: string;
  erstellt_von_name: string;
  erstellt_am: Date;
  geschlossen_am: Date | null;
}

export async function loadRow(db: Db, id: number): Promise<AbstimmungKopf | undefined> {
  return db.selectFrom('abstimmung.abstimmung').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function loadOptionen(db: Db, id: number): Promise<{ id: number; text: string }[]> {
  return db
    .selectFrom('abstimmung.optionen')
    .select(['id', 'text'])
    .where('abstimmung_id', '=', id)
    .orderBy('position')
    .orderBy('id')
    .execute();
}

/** The options one person chose with „Ja“ (`gewaehlt`) and with „Vielleicht“. */
export interface Antwort {
  gewaehlt: number[];
  vielleicht: number[];
}

/** The votes of every person of the Abstimmung, by participation. */
async function loadStimmen(db: Db, id: number): Promise<Map<number, Antwort>> {
  const rows = await db
    .selectFrom('abstimmung.stimme as s')
    .innerJoin('abstimmung.teilnahme as t', 't.id', 's.teilnahme_id')
    .select(['s.teilnahme_id', 's.option_id', 's.vielleicht'])
    .where('t.abstimmung_id', '=', id)
    .execute();
  const result = new Map<number, Antwort>();
  for (const row of rows) {
    const antwort = result.get(row.teilnahme_id) ?? { gewaehlt: [], vielleicht: [] };
    (row.vielleicht ? antwort.vielleicht : antwort.gewaehlt).push(row.option_id);
    result.set(row.teilnahme_id, antwort);
  }
  return result;
}

export interface TeilnahmeRow {
  id: number;
  token: string;
  name: string;
  login: string | null;
  email: string | null;
  geantwortet_am: Date | null;
  mail_art: AbstimmungMailArt | null;
  mail_status: AbstimmungTeilnahme['mailStatus'];
  eingeladen_am: Date | null;
  erinnert_am: Date | null;
  familie: boolean;
  alias_von: number | null;
}

export async function loadTeilnahmen(db: Db, id: number): Promise<TeilnahmeRow[]> {
  return db
    .selectFrom('abstimmung.teilnahme')
    .select([
      'id',
      'token',
      'name',
      'login',
      'email',
      'geantwortet_am',
      'mail_art',
      'mail_status',
      'eingeladen_am',
      'erinnert_am',
      'familie',
      'alias_von',
    ])
    .where('abstimmung_id', '=', id)
    .orderBy('id')
    .execute();
}

interface Geladen {
  row: AbstimmungKopf;
  rohdaten: AbstimmungRohdaten;
  teilnahmen: TeilnahmeRow[];
  stimmen: Map<number, Antwort>;
}

/** Seam for tests: runs between reading the answers and reading the Abstimmung itself. */
export const abstimmungLesen = {
  nachAntworten: async (): Promise<void> => undefined,
};

export async function load(db: Db, id: number): Promise<Geladen | undefined> {
  // The reads are separate. The Abstimmung is read last: answers that exist never become more
  // visible (`updateAbstimmung`), so if the setting became stricter meanwhile, the later read
  // already shows it, and an answer given under the new setting is never shown under the old one
  const [optionen, teilnahmen, stimmen] = await Promise.all([
    loadOptionen(db, id),
    loadTeilnahmen(db, id),
    loadStimmen(db, id),
  ]);
  await abstimmungLesen.nachAntworten();
  const row = await loadRow(db, id);
  if (!row) return undefined;
  const sichtbarkeit = row.sichtbarkeit;
  const order = new Map(optionen.map((option, index) => [option.id, index]));
  const sorted = (ids: number[] | undefined): number[] =>
    (ids ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const rohdaten: AbstimmungRohdaten = {
    id: row.id,
    titel: row.titel,
    beschreibung: row.beschreibung,
    maxAuswahl: row.max_auswahl,
    vielleichtErlaubt: row.vielleicht,
    sichtbarkeit,
    geschlossen: row.geschlossen_am !== null,
    erstelltVonName: row.erstellt_von_name,
    optionen,
    // A family invitation only records that someone of the family answered; another invitation
    // of a leader answers through the leader's participation
    antworten: teilnahmen
      .filter(
        (teilnahme) =>
          teilnahme.geantwortet_am !== null && !teilnahme.familie && teilnahme.alias_von === null
      )
      .map((teilnahme) => ({
        teilnahmeId: teilnahme.id,
        name: teilnahme.name || 'Ohne Namen',
        gewaehlt: sorted(stimmen.get(teilnahme.id)?.gewaehlt),
        vielleicht: sorted(stimmen.get(teilnahme.id)?.vielleicht),
      })),
  };
  return { row, rohdaten, teilnahmen, stimmen };
}

export function ich(
  geladen: Geladen,
  teilnahme: TeilnahmeRow | undefined
): AbstimmungAnsicht['ich'] {
  if (!teilnahme) return null;
  // The link of a family: everyone enters their own name and answer
  if (teilnahme.familie) return { name: '', gewaehlt: [], vielleicht: [], geantwortet: false };
  const antwort = geladen.rohdaten.antworten.find((a) => a.teilnahmeId === teilnahme.id);
  return {
    name: teilnahme.name,
    gewaehlt: antwort?.gewaehlt ?? [],
    vielleicht: antwort?.vielleicht ?? [],
    geantwortet: teilnahme.geantwortet_am !== null,
  };
}

/** The participation another invitation of the same leader answers through, or the row itself. */
export function hauptTeilnahme(teilnahmen: TeilnahmeRow[], teilnahme: TeilnahmeRow): TeilnahmeRow {
  return (
    (teilnahme.alias_von !== null && teilnahmen.find((t) => t.id === teilnahme.alias_von)) ||
    teilnahme
  );
}

/**
 * The participation of the logged-in person: by login, else an invitation to one of their
 * addresses. A family invitation belongs to no single person.
 */
export function eigeneTeilnahme<T extends Pick<TeilnahmeRow, 'login' | 'email' | 'familie'>>(
  teilnahmen: T[],
  person: AbstimmungIdentitaet
): T | undefined {
  return (
    teilnahmen.find((t) => t.login === person.login) ??
    teilnahmen.find(
      (t) => t.login === null && !t.familie && t.email && person.adressen.includes(t.email)
    )
  );
}

/** The Abstimmungen, newest first, with the own answer. */
export async function listAbstimmungen(
  person: AbstimmungIdentitaet
): Promise<AbstimmungUebersicht[]> {
  const db = getDb();
  const [rows, gezaehlt, eigene] = await Promise.all([
    db
      .selectFrom('abstimmung.abstimmung')
      .select(['id', 'titel', 'erstellt_von', 'erstellt_von_name', 'erstellt_am', 'geschlossen_am'])
      .orderBy('erstellt_am', 'desc')
      .orderBy('id', 'desc')
      .execute(),
    db
      .selectFrom('abstimmung.teilnahme')
      .select(['abstimmung_id', (eb) => eb.fn.countAll<number>().as('anzahl')])
      .where('geantwortet_am', 'is not', null)
      .where('familie', '=', false)
      .where('alias_von', 'is', null)
      .groupBy('abstimmung_id')
      .execute(),
    // Only the rows that can be the person's own
    db
      .selectFrom('abstimmung.teilnahme')
      .select(['abstimmung_id', 'login', 'email', 'familie', 'geantwortet_am'])
      .where((eb) =>
        eb.or([
          eb('login', '=', person.login),
          ...(person.adressen.length ? [eb('email', 'in', person.adressen)] : []),
        ])
      )
      .execute(),
  ]);
  const antworten = new Map(gezaehlt.map((row) => [row.abstimmung_id, Number(row.anzahl)]));
  const eigeneJe = new Map<number, typeof eigene>();
  for (const teilnahme of eigene) {
    const liste = eigeneJe.get(teilnahme.abstimmung_id);
    if (liste) liste.push(teilnahme);
    else eigeneJe.set(teilnahme.abstimmung_id, [teilnahme]);
  }
  return rows.map((row) => {
    const mine = eigeneTeilnahme(eigeneJe.get(row.id) ?? [], person);
    return {
      id: row.id,
      titel: row.titel,
      geschlossen: row.geschlossen_am !== null,
      erstelltVonName: row.erstellt_von_name,
      erstelltAm: row.erstellt_am.toISOString(),
      eigene: row.erstellt_von === person.login,
      antworten: antworten.get(row.id) ?? 0,
      ichGeantwortet: Boolean(mine?.geantwortet_am),
    };
  });
}

/** One Abstimmung for the Leitendenbereich; the organizer also gets the link and the invitations. */
export async function getAbstimmungDetail(
  id: number,
  person: AbstimmungIdentitaet,
  siteUrl: string
): Promise<AbstimmungDetail | undefined> {
  const geladen = await load(getDb(), id);
  if (!geladen) return undefined;
  const { row, teilnahmen } = geladen;
  const eigene = row.erstellt_von === person.login;
  return {
    ...abstimmungErgebnis(
      geladen.rohdaten,
      abstimmungEinsicht(geladen.rohdaten.sichtbarkeit, eigene)
    ),
    ich: ich(geladen, eigeneTeilnahme(teilnahmen, person)),
    etag: toVersion(row.version),
    erstelltAm: row.erstellt_am.toISOString(),
    eigene,
    link: eigene ? abstimmungLink(siteUrl, row.link_token) : null,
    teilnahmen: eigene
      ? teilnahmen.map((t) => ({
          id: t.id,
          name: t.name,
          email: t.email ?? '',
          geantwortet: hauptTeilnahme(teilnahmen, t).geantwortet_am !== null,
          eingeladenAm: iso(t.eingeladen_am),
          erinnertAm: iso(t.erinnert_am),
          mailStatus: t.mail_status,
        }))
      : null,
  };
}

/** Title, organizer and state, e.g. to check rights and for the mails. */
export async function getAbstimmungKopf(id: number): Promise<AbstimmungKopf | undefined> {
  return loadRow(getDb(), id);
}
