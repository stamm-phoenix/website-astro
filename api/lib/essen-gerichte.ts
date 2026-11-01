import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  lockResource,
  requireVersion,
  toVersion,
} from './db';
import type {
  EssenKatalog,
  Gericht,
  GerichtLink,
  GerichtZutat,
  PlanungZutat,
} from './essen-gerichte-model';
import {
  MAX_GERICHTE,
  MAX_PLANUNG_ZUTATEN,
  gerichtSperre,
  gerichtStand,
} from './essen-gerichte-model';
import type { GerichtInput, PlanungZutatInput } from './essen-gerichte-validation';
import { validatePlanungZutat } from './essen-gerichte-validation';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { sortiere as sortiereEinplanungen } from './essen-einplanung';
import { listKategorien, listUnvertraeglichkeiten, listZutaten } from './essen-steuerung';
import { COLLATOR } from './essen-validation';
import { ValidationError } from './validation/errors';
import { zutatDerPlanung } from './essen-planung-zutat';

/**
 * Dishes of a Planung and the ingredients they use (`docs/essensplanung.md`, „Gerichte“). Every
 * change runs through `aendere()`, so it counts as a change of the Planung and reaches the other
 * open pages.
 */

const UNIQUE_VIOLATION = new Set([2601, 2627]);

function parseArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The central lists a Planung picks ingredients from. */
export async function ladeKatalog(db: Db = getDb()): Promise<EssenKatalog> {
  const [kategorien, unvertraeglichkeiten, zutaten] = await Promise.all([
    listKategorien(db),
    listUnvertraeglichkeiten(db),
    listZutaten(db),
  ]);
  return {
    kategorien: kategorien.map(({ id, name }) => ({ id, name })),
    unvertraeglichkeiten: unvertraeglichkeiten.map(({ id, name, schluessel }) => ({
      id,
      name,
      schluessel,
    })),
    zutaten: zutaten.map((zutat) => ({
      id: zutat.id,
      name: zutat.name,
      kategorieId: zutat.kategorieId,
      einheitenart: zutat.einheitenart,
      abtropfgewicht: zutat.abtropfgewicht,
      lebensmittel: zutat.lebensmittel,
      vegetarisch: zutat.vegetarisch,
      vegan: zutat.vegan,
      allergene: zutat.allergene,
      grammProTl: zutat.grammProTl,
      grammProEl: zutat.grammProEl,
      grammProStueck: zutat.grammProStueck,
    })),
  };
}

/**
 * A short version of the central lists (ingredients, categories, intolerances): newest row
 * version and number of rows of each, so changes and deletions in the Steuerung reach open
 * Planungen with the next poll.
 */
export async function ladeKatalogStand(db: Db): Promise<string> {
  const row = await sql<{ stand: string }>`
    select concat(
      (select count_big(*) from essen.zutat), '-',
      (select convert(varchar(18), max(version), 2) from essen.zutat), '-',
      (select count_big(*) from essen.kategorie), '-',
      (select convert(varchar(18), max(version), 2) from essen.kategorie), '-',
      (select count_big(*) from essen.unvertraeglichkeit), '-',
      (select convert(varchar(18), max(version), 2) from essen.unvertraeglichkeit)
    ) as stand`.execute(db);
  return createHash('sha256')
    .update(row.rows[0]?.stand ?? '')
    .digest('hex')
    .slice(0, 12);
}

