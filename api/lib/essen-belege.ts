import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import { isPdfFileName, originalFileName } from './beleg-photos';
import type {
  BelegAenderung,
  BelegBezahltVon,
  BelegFotoArt,
  BelegInput,
  PlanungBeleg,
} from './essen-belege-model';
import { MAX_BELEGE } from './essen-belege-model';
import {
  leseBelegFoto,
  loescheBelegFoto,
  loescheBelegFotosDerPlanung,
  loescheVerwaisteBelegFotos,
  speichereBelegFoto,
} from './essen-beleg-fotos';
import type { Zugang } from './essen-planung';
import { NUR_LESEN, aendere } from './essen-planung';
import { darfBearbeiten } from './essen-planung-model';
import { ValidationError } from './validation/errors';

/**
 * The receipts of a Planung (`docs/essensplanung.md`, Belege): who paid what and whether it was
 * paid back, with an optional photo in Blob Storage (`essen-beleg-fotos.ts`). They never leave
 * the Planung; nothing goes to CampFlow, SharePoint or by mail. Every change runs in `aendere`,
 * which locks the Planung. Files are written before and deleted after the change of the rows, so
 * a row never names a missing file; what is left over is swept after the next photo change.
 */

/** The photos of a request: the picture, its unedited original or the PDF it shows. */
export interface BelegFotos {
  photo: Uint8Array;
  original?: Uint8Array;
  pdf?: Uint8Array;
}

/** The receipts of a Planung, newest day first. */
export async function ladeBelege(db: Db, planungId: number): Promise<PlanungBeleg[]> {
  const rows = await db
    .selectFrom('essen.beleg as b')
    .leftJoin('essen.mitglied as bezahlt', 'bezahlt.id', 'b.bezahlt_von_mitglied_id')
    .leftJoin('essen.mitglied as erstattet', 'erstattet.id', 'b.erstattet_von_mitglied_id')
    .leftJoin('essen.mitglied as angelegt', 'angelegt.id', 'b.angelegt_von_mitglied_id')
    .select([
      'b.id',
      'b.version',
      'b.datum',
      'b.betrag_cent',
      'b.haendler',
      'b.notiz',
      'b.bezahlt_von_mitglied_id',
      'b.bezahlt_von_text',
      'b.erstattet',
      'b.erstattet_am',
      'b.foto',
      'b.angelegt_am',
      'bezahlt.name as bezahlt_name',
      'erstattet.name as erstattet_name',
      'angelegt.name as angelegt_name',
    ])
    .where('b.planung_id', '=', planungId)
    .execute();
  return rows
    .map((row): PlanungBeleg => ({
      id: row.id,
      etag: toVersion(row.version),
      datum: toDateString(row.datum),
      betragCent: row.betrag_cent,
      haendler: row.haendler,
      notiz: row.notiz,
      bezahltVonId: row.bezahlt_von_mitglied_id,
      bezahltVonText: row.bezahlt_von_text,
      bezahltVon: row.bezahlt_name ?? row.bezahlt_von_text,
      erstattet: row.erstattet,
      erstattetAm: row.erstattet && row.erstattet_am ? row.erstattet_am.toISOString() : null,
      erstattetVon: row.erstattet ? (row.erstattet_name ?? '') : '',
      foto: row.foto ? (isPdfFileName(row.foto) ? 'pdf' : 'bild') : null,
      original: originalFileName(row.foto) !== undefined,
      angelegtVon: row.angelegt_name ?? '',
      angelegtAm: row.angelegt_am.toISOString(),
    }))
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.id - a.id);
}

/**
 * Who paid: a member of this Planung who still has access, or a free name. One who `bisher` paid
 * stays allowed after losing access, so the receipt can still be changed. Returns the name.
 */
async function pruefeBezahltVon(
  trx: Db,
  zugang: Zugang,
  bezahltVon: BelegBezahltVon,
  bisher: number | null = null
): Promise<string> {
  if (bezahltVon.bezahltVonId === null) return bezahltVon.bezahltVonText;
  const mitglied = await trx
    .selectFrom('essen.mitglied')
    .select(['id', 'name', 'entzogen_am'])
    .where('id', '=', bezahltVon.bezahltVonId)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!mitglied || (mitglied.entzogen_am && mitglied.id !== bisher)) {
    throw new ValidationError({ bezahltVonId: 'Bitte aus der Liste wählen.' });
  }
  return mitglied.name;
}

/** What a log entry names of a receipt; never the photo. */
function logDetails(beleg: { haendler: string; betrag_cent: number; datum: string }) {
  return { name: beleg.haendler, betragCent: beleg.betrag_cent, datum: beleg.datum };
}

