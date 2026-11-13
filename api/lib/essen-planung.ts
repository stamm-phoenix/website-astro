import { sql } from 'kysely';
import { VersionConflictError, inTransaction } from './db';
import type { PlanungEinstellungenInput } from './essen-planung-model';
import { aendere, istWartung } from './essen-aendern';
import type { Zugang } from './essen-zugang';
import { NICHT_ERLAUBT, WARTUNG } from './essen-zugang';
import { deletePlanung } from './essen-planung-loeschen';
import { belegOrdnerAufraeumen } from './essen-belege';

/**
 * Planungen of the Essensplanung (`docs/essensplanung.md`): requests, members, links, settings,
 * days and meals. Access by link is in `essen-zugang.ts`, the view in `essen-ansicht.ts` and the
 * change protocol (counter and log) in `essen-aendern.ts`.
 */

// ---------------------------------------------------------------------------------------------
// The Planung, its days and meals
// ---------------------------------------------------------------------------------------------

/**
 * Renames the Planung and sets whether editors manage members (owners). Without a version
 * check: every change bumps the Planung's own row, and the last owner's choice wins.
 */
export async function planungAendern(
  zugang: Zugang,
  input: PlanungEinstellungenInput
): Promise<void> {
  await aendere(
    zugang,
    'planung-geaendert',
    async (trx) => {
      // The Planung is locked by `aendere`; a field changed by someone else since the form was
      // filled is a conflict, fields left alone keep what others saved
      const vorher = await trx
        .selectFrom('essen.planung')
        .select(['name', 'mitglieder_verwalten'])
        .where('id', '=', zugang.planungId)
        .executeTakeFirstOrThrow();
      if (
        (input.name?.vorher !== undefined && input.name.vorher !== vorher.name) ||
        (input.mitgliederVerwalten?.vorher !== undefined &&
          input.mitgliederVerwalten.vorher !== vorher.mitglieder_verwalten)
      ) {
        throw new VersionConflictError();
      }
      await trx
        .updateTable('essen.planung')
        .set({
          ...(input.name ? { name: input.name.neu } : {}),
          ...(input.mitgliederVerwalten
            ? { mitglieder_verwalten: input.mitgliederVerwalten.neu }
            : {}),
        })
        .where('id', '=', zugang.planungId)
        .execute();
      return { result: undefined, details: { name: input.name?.neu ?? vorher.name } };
    },
    { recht: 'besitzer' }
  );
}

/** Deletes the Planung with everything in it (owners). */
export async function planungLoeschen(zugang: Zugang): Promise<void> {
  if (zugang.zugang !== 'besitzer') throw NICHT_ERLAUBT();
  await inTransaction(async (trx) => {
    if (await istWartung(trx)) throw WARTUNG();
    // Locked like a change in `aendere`, so a role taken away meanwhile is seen below
    await sql`SELECT id FROM essen.planung WITH (UPDLOCK, HOLDLOCK) WHERE id = ${zugang.planungId}`.execute(
      trx
    );
    const mitglied = await trx
      .selectFrom('essen.mitglied')
      .select(['rolle', 'entzogen_am'])
      .where('id', '=', zugang.mitgliedId!)
      .executeTakeFirst();
    if (!mitglied || mitglied.entzogen_am || mitglied.rolle !== 'besitzer') throw NICHT_ERLAUBT();
    await deletePlanung(trx, zugang.planungId);
  });
  // Photos only after the commit; what fails is tried again later
  await belegOrdnerAufraeumen();
}
