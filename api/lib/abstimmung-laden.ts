/**
 * Reading an Abstimmung (`abstimmungen.ts`): the head row, options, invitations and answers.
 */
import type { Db } from './db';
import type {
  AbstimmungMailArt,
  AbstimmungRohdaten,
  AbstimmungSichtbarkeit,
  AbstimmungTeilnahme,
} from './abstimmung-model';

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

export interface Geladen {
  row: AbstimmungKopf;
  rohdaten: AbstimmungRohdaten;
  teilnahmen: TeilnahmeRow[];
  stimmen: Map<number, Antwort>;
}

/** Seam for tests: runs between reading the answers and reading the Abstimmung. */
export const abstimmungLesen = {
  nachAntworten: async (): Promise<void> => undefined,
};

/**
 * Reads an Abstimmung with its options, invitations and answers. The Abstimmung itself is read
 * last: answers that exist never become more visible (`updateAbstimmung`), so the `sichtbarkeit`
 * read after the answers is never looser than the one an answer given meanwhile was saved under.
 * Reading it first would need a second read afterwards to catch a change in between.
 */
export async function ladeAbstimmung(db: Db, id: number): Promise<Geladen | undefined> {
  const [optionen, teilnahmen, stimmen] = await Promise.all([
    loadOptionen(db, id),
    loadTeilnahmen(db, id),
    loadStimmen(db, id),
  ]);
  await abstimmungLesen.nachAntworten();
  const row = await loadRow(db, id);
  if (!row) return undefined;
  const order = new Map(optionen.map((option, index) => [option.id, index]));
  const sorted = (ids: number[] | undefined): number[] =>
    (ids ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const rohdaten: AbstimmungRohdaten = {
    id: row.id,
    titel: row.titel,
    beschreibung: row.beschreibung,
    maxAuswahl: row.max_auswahl,
    vielleichtErlaubt: row.vielleicht,
    sichtbarkeit: row.sichtbarkeit,
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