/** Writes a warning instead of failing: the change is saved, a file is only left over. */
async function nebenbei(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        scope: 'essen-beleg-fotos',
        warning: 'Photo files could not be deleted; the next photo change removes them',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/** Deletes a file that was stored for a change that failed, then throws the failure. */
async function zurueck(planungId: number, foto: string | null, error: unknown): Promise<never> {
  if (foto) await nebenbei(() => loescheBelegFoto(planungId, foto));
  throw error;
}

/** Removes files of the Planung that no receipt names any more. */
async function aufraeumen(planungId: number): Promise<void> {
  await nebenbei(async () => {
    const rows = await getDb()
      .selectFrom('essen.beleg')
      .select('foto')
      .where('planung_id', '=', planungId)
      .execute();
    await loescheVerwaisteBelegFotos(
      planungId,
      rows.map((row) => row.foto)
    );
  });
}

/** Adds a receipt, with its photo stored first. */
export async function belegAnlegen(
  zugang: Zugang,
  input: BelegInput,
  fotos: BelegFotos | null
): Promise<void> {
  // A read-only link stores no file at all
  if (!darfBearbeiten(zugang.zugang)) throw NUR_LESEN();
  const foto = fotos ? await speichereBelegFoto(zugang.planungId, fotos) : null;
  try {
    await aendere(zugang, 'beleg-neu', async (trx, aktuell) => {
      const anzahl = await trx
        .selectFrom('essen.beleg')
        .select((eb) => eb.fn.countAll<number>().as('anzahl'))
        .where('planung_id', '=', zugang.planungId)
        .executeTakeFirstOrThrow();
      if (Number(anzahl.anzahl) >= MAX_BELEGE) {
        throw new ValidationError({ betragCent: `Höchstens ${MAX_BELEGE} Belege je Planung.` });
      }
      await pruefeBezahltVon(trx, zugang, input);
      await trx
        .insertInto('essen.beleg')
        .values({
          planung_id: zugang.planungId,
          datum: input.datum,
          betrag_cent: input.betragCent,
          haendler: input.haendler,
          notiz: input.notiz,
          bezahlt_von_mitglied_id: input.bezahltVonId,
          bezahlt_von_text: input.bezahltVonText,
          erstattet: input.erstattet,
          erstattet_am: input.erstattet ? new Date() : null,
          erstattet_von_mitglied_id: input.erstattet ? aktuell.mitgliedId : null,
          foto,
          angelegt_von_mitglied_id: aktuell.mitgliedId,
        })
        .execute();
      return {
        result: undefined,
        details: logDetails({
          haendler: input.haendler,
          betrag_cent: input.betragCent,
          datum: input.datum,
        }),
      };
    });
  } catch (error: unknown) {
    await zurueck(zugang.planungId, foto, error);
  }
}

async function belegDerPlanung(trx: Db, zugang: Zugang, id: number) {
  const beleg = await trx
    .selectFrom('essen.beleg')
    .select(['id', 'datum', 'betrag_cent', 'haendler', 'bezahlt_von_mitglied_id', 'foto'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!beleg) throw new RecordNotFoundError();
  return { ...beleg, datum: toDateString(beleg.datum) };
}

/** Changes the sent fields of a receipt on the version it was shown with. */
export async function belegAendern(
  zugang: Zugang,
  id: number,
  aenderung: BelegAenderung,
  etag: string
): Promise<void> {
  await aendere(zugang, 'beleg-geaendert', async (trx, aktuell) => {
    const beleg = await belegDerPlanung(trx, zugang, id);
    const details: Record<string, unknown> = logDetails(beleg);
    const set: {
      datum?: string;
      betrag_cent?: number;
      haendler?: string;
      notiz?: string;
      bezahlt_von_mitglied_id?: number | null;
      bezahlt_von_text?: string;
      erstattet?: boolean;
      erstattet_am?: Date | null;
      erstattet_von_mitglied_id?: number | null;
    } = {};
    if (aenderung.datum !== undefined) set.datum = aenderung.datum;
    if (aenderung.betragCent !== undefined) set.betrag_cent = aenderung.betragCent;
    if (aenderung.haendler !== undefined) set.haendler = aenderung.haendler;
    if (aenderung.notiz !== undefined) set.notiz = aenderung.notiz;
    if (aenderung.bezahltVon) {
      details.bezahltVon = await pruefeBezahltVon(
        trx,
        zugang,
        aenderung.bezahltVon,
        beleg.bezahlt_von_mitglied_id
      );
      set.bezahlt_von_mitglied_id = aenderung.bezahltVon.bezahltVonId;
      set.bezahlt_von_text = aenderung.bezahltVon.bezahltVonText;
    }
    if (aenderung.erstattet !== undefined) {
      details.erstattet = aenderung.erstattet;
      set.erstattet = aenderung.erstattet;
      set.erstattet_am = aenderung.erstattet ? new Date() : null;
      set.erstattet_von_mitglied_id = aenderung.erstattet ? aktuell.mitgliedId : null;
    }
    const result = await trx
      .updateTable('essen.beleg')
      .set(set)
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    return { result: undefined, details };
  });
}

/** Deletes a receipt and then its photo. */
export async function belegLoeschen(zugang: Zugang, id: number, etag: string): Promise<void> {
  const foto = await aendere(zugang, 'beleg-geloescht', async (trx) => {
    const beleg = await belegDerPlanung(trx, zugang, id);
    const result = await trx
      .deleteFrom('essen.beleg')
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new VersionConflictError();
    return { result: beleg.foto, details: logDetails(beleg) };
  });
  if (foto) await nebenbei(() => loescheBelegFoto(zugang.planungId, foto));
  await aufraeumen(zugang.planungId);
}

/** Adds, replaces (`fotos`) or removes (null) the photo of a receipt. */
export async function belegFotoSetzen(
  zugang: Zugang,
  id: number,
  fotos: BelegFotos | null,
  etag: string
): Promise<void> {
  if (!darfBearbeiten(zugang.zugang)) throw NUR_LESEN();
  const neu = fotos ? await speichereBelegFoto(zugang.planungId, fotos) : null;
  let alt: string | null = null;
  try {
    alt = await aendere(zugang, 'beleg-foto', async (trx) => {
      const beleg = await belegDerPlanung(trx, zugang, id);
      const result = await trx
        .updateTable('essen.beleg')
        .set({ foto: neu })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
      return { result: beleg.foto, details: { ...logDetails(beleg), foto: neu !== null } };
    });
  } catch (error: unknown) {
    await zurueck(zugang.planungId, neu, error);
  }
  if (alt) await nebenbei(() => loescheBelegFoto(zugang.planungId, alt!));
  await aufraeumen(zugang.planungId);
}

const VARIANTE: Record<BelegFotoArt, 'thumb' | 'photo' | 'original' | 'file'> = {
  vorschau: 'thumb',
  bild: 'photo',
  original: 'original',
  datei: 'file',
};

/** A picture of a receipt for any link of the Planung, also the read-only one. */
export async function belegFotoLesen(
  zugang: Zugang,
  id: number,
  art: BelegFotoArt,
  db: Db = getDb()
): Promise<{ bytes: Buffer; pdf: boolean; name: string } | undefined> {
  const beleg = await db
    .selectFrom('essen.beleg')
    .select(['foto', 'datum', 'haendler'])
    .where('id', '=', id)
    .where('planung_id', '=', zugang.planungId)
    .executeTakeFirst();
  if (!beleg?.foto) return undefined;
  const bytes = await leseBelegFoto(zugang.planungId, beleg.foto, VARIANTE[art]);
  if (!bytes) return undefined;
  const pdf = art === 'datei' && isPdfFileName(beleg.foto);
  const name = ['Beleg', toDateString(beleg.datum), beleg.haendler].filter(Boolean).join(' ');
  return { bytes, pdf, name: `${name}${pdf ? '.pdf' : '.jpg'}` };
}

/**
 * Deletes the receipts of a Planung inside its deleting transaction and notes its photo folder
 * for `belegOrdnerAufraeumen`, which deletes it after the commit: Blob Storage cannot roll back,
 * so no photo goes before the Planung is surely gone. Without receipts nothing is noted.
 */
export async function belegeDerPlanungLoeschen(trx: Db, planungId: number): Promise<void> {
  const belege = await trx
    .selectFrom('essen.beleg')
    .select('foto')
    .where('planung_id', '=', planungId)
    .execute();
  if (!belege.length) return;
  if (belege.some((beleg) => beleg.foto)) {
    await trx.insertInto('essen.beleg_ordner_loeschen').values({ planung_id: planungId }).execute();
  }
  await trx.deleteFrom('essen.beleg').where('planung_id', '=', planungId).execute();
}

/**
 * Deletes the noted photo folders of deleted Planungen, each note only after its folder is gone.
 * Runs after every deletion of a Planung and in the daily retention; a failure is logged and
 * tried again next time. Without notes nothing is asked of Blob Storage. Returns how many folders
 * were deleted.
 */
export async function belegOrdnerAufraeumen(db: Db = getDb()): Promise<number> {
  let geloescht = 0;
  try {
    const offen = await db.selectFrom('essen.beleg_ordner_loeschen').select('planung_id').execute();
    for (const { planung_id: planungId } of offen) {
      await loescheBelegFotosDerPlanung(planungId);
      await db
        .deleteFrom('essen.beleg_ordner_loeschen')
        .where('planung_id', '=', planungId)
        .execute();
      geloescht++;
    }
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        scope: 'essen-beleg-fotos',
        warning: 'Photo folders of deleted Planungen could not be deleted; tried again later',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
  return geloescht;
}
