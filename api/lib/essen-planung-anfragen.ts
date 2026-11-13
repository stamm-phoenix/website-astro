import type { Db } from './db';
import { getDb, inTransaction, lockResource, toDateString } from './db';
import type { AnlegenInput } from './essen-planung-model';
import { ANFRAGE_GUELTIG_MS, ANFRAGEN_PRO_STUNDE } from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import {
  LINK_UNGUELTIG,
  PlanungError,
  WARTUNG,
  hashToken,
  isToken,
  neuesToken,
} from './essen-zugang';
import { darfPlanungAnlegen } from './essen-validation';
import { legePlanungAn } from './essen-planung-anlegen';

// ---------------------------------------------------------------------------------------------
// Creating a Planung
// ---------------------------------------------------------------------------------------------

/**
 * Stores a request to create a Planung and returns the token for the confirmation link.
 * Refuses addresses the Steuerung does not allow and too many requests.
 */
function ANLEGEN_NICHT_ERLAUBT(): PlanungError {
  return new PlanungError(
    403,
    'ANLEGEN_NICHT_ERLAUBT',
    'Mit dieser Mailadresse kannst du gerade keine Planung anlegen. Frag beim Stamm Phoenix nach (kontakt@stamm-phoenix.de) oder lass dich von jemandem in eine bestehende Planung einladen.'
  );
}

export async function anfrageAnlegen(input: AnlegenInput, db: Db = getDb()): Promise<string> {
  const { einstellungen } = await loadEssenEinstellungen(db);
  if (einstellungen.wartung) throw WARTUNG();
  if (!darfPlanungAnlegen(input.email, einstellungen)) throw ANLEGEN_NICHT_ERLAUBT();
  // Counting and storing under one lock per address, so requests at the same time cannot all
  // slip under the limit
  return db.transaction().execute(async (trx) => {
    await lockResource(trx, `essen-anlegen:${input.email}`);
    const recent = await trx
      .selectFrom('essen.anlage_anfrage')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('email', '=', input.email)
      .where('erstellt_am', '>', new Date(Date.now() - 60 * 60_000))
      .executeTakeFirstOrThrow();
    if (Number(recent.count) >= ANFRAGEN_PRO_STUNDE) {
      throw new PlanungError(
        429,
        'ZU_VIELE_ANFRAGEN',
        'Du hast in der letzten Stunde schon mehrere Planungen angefragt. Schau in dein Postfach (auch in den Spam-Ordner) oder versuche es später noch einmal.'
      );
    }
    const token = neuesToken();
    await trx
      .insertInto('essen.anlage_anfrage')
      .values({
        token_hash: hashToken(token),
        email: input.email,
        name: input.name,
        planung_name: input.planungName,
        erster_tag: input.ersterTag,
        letzter_tag: input.letzterTag,
        laeuft_ab: new Date(Date.now() + ANFRAGE_GUELTIG_MS),
      })
      .execute();
    return token;
  });
}

/**
 * Creates the Planung of a confirmed request with its days and the template meals; the
 * requester becomes owner. Returns the owner's personal token. A second click on the same link
 * creates nothing new, it says the Planung exists.
 */
export async function anfrageBestaetigen(
  token: unknown,
  { freigabePruefen = true }: { freigabePruefen?: boolean } = {}
): Promise<string> {
  if (!isToken(token)) throw LINK_UNGUELTIG();
  return inTransaction(async (trx) => {
    // Two tabs confirming at once: the second waits here and then sees the Planung
    await lockResource(trx, `essen-anfrage:${hashToken(token)}`);
    const anfrage = await trx
      .selectFrom('essen.anlage_anfrage')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!anfrage || anfrage.laeuft_ab.getTime() < Date.now()) {
      throw new PlanungError(
        404,
        'ANFRAGE_UNGUELTIG',
        'Dieser Bestätigungslink ist abgelaufen oder gilt nicht. Lege die Planung bitte noch einmal an.'
      );
    }
    if (anfrage.planung_id !== null) {
      throw new PlanungError(
        409,
        'SCHON_ANGELEGT',
        'Diese Planung ist schon angelegt. Den Link dazu hast du beim ersten Bestätigen bekommen; neue Links bekommst du unter „Meine Planungen“.'
      );
    }
    const { einstellungen } = await loadEssenEinstellungen(trx);
    if (einstellungen.wartung) throw WARTUNG();
    // The Steuerung may have closed creating for this address since the request
    if (freigabePruefen && !darfPlanungAnlegen(anfrage.email, einstellungen)) {
      throw ANLEGEN_NICHT_ERLAUBT();
    }

    const besitzerToken = neuesToken();
    const { planungId } = await legePlanungAn(
      trx,
      {
        planungName: anfrage.planung_name,
        name: anfrage.name,
        email: anfrage.email,
        ersterTag: toDateString(anfrage.erster_tag),
        letzterTag: toDateString(anfrage.letzter_tag),
        tokenHash: hashToken(besitzerToken),
      },
      einstellungen
    );
    await trx
      .updateTable('essen.anlage_anfrage')
      .set({ planung_id: planungId })
      .where('id', '=', anfrage.id)
      .execute();
    return besitzerToken;
  });
}
