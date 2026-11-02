import type { Db } from './db';
import { RecordNotFoundError, VersionConflictError, requireVersion, toVersion } from './db';
import type {
  PackAenderung,
  PackEintragInput,
  PacklisteEintrag,
  WerkzeugAenderung,
} from './essen-packliste-model';
import { MAX_PACKLISTE, packlisteSchluessel } from './essen-packliste-model';
import { allePacken, ladeZuteilungen, personenAendern } from './essen-packliste-zuteilung';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { ValidationError } from './validation/errors';

/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste). The tools come from the
 * planned dishes; a row stores what someone set at a tool (packed, who packs it) and the entries
 * of its own. The persons who pack an entry are in `essen-packliste-zuteilung.ts`. Every change runs in `aendere`, which locks the Planung, so the checks here hold
 * until the end.
 */

/** The stored entries of a Planung, in the order they were added, with their persons. */
export async function ladePackliste(db: Db, planungId: number): Promise<PacklisteEintrag[]> {
  const [rows, zuteilungen] = await Promise.all([
    db
      .selectFrom('essen.packliste_eintrag')
      .select(['id', 'version', 'werkzeug', 'name', 'gepackt'])
      .where('planung_id', '=', planungId)
      .orderBy('id')
      .execute(),
    ladeZuteilungen(db, planungId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    etag: toVersion(row.version),
    werkzeug: row.werkzeug,
    name: row.name,
    gepackt: row.gepackt,
    zuteilungen: zuteilungen.get(row.id) ?? [],
  }));
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
    const { id } = await trx
      .insertInto('essen.packliste_eintrag')
      .values({ planung_id: zugang.planungId, werkzeug: null, name: input.name })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const { hinzu } = await personenAendern(trx, zugang, { id, gepackt: false }, input);
    return { result: undefined, details: { name: input.name, ...(hinzu.length ? { hinzu } : {}) } };
  });
}

/**
 * Applies a change to a stored entry: the whole entry packed on the version `etag` (also the
 * boxes of its persons), then persons added and taken off, which merge without a version.
 * Returns the details of the log entry.
 */
async function anwenden(
  trx: Db,
  zugang: Zugang,
  eintrag: { id: number; gepackt: boolean },
  aenderung: PackAenderung,
  etag: string | null
): Promise<Record<string, unknown>> {
  const details: Record<string, unknown> = {};
  let gepackt = eintrag.gepackt;
  if (aenderung.gepackt !== undefined) {
    if (etag === null) throw new VersionConflictError();
    const result = await trx
      .updateTable('essen.packliste_eintrag')
      .set({ gepackt: aenderung.gepackt })
      .where('id', '=', eintrag.id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await allePacken(trx, eintrag.id, aenderung.gepackt);
    gepackt = aenderung.gepackt;
    details.gepackt = aenderung.gepackt;
  }
  if (aenderung.hinzu || aenderung.weg) {
    const personen = await personenAendern(
      trx,
      zugang,
      { id: eintrag.id, gepackt },
      aenderung.hinzu,
      aenderung.weg
    );
    if (personen.hinzu.length) details.hinzu = personen.hinzu;
    if (personen.weg.length) details.weg = personen.weg;
  }
  return details;
}

async function eintragDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const eintrag = await trx
    .selectFrom('essen.packliste_eintrag')
    .select(['id', 'werkzeug', 'name', 'gepackt'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!eintrag) throw new RecordNotFoundError();
  return eintrag;
}

/**
 * Packs or unpacks an entry on the version it was shown with, or adds and takes off who packs it.
 */
export async function packEintragAendern(
  zugang: Zugang,
  id: number,
  aenderung: PackAenderung,
  etag: string | null
): Promise<void> {
  await aendere(zugang, 'packliste-geaendert', async (trx) => {
    const eintrag = await eintragDerPlanung(trx, zugang, id);
    const details = await anwenden(trx, zugang, eintrag, aenderung, etag);
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
 * null). Packing a row someone else stored meanwhile, or changed later, is a conflict; persons
 * merge like at an entry.
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
      .select(['id', 'gepackt'])
      .where('planung_id', '=', zugang.planungId)
      .where('werkzeug', '=', schluessel)
      .executeTakeFirst();
    let details: Record<string, unknown>;
    if (vorhanden) {
      details = await anwenden(trx, zugang, vorhanden, aenderung, etag);
    } else {
      // A version of a row that is not there: the page loads the current state
      if (etag !== null) throw new VersionConflictError();
      const gepackt = aenderung.gepackt ?? false;
      const { id } = await trx
        .insertInto('essen.packliste_eintrag')
        .values({ planung_id: zugang.planungId, werkzeug: schluessel, name, gepackt })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      details = await anwenden(
        trx,
        zugang,
        { id, gepackt },
        { ...aenderung, gepackt: undefined },
        null
      );
      if (aenderung.gepackt !== undefined) details = { gepackt, ...details };
    }
    return { result: undefined, details: { name, ...details } };
  });
}
