import type { Db } from './db';
import { RecordNotFoundError, VersionConflictError, requireVersion, toVersion } from './db';
import type {
  PackAenderung,
  PackEintragInput,
  PackZustaendig,
  PacklisteEintrag,
  WerkzeugAenderung,
} from './essen-packliste-model';
import { MAX_PACKLISTE, packlisteSchluessel } from './essen-packliste-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { ValidationError } from './validation/errors';

/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste). The tools come from the
 * planned dishes; a row stores what someone set at a tool (packed, who packs it) and the entries
 * of its own. Every change runs in `aendere`, which locks the Planung, so the checks here hold
 * until the end.
 */

/** The stored entries of a Planung, in the order they were added. */
export async function ladePackliste(db: Db, planungId: number): Promise<PacklisteEintrag[]> {
  const rows = await db
    .selectFrom('essen.packliste_eintrag as p')
    .leftJoin('essen.mitglied as m', 'm.id', 'p.zustaendig_mitglied_id')
    .select([
      'p.id',
      'p.version',
      'p.werkzeug',
      'p.name',
      'p.gepackt',
      'p.zustaendig_mitglied_id',
      'p.zustaendig_text',
      'm.name as mitglied_name',
    ])
    .where('p.planung_id', '=', planungId)
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      etag: toVersion(row.version),
      werkzeug: row.werkzeug,
      name: row.name,
      gepackt: row.gepackt,
      zustaendigId: row.zustaendig_mitglied_id,
      zustaendig: row.mitglied_name ?? row.zustaendig_text,
    }))
    .sort((a, b) => a.id - b.id);
}

/** The tools of the dishes that are planned at a meal, by merged name, with the first name. */
async function eingeplanteWerkzeuge(trx: Db, planungId: number): Promise<Map<string, string>> {
  const gerichte = await trx
    .selectFrom('essen.gericht as g')
    .select(['g.id', 'g.werkzeuge'])
    .where('g.planung_id', '=', planungId)
    .where((eb) =>
      eb.exists(
        eb.selectFrom('essen.einplanung as e').select('e.id').whereRef('e.gericht_id', '=', 'g.id')
      )
    )
    .orderBy('g.id')
    .execute();
  const werkzeuge = new Map<string, string>();
  for (const gericht of gerichte) {
    let namen: unknown;
    try {
      namen = JSON.parse(gericht.werkzeuge);
    } catch {
      namen = [];
    }
    if (!Array.isArray(namen)) continue;
    for (const name of namen) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const schluessel = packlisteSchluessel(name);
      if (!werkzeuge.has(schluessel)) werkzeuge.set(schluessel, name.trim());
    }
  }
  return werkzeuge;
}

/**
 * Who packs it: a member of this Planung who still has access, or a free name. One who is
 * `bisher` responsible stays allowed after losing access, so the entry can still be changed.
 */
async function pruefeZustaendig(
  trx: Db,
  zugang: Zugang,
  zustaendig: PackZustaendig,
  bisher: number | null = null
): Promise<string> {
  if (zustaendig.zustaendigId === null) return zustaendig.zustaendigText;
  const mitglied = await trx
    .selectFrom('essen.mitglied')
    .select(['id', 'name', 'entzogen_am'])
    .where('id', '=', zustaendig.zustaendigId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!mitglied || (mitglied.entzogen_am && mitglied.id !== bisher)) {
    throw new ValidationError({ zustaendigId: 'Bitte aus der Liste wählen.' });
  }
  return mitglied.name;
}

const STEHT_SCHON = () => new ValidationError({ name: 'Das steht schon auf der Packliste.' });

/** Adds an entry of its own; a name already on the list (also as a tool) is refused. */
export async function packEintragAnlegen(zugang: Zugang, input: PackEintragInput): Promise<void> {
  await aendere(zugang, 'packliste-neu', async (trx) => {
    const eigene = await trx
      .selectFrom('essen.packliste_eintrag')
      .select('name')
      .where('planung_id', '=', zugang.planungId)
      .where('werkzeug', 'is', null)
      .execute();
    if (eigene.length >= MAX_PACKLISTE) {
      throw new ValidationError({ name: `Höchstens ${MAX_PACKLISTE} eigene Einträge.` });
    }
    const schluessel = packlisteSchluessel(input.name);
    if (
      eigene.some((eintrag) => packlisteSchluessel(eintrag.name) === schluessel) ||
      (await eingeplanteWerkzeuge(trx, zugang.planungId)).has(schluessel)
    ) {
      throw STEHT_SCHON();
    }
    await pruefeZustaendig(trx, zugang, input);
    await trx
      .insertInto('essen.packliste_eintrag')
      .values({
        planung_id: zugang.planungId,
        werkzeug: null,
        name: input.name,
        zustaendig_mitglied_id: input.zustaendigId,
        zustaendig_text: input.zustaendigText,
      })
      .execute();
    return { result: undefined, details: { name: input.name } };
  });
}

