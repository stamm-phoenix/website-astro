import { sql } from 'kysely';
import type { Transaction, Updateable } from 'kysely';
import {
  RecordNotFoundError,
  VersionConflictError,
  inTransaction,
  lockResource,
  requireRowversion,
} from './db';
import type { Database } from './db-schema';
import { ValidationError } from './validation/errors';
import { ABSTIMMUNG_SICHTBARKEITEN } from './abstimmung-model';
import type { AbstimmungEingabe, AbstimmungSichtbarkeit } from './abstimmung-model';
import { AbstimmungForbiddenError, newAbstimmungToken } from './abstimmungen-basis';
import type { AbstimmungPerson } from './abstimmungen-basis';
import { loadRow, loadOptionen } from './abstimmungen-lesen';
import type { AbstimmungKopf } from './abstimmungen-lesen';
import { mailLock } from './abstimmungen-mails';

/** Inserts the options of the form in their order; `id`s were checked by the caller. */
async function writeOptionen(
  trx: Transaction<Database>,
  abstimmungId: number,
  input: AbstimmungEingabe
): Promise<void> {
  const vorhanden: { id: number; text: string; position: number }[] = [];
  const neue: { abstimmung_id: number; position: number; text: string }[] = [];
  for (const [position, option] of input.optionen.entries()) {
    if (option.id) vorhanden.push({ id: option.id, text: option.text, position });
    else neue.push({ abstimmung_id: abstimmungId, position, text: option.text });
  }
  // One statement each instead of one per option
  if (vorhanden.length) {
    const je = (feld: 'text' | 'position') =>
      sql.join(
        vorhanden.map((option) => sql`when ${option.id} then ${option[feld]}`),
        sql` `
      );
    await trx
      .updateTable('abstimmung.optionen')
      .set({
        text: sql<string>`case id ${je('text')} end`,
        position: sql<number>`case id ${je('position')} end`,
      })
      .where(
        'id',
        'in',
        vorhanden.map((option) => option.id)
      )
      .where('abstimmung_id', '=', abstimmungId)
      .execute();
  }
  if (neue.length) await trx.insertInto('abstimmung.optionen').values(neue).execute();
}