/** The ingredients and dishes of a Planung, for its view. */
export async function ladeGerichte(
  db: Db,
  planungId: number
): Promise<{ zutaten: PlanungZutat[]; gerichte: Gericht[] }> {
  const [zutaten, gerichte, zeilen, zeilenUnvertraeglichkeiten] = await Promise.all([
    db
      .selectFrom('essen.planung_zutat as pz')
      .leftJoin('essen.zutat as z', 'z.id', 'pz.zutat_id')
      .select([
        'pz.id',
        'pz.version',
        'pz.zutat_id',
        'pz.name',
        'pz.kategorie_id',
        'pz.einheitenart',
        'pz.vegetarisch',
        'pz.vegan',
        'pz.lebensmittel',
        'z.name as z_name',
        'z.kategorie_id as z_kategorie_id',
        'z.einheitenart as z_einheitenart',
        'z.abtropfgewicht as z_abtropfgewicht',
        'z.lebensmittel as z_lebensmittel',
        'z.vegetarisch as z_vegetarisch',
        'z.vegan as z_vegan',
        sql<string | null>`(select string_agg(cast(x.unvertraeglichkeit_id as varchar(12)), ',')
          from (
            select zu.unvertraeglichkeit_id from essen.zutat_unvertraeglichkeit zu
              where zu.zutat_id = pz.zutat_id
            union all
            select pzu.unvertraeglichkeit_id from essen.planung_zutat_unvertraeglichkeit pzu
              where pzu.planung_zutat_id = pz.id
          ) x)`.as('allergen_ids'),
        sql<number>`(select count(*) from essen.gericht_zutat gz where gz.planung_zutat_id = pz.id)
          + (select count(*) from essen.bestand b where b.planung_zutat_id = pz.id)
          + (select count(*) from essen.zusatzbedarf zb where zb.planung_zutat_id = pz.id)
          + (select count(*) from essen.einkauf_posten ep where ep.planung_zutat_id = pz.id)
          + (select count(*) from essen.einkauf_regel er where er.planung_zutat_id = pz.id)
          + (select count(*) from essen.einplanung_verbrauch ev where ev.planung_zutat_id = pz.id)`.as(
          'zeilen'
        ),
        'pz.geschaeft_id',
      ])
      .where('pz.planung_id', '=', planungId)
      .execute(),
    db.selectFrom('essen.gericht').selectAll().where('planung_id', '=', planungId).execute(),
    db
      .selectFrom('essen.gericht_zutat as gz')
      .innerJoin('essen.gericht as g', 'g.id', 'gz.gericht_id')
      .selectAll('gz')
      .where('g.planung_id', '=', planungId)
      .execute(),
    db
      .selectFrom('essen.gericht_zutat_unvertraeglichkeit as gzu')
      .innerJoin('essen.gericht_zutat as gz', 'gz.id', 'gzu.gericht_zutat_id')
      .innerJoin('essen.gericht as g', 'g.id', 'gz.gericht_id')
      .select(['gzu.gericht_zutat_id', 'gzu.unvertraeglichkeit_id', 'gzu.nur'])
      .where('g.planung_id', '=', planungId)
      .execute(),
  ]);
  const unvertraeglich = new Map<number, { ohne: number[]; nur: number[] }>();
  for (const row of zeilenUnvertraeglichkeiten) {
    const entry = unvertraeglich.get(row.gericht_zutat_id) ?? { ohne: [], nur: [] };
    (row.nur ? entry.nur : entry.ohne).push(row.unvertraeglichkeit_id);
    unvertraeglich.set(row.gericht_zutat_id, entry);
  }
  const zeilenJeGericht = new Map<number, GerichtZutat[]>();
  for (const zeile of zeilen) {
    const liste = zeilenJeGericht.get(zeile.gericht_id) ?? [];
    const { ohne = [], nur = [] } = unvertraeglich.get(zeile.id) ?? {};
    liste.push({
      id: zeile.id,
      etag: toVersion(zeile.version),
      position: zeile.position,
      planungZutatId: zeile.planung_zutat_id,
      menge: zeile.menge === null ? null : Number(zeile.menge),
      einheit: zeile.einheit,
      fest: zeile.fest,
      fuerAlles: zeile.fuer_alles,
      fuerVegetarisch: zeile.fuer_vegetarisch,
      fuerVegan: zeile.fuer_vegan,
      ohne: ohne.sort((a, b) => a - b),
      nur: nur.sort((a, b) => a - b),
      hinweis: zeile.hinweis,
    });
    zeilenJeGericht.set(zeile.gericht_id, liste);
  }
  return {
    zutaten: zutaten
      .map((row): PlanungZutat => {
        const zentral = row.zutat_id !== null;
        return {
          id: row.id,
          etag: toVersion(row.version),
          zutatId: row.zutat_id,
          name: (zentral ? row.z_name : row.name) ?? '',
          kategorieId: (row.kategorie_id ?? row.z_kategorie_id)!,
          einheitenart: (row.einheitenart ?? row.z_einheitenart)!,
          abtropfgewicht: zentral ? Boolean(row.z_abtropfgewicht) : false,
          lebensmittel: zentral ? Boolean(row.z_lebensmittel) : Boolean(row.lebensmittel),
          vegetarisch: zentral ? row.z_vegetarisch : row.vegetarisch,
          vegan: zentral ? row.z_vegan : row.vegan,
          allergene: row.allergen_ids
            ? [...new Set(row.allergen_ids.split(',').map(Number))].sort((a, b) => a - b)
            : [],
          abweichend: {
            kategorie: zentral && row.kategorie_id !== null,
            einheitenart: zentral && row.einheitenart !== null,
          },
          zeilen: Number(row.zeilen),
          geschaeftId: row.geschaeft_id,
        };
      })
      .sort((a, b) => COLLATOR.compare(a.name, b.name)),
    gerichte: gerichte
      .map((row): Gericht => ({
        id: row.id,
        etag: toVersion(row.version),
        name: row.name,
        personen: row.personen,
        anleitung: row.anleitung,
        notiz: row.notiz,
        links: parseArray(row.links) as GerichtLink[],
        werkzeuge: parseArray(row.werkzeuge) as string[],
        zutaten: (zeilenJeGericht.get(row.id) ?? []).sort(
          (a, b) => a.position - b.position || a.id - b.id
        ),
      }))
      .sort((a, b) => COLLATOR.compare(a.name, b.name)),
  };
}