/** The columns of a change and the details of its log entry. */
async function werte(
  trx: Db,
  zugang: Zugang,
  aenderung: PackAenderung,
  bisher: number | null
): Promise<{
  set: {
    gepackt?: boolean;
    zustaendig_mitglied_id?: number | null;
    zustaendig_text?: string;
  };
  details: Record<string, unknown>;
}> {
  const set: Awaited<ReturnType<typeof werte>>['set'] = {};
  const details: Record<string, unknown> = {};
  if (aenderung.gepackt !== undefined) {
    set.gepackt = aenderung.gepackt;
    details.gepackt = aenderung.gepackt;
  }
  if (aenderung.zustaendig) {
    details.zustaendig = await pruefeZustaendig(trx, zugang, aenderung.zustaendig, bisher);
    set.zustaendig_mitglied_id = aenderung.zustaendig.zustaendigId;
    set.zustaendig_text = aenderung.zustaendig.zustaendigText;
  }
  return { set, details };
}

async function eintragDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const eintrag = await trx
    .selectFrom('essen.packliste_eintrag')
    .select(['id', 'werkzeug', 'name', 'zustaendig_mitglied_id'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!eintrag) throw new RecordNotFoundError();
  return eintrag;
}

/** Packs or unpacks an entry, or changes who packs it, on the version it was shown with. */
export async function packEintragAendern(
  zugang: Zugang,
  id: number,
  aenderung: PackAenderung,
  etag: string
): Promise<void> {
  await aendere(zugang, 'packliste-geaendert', async (trx) => {
    const eintrag = await eintragDerPlanung(trx, zugang, id);
    const { set, details } = await werte(trx, zugang, aenderung, eintrag.zustaendig_mitglied_id);
    const result = await trx
      .updateTable('essen.packliste_eintrag')
      .set(set)
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: eintrag.name, ...details } };
  });
}

/** Deletes an entry of its own; the tools stay as long as a planned dish needs them. */
export async function packEintragLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'packliste-geloescht', async (trx) => {
    const eintrag = await eintragDerPlanung(trx, zugang, id);
    if (eintrag.werkzeug !== null) {
      throw new ValidationError({
        name: 'Werkzeuge der Gerichte bleiben auf der Liste, solange ein eingeplantes Gericht sie braucht.',
      });
    }
    const result = await trx
      .deleteFrom('essen.packliste_eintrag')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: eintrag.name } };
  });
}

/**
 * Sets the state of a tool of the planned dishes. The first change stores a row for it (`etag`
 * null); a row someone else stored meanwhile, or a later change of it, is a conflict.
 */
export async function werkzeugSetzen(
  zugang: Zugang,
  aenderung: WerkzeugAenderung,
  etag: string | null
): Promise<void> {
  await aendere(zugang, 'packliste-geaendert', async (trx) => {
    const schluessel = packlisteSchluessel(aenderung.werkzeug);
    const name = (await eingeplanteWerkzeuge(trx, zugang.planungId)).get(schluessel);
    if (!name) {
      throw new ValidationError({
        werkzeug: 'Kein eingeplantes Gericht braucht dieses Werkzeug mehr.',
      });
    }
    // An entry of its own with this name is the row the page shows for the tool: a request for
    // the tool comes from a page that did not see it yet, which then loads the current state
    const eigene = await trx
      .selectFrom('essen.packliste_eintrag')
      .select('name')
      .where('planung_id', '=', zugang.planungId)
      .where('werkzeug', 'is', null)
      .execute();
    if (eigene.some((eintrag) => packlisteSchluessel(eintrag.name) === schluessel)) {
      throw new VersionConflictError();
    }
    const vorhanden = await trx
      .selectFrom('essen.packliste_eintrag')
      .select(['id', 'name', 'zustaendig_mitglied_id'])
      .where('planung_id', '=', zugang.planungId)
      .where('werkzeug', '=', schluessel)
      .executeTakeFirst();
    const { set, details } = await werte(
      trx,
      zugang,
      aenderung,
      vorhanden?.zustaendig_mitglied_id ?? null
    );
    if (!vorhanden) {
      // A version of a row that is not there: the page loads the current state
      if (etag !== null) throw new VersionConflictError();
      await trx
        .insertInto('essen.packliste_eintrag')
        .values({ planung_id: zugang.planungId, werkzeug: schluessel, name, ...set })
        .execute();
    } else {
      if (etag === null) throw new VersionConflictError();
      const result = await trx
        .updateTable('essen.packliste_eintrag')
        .set(set)
        .where('id', '=', vorhanden.id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    }
    return { result: undefined, details: { name, ...details } };
  });
}