/** Creates an Abstimmung with its options; returns its ID. */
export async function createAbstimmung(
  input: AbstimmungEingabe,
  person: Pick<AbstimmungPerson, 'login' | 'name'>
): Promise<number> {
  if (input.optionen.some((option) => option.id)) {
    throw new ValidationError({ optionen: 'Die Liste der Optionen ist ungültig.' });
  }
  return inTransaction(async (trx) => {
    const created = await trx
      .insertInto('abstimmung.abstimmung')
      .values({
        titel: input.titel,
        beschreibung: input.beschreibung,
        max_auswahl: input.maxAuswahl,
        vielleicht: input.vielleichtErlaubt,
        sichtbarkeit: input.sichtbarkeit,
        link_token: newAbstimmungToken(),
        erstellt_von: person.login,
        erstellt_von_name: person.name,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await writeOptionen(trx, created.id, input);
    return created.id;
  });
}

/**
 * Takes the version of the loaded Abstimmung and checks the organizer; returns the row as it was
 * before the change.
 */
async function claimVersion(
  trx: Transaction<Database>,
  id: number,
  etag: string | undefined,
  login: string,
  changes: Updateable<Database['abstimmung.abstimmung']> = {}
): Promise<AbstimmungKopf> {
  // Same lock as a vote, so a vote checked against the old rules never lands after the change
  await lockResource(trx, `abstimmung:${id}`);
  const row = await loadRow(trx, id);
  if (!row) throw new RecordNotFoundError();
  if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
  const version = requireRowversion(etag);
  const result = await trx
    .updateTable('abstimmung.abstimmung')
    .set({ titel: row.titel, ...changes })
    .where('id', '=', id)
    .where('version', '=', version)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) throw new VersionConflictError();
  return row;
}

/**
 * Saves the form of the organizer. Options without `id` are new, missing ones are deleted with
 * their votes. Refused while answers break the new rules: more „Ja“ than `maxAuswahl`, a
 * „Vielleicht“ when it is turned off. The answers never become more visible than they were
 * when someone answered.
 */
export async function updateAbstimmung(
  id: number,
  etag: string | undefined,
  input: AbstimmungEingabe,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    const vorher = await claimVersion(trx, id, etag, login, {
      titel: input.titel,
      beschreibung: input.beschreibung,
      max_auswahl: input.maxAuswahl,
      vielleicht: input.vielleichtErlaubt,
      sichtbarkeit: input.sichtbarkeit,
    });
    const stufe = (sichtbarkeit: AbstimmungSichtbarkeit): number =>
      ABSTIMMUNG_SICHTBARKEITEN.indexOf(sichtbarkeit);
    if (stufe(input.sichtbarkeit) < stufe(vorher.sichtbarkeit)) {
      const beantwortet = await trx
        .selectFrom('abstimmung.teilnahme')
        .select('id')
        .where('abstimmung_id', '=', id)
        .where('geantwortet_am', 'is not', null)
        .executeTakeFirst();
      if (beantwortet) {
        throw new ValidationError({
          sichtbarkeit:
            'Es haben schon Leute abgestimmt, die sich auf die bisherige Einstellung verlassen. Ihre Antworten können nicht mehr für mehr Leute sichtbar werden.',
        });
      }
    }
    const bisher = await loadOptionen(trx, id);
    const bekannt = new Set(bisher.map((option) => option.id));
    if (input.optionen.some((option) => option.id && !bekannt.has(option.id))) {
      throw new ValidationError({
        optionen: 'Eine Option wurde inzwischen gelöscht. Bitte lade die Abstimmung neu.',
      });
    }
    const bleiben = new Set(input.optionen.flatMap((option) => (option.id ? [option.id] : [])));
    const weg = bisher.filter((option) => !bleiben.has(option.id)).map((option) => option.id);
    if (weg.length) {
      // Votes cast after the form was opened are never deleted without the warning
      const gezaehlt = await trx
        .selectFrom('abstimmung.stimme')
        .select(['option_id', (eb) => eb.fn.countAll<number>().as('anzahl')])
        .where('option_id', 'in', weg)
        .groupBy('option_id')
        .execute();
      const neu = gezaehlt.find(
        (row) => Number(row.anzahl) > (input.bekannteStimmen[row.option_id] ?? 0)
      );
      if (neu) {
        const text = bisher.find((option) => option.id === neu.option_id)?.text ?? '';
        throw new ValidationError({
          optionen: `Inzwischen hat jemand für „${text}“ gestimmt. Lade die Abstimmung neu und entscheide dann, ob du die Option trotzdem entfernst.`,
        });
      }
      await trx.deleteFrom('abstimmung.stimme').where('option_id', 'in', weg).execute();
      await trx.deleteFrom('abstimmung.optionen').where('id', 'in', weg).execute();
    }
    if (input.maxAuswahl !== null) {
      const mehr = await trx
        .selectFrom('abstimmung.stimme as s')
        .innerJoin('abstimmung.teilnahme as t', 't.id', 's.teilnahme_id')
        .select('s.teilnahme_id')
        .where('t.abstimmung_id', '=', id)
        .where('s.vielleicht', '=', false)
        .groupBy('s.teilnahme_id')
        .having((eb) => eb.fn.countAll(), '>', input.maxAuswahl)
        .executeTakeFirst();
      if (mehr) {
        throw new ValidationError({
          maxAuswahl:
            'Es haben schon Leute mehr Optionen gewählt. Erlaube mehr Optionen oder leg eine neue Abstimmung an.',
        });
      }
    }
    if (!input.vielleichtErlaubt) {
      const vielleicht = await trx
        .selectFrom('abstimmung.stimme as s')
        .innerJoin('abstimmung.teilnahme as t', 't.id', 's.teilnahme_id')
        .select('s.teilnahme_id')
        .where('t.abstimmung_id', '=', id)
        .where('s.vielleicht', '=', true)
        .executeTakeFirst();
      if (vielleicht) {
        throw new ValidationError({
          vielleichtErlaubt:
            'Es haben schon Leute mit „Vielleicht“ geantwortet. Lass „Vielleicht“ an oder leg eine neue Abstimmung an.',
        });
      }
    }
    await writeOptionen(trx, id, input);
  });
}

/** Ends the Abstimmung or opens it again. */
export async function setAbstimmungGeschlossen(
  id: number,
  etag: string | undefined,
  geschlossen: boolean,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await claimVersion(trx, id, etag, login, {
      geschlossen_am: geschlossen ? new Date().toISOString() : null,
    });
    // Waits for a mail being sent; the next one sees the Abstimmung ended and stays queued
    if (geschlossen) await lockResource(trx, mailLock(id));
  });
}

/** Deletes the Abstimmung with its options, invitations and votes. */
export async function deleteAbstimmung(
  id: number,
  etag: string | undefined,
  login: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await claimVersion(trx, id, etag, login);
    const teilnahmen = trx
      .selectFrom('abstimmung.teilnahme')
      .select('id')
      .where('abstimmung_id', '=', id);
    await trx.deleteFrom('abstimmung.stimme').where('teilnahme_id', 'in', teilnahmen).execute();
    await trx.deleteFrom('abstimmung.teilnahme').where('abstimmung_id', '=', id).execute();
    await trx.deleteFrom('abstimmung.optionen').where('abstimmung_id', '=', id).execute();
    await trx.deleteFrom('abstimmung.abstimmung').where('id', '=', id).execute();
  });
}