// ---------------------------------------------------------------------------------------------
// Ingredients of the Planung
// ---------------------------------------------------------------------------------------------

async function zaehle(trx: Db, table: 'essen.planung_zutat' | 'essen.gericht', planungId: number) {
  const row = await trx
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('planung_id', '=', planungId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function pruefeVerweise(
  trx: Db,
  kategorieId: number | null,
  unvertraeglichkeiten: number[],
  /** The field that shows an unknown intolerance. */
  feld = 'allergene'
): Promise<void> {
  if (kategorieId !== null) {
    const kategorie = await trx
      .selectFrom('essen.kategorie')
      .select('id')
      .where('id', '=', kategorieId)
      .executeTakeFirst();
    if (!kategorie) throw new ValidationError({ kategorieId: 'Bitte eine Kategorie wählen.' });
  }
  if (unvertraeglichkeiten.length) {
    const gefunden = await trx
      .selectFrom('essen.unvertraeglichkeit')
      .select('id')
      .where('id', 'in', unvertraeglichkeiten)
      .execute();
    if (gefunden.length !== unvertraeglichkeiten.length) {
      throw new ValidationError({ [feld]: 'Bitte aus der Liste wählen.' });
    }
  }
}

async function eindeutig<T>(field: string, message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (UNIQUE_VIOLATION.has(getSqlErrorNumber(error) ?? 0)) {
      throw new ValidationError({ [field]: message });
    }
    throw error;
  }
}

const EIGENE_ZUTAT_GIBT_ES =
  'Diese Zutat gibt es schon. Wähle sie in der Liste aus, statt sie neu anzulegen.';

async function pruefeEigenenNamen(trx: Db, name: string): Promise<void> {
  const zentral = await trx
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirst();
  if (zentral) throw new ValidationError({ name: EIGENE_ZUTAT_GIBT_ES });
}

async function setzeAllergene(trx: Db, planungZutatId: number, allergene: number[]) {
  await trx
    .deleteFrom('essen.planung_zutat_unvertraeglichkeit')
    .where('planung_zutat_id', '=', planungZutatId)
    .execute();
  if (allergene.length) {
    await trx
      .insertInto('essen.planung_zutat_unvertraeglichkeit')
      .values(
        allergene.map((id) => ({ planung_zutat_id: planungZutatId, unvertraeglichkeit_id: id }))
      )
      .execute();
  }
}

/** Adds an ingredient of the Planung's own; returns its id. */
export async function eigeneZutatAnlegen(
  zugang: Zugang,
  input: PlanungZutatInput
): Promise<number> {
  return eindeutig('name', EIGENE_ZUTAT_GIBT_ES, () =>
    aendere(zugang, 'zutat-neu', async (trx) => {
      if ((await zaehle(trx, 'essen.planung_zutat', zugang.planungId)) >= MAX_PLANUNG_ZUTATEN) {
        throw new ValidationError({
          name: `Eine Planung hat höchstens ${MAX_PLANUNG_ZUTATEN} Zutaten.`,
        });
      }
      await pruefeEigenenNamen(trx, input.name!);
      await pruefeVerweise(trx, input.kategorieId, input.allergene ?? []);
      const { id } = await trx
        .insertInto('essen.planung_zutat')
        .values({
          planung_id: zugang.planungId,
          name: input.name!,
          kategorie_id: input.kategorieId,
          einheitenart: input.einheitenart,
          vegetarisch: input.vegetarisch ?? null,
          vegan: input.vegan ?? null,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await setzeAllergene(trx, id, input.allergene ?? []);
      return { result: id, details: { name: input.name } };
    })
  );
}

/**
 * Changes an ingredient of the Planung: all fields of one of its own, or the differences of a
 * central one. The kind of unit stays while lines use the ingredient with an amount.
 */
export async function planungZutatAendern(
  zugang: Zugang,
  id: number,
  body: unknown,
  etag: string
): Promise<void> {
  await eindeutig('name', EIGENE_ZUTAT_GIBT_ES, () =>
    aendere(zugang, 'zutat-geaendert', async (trx) => {
      const zutat = await zutatDerPlanung(trx, zugang, id);
      const eigene = zutat.zutat_id === null;
      const input: PlanungZutatInput = validatePlanungZutat(body, { eigene });
      if (eigene && input.name !== zutat.name) await pruefeEigenenNamen(trx, input.name!);
      await pruefeVerweise(trx, input.kategorieId, input.allergene ?? []);
      const result = await trx
        .updateTable('essen.planung_zutat')
        .set(
          eigene
            ? {
                name: input.name!,
                kategorie_id: input.kategorieId,
                einheitenart: input.einheitenart,
                vegetarisch: input.vegetarisch ?? null,
                vegan: input.vegan ?? null,
              }
            : { kategorie_id: input.kategorieId, einheitenart: input.einheitenart }
        )
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      if (eigene) await setzeAllergene(trx, id, input.allergene ?? []);
      return { result: undefined, details: { name: input.name ?? zutat.z_name } };
    })
  );
}

/** Deletes an ingredient of the Planung that no line uses. */
export async function planungZutatLoeschen(
  zugang: Zugang,
  id: number,
  etag: string
): Promise<void> {
  await aendere(zugang, 'zutat-geloescht', async (trx) => {
    const zutat = await zutatDerPlanung(trx, zugang, id);
    // The foreign key decides, so a line added at the same moment cannot slip past a check
    try {
      const result = await trx
        .deleteFrom('essen.planung_zutat')
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    } catch (error: unknown) {
      if (getSqlErrorNumber(error) !== 547) throw error;
      throw new ValidationError({
        name: 'Gerichte, Bestand, Zusatzbedarf oder Einkäufe nutzen diese Zutat noch. Entferne sie zuerst dort.',
      });
    }
    return { result: undefined, details: { name: zutat.name ?? zutat.z_name } };
  });
}

// ---------------------------------------------------------------------------------------------
// Dishes
// ---------------------------------------------------------------------------------------------

const GERICHT_GIBT_ES = 'Ein Gericht mit diesem Namen gibt es in dieser Planung schon.';

/** Adds a dish; returns its id. */
export async function gerichtAnlegen(zugang: Zugang, input: GerichtInput): Promise<number> {
  return eindeutig('name', GERICHT_GIBT_ES, () =>
    aendere(zugang, 'gericht-neu', async (trx) => {
      if ((await zaehle(trx, 'essen.gericht', zugang.planungId)) >= MAX_GERICHTE) {
        throw new ValidationError({ name: `Eine Planung hat höchstens ${MAX_GERICHTE} Gerichte.` });
      }
      const { id } = await trx
        .insertInto('essen.gericht')
        .values({
          planung_id: zugang.planungId,
          name: input.name!,
          personen: input.personen!,
          ...(input.anleitung !== undefined ? { anleitung: input.anleitung } : {}),
          ...(input.notiz !== undefined ? { notiz: input.notiz } : {}),
          ...(input.links !== undefined ? { links: JSON.stringify(input.links) } : {}),
          ...(input.werkzeuge !== undefined ? { werkzeuge: JSON.stringify(input.werkzeuge) } : {}),
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      return { result: id, details: { name: input.name } };
    })
  );
}

export async function gerichtDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const gericht = await trx
    .selectFrom('essen.gericht')
    .select(['id', 'name', 'version', 'personen'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!gericht) throw new RecordNotFoundError();
  return gericht;
}

/** Changes the fields sent; the version covers name, people, text, links and tools. */
export async function gerichtAendern(
  zugang: Zugang,
  id: number,
  input: GerichtInput,
  etag: string
): Promise<void> {
  await eindeutig('name', GERICHT_GIBT_ES, () =>
    aendere(zugang, 'gericht-geaendert', async (trx) => {
      const gericht = await gerichtDerPlanung(trx, zugang, id);
      const result = await trx
        .updateTable('essen.gericht')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.personen !== undefined ? { personen: input.personen } : {}),
          ...(input.anleitung !== undefined ? { anleitung: input.anleitung } : {}),
          ...(input.notiz !== undefined ? { notiz: input.notiz } : {}),
          ...(input.links !== undefined ? { links: JSON.stringify(input.links) } : {}),
          ...(input.werkzeuge !== undefined ? { werkzeuge: JSON.stringify(input.werkzeuge) } : {}),
        })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      return {
        result: undefined,
        details: {
          name: input.name ?? gericht.name,
          ...(input.name !== undefined && input.name !== gericht.name
            ? { vorher: gericht.name }
            : {}),
        },
      };
    })
  );
}

/**
 * Deletes a dish with its lines and where it is planned; `etag` is its `gerichtStand`, covering
 * those too.
 */
export async function gerichtLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  await aendere(zugang, 'gericht-geloescht', async (trx) => {
    // No line changes meanwhile; they take the same lock
    await lockResource(trx, gerichtSperre(id));
    const gericht = await gerichtDerPlanung(trx, zugang, id);
    const zeilen = await trx
      .selectFrom('essen.gericht_zutat')
      .select('version')
      .where('gericht_id', '=', id)
      .execute();
    const einplanungen = await trx
      .selectFrom('essen.einplanung')
      .select(['version', 'mahlzeit_id'])
      .where('gericht_id', '=', id)
      .execute();
    const stand = gerichtStand(
      {
        etag: toVersion(gericht.version),
        zutaten: zeilen.map((zeile) => ({ etag: toVersion(zeile.version) })),
      },
      einplanungen.map((einplanung) => toVersion(einplanung.version))
    );
    if (stand !== etag.trim()) throw new VersionConflictError();
    // Its places in the plan go with it; they point to the dish without a cascade
    await trx.deleteFrom('essen.einplanung').where('gericht_id', '=', id).execute();
    // The dishes after it in those meals move up
    for (const mahlzeitId of new Set(einplanungen.map((einplanung) => einplanung.mahlzeit_id))) {
      await sortiereEinplanungen(trx, mahlzeitId, null);
    }
    const result = await trx
      .deleteFrom('essen.gericht')
      .where('id', '=', id)
      .where('version', '=', gericht.version)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details: { name: gericht.name } };
  });
}
