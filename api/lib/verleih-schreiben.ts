import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import {
  inTransaction,
  lockResource,
  RecordNotFoundError,
  requireRowversion,
  VersionConflictError,
} from './db';
import type { Db } from './db';
import type { VerleihInput } from './verleih-model';
import type { VerleihAktion } from './validation/verleih';
import { ValidationError } from './validation/errors';
import { pruefeVerleihBestand } from './verleih-bestand';
import { enqueueVerleihMail } from './verleih-mail';

async function history(db: Db, id: number, actor: string, text: string): Promise<void> {
  await db
    .insertInto('organisation.verleih_verlauf')
    .values({ verleih_id: id, von: actor, text })
    .execute();
}
async function positions(db: Db, id: number, input: VerleihInput): Promise<void> {
  for (const p of input.positionen) {
    const row = await db
      .selectFrom('organisation.inventar_variante as v')
      .innerJoin('organisation.inventar_artikel as a', 'a.id', 'v.artikel_id')
      .select(['a.bezeichnung as name', 'v.bezeichnung as variante'])
      .where('v.id', '=', p.varianteId)
      .executeTakeFirst();
    if (!row)
      throw new ValidationError({ positionen: 'Ein Material wurde entfernt. Bitte neu laden.' });
    await db
      .insertInto('organisation.verleih_position')
      .values({
        verleih_id: id,
        variante_id: p.varianteId,
        bezeichnung: `${row.name}${row.variante ? ` · ${row.variante}` : ''}`,
        menge: p.menge,
      })
      .execute();
  }
}
async function loaded(db: Db, id: number, etag: string) {
  const row = await db
    .selectFrom('organisation.verleih')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new RecordNotFoundError();
  if (!row.version.equals(requireRowversion(etag))) throw new VersionConflictError();
  return row;
}
export async function saveVerleih(
  input: VerleihInput,
  actor: string,
  id?: number,
  etag?: string,
  anfrageId?: string
): Promise<number> {
  return inTransaction(async (trx) => {
    await lockResource(trx, 'inventur-verleih');
    const anfrageHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (id === undefined && anfrageId) {
      const exists = await trx
        .selectFrom('organisation.verleih')
        .select(['id', 'antragsteller', 'anfrage_hash'])
        .where('anfrage_id', '=', anfrageId)
        .executeTakeFirst();
      if (exists) {
        if (exists.antragsteller !== actor)
          throw new ValidationError({
            form: 'Dieser Antrag gehört zu einer anderen Person. Es wurde nichts gespeichert.',
          });
        if (exists.anfrage_hash !== anfrageHash)
          throw new ValidationError({
            form: 'Der Antrag ist bereits eingegangen. Schließe diesen Dialog und öffne den Antrag in der Liste, um ihn zu ändern. Die neuen Eingaben wurden nicht gespeichert.',
          });
        return exists.id;
      }
    }
    const fields = {
      entleiher: input.entleiher,
      kontakt: input.kontakt,
      verantwortlich: input.verantwortlich,
      von: input.von,
      bis: input.bis,
      notizen: input.notizen,
    };
    let current = id;
    if (current !== undefined) {
      const row = await loaded(trx, current, etag ?? '');
      if (row.antragsteller !== actor || row.status !== 'antrag')
        throw new ValidationError({
          form: 'Nur eigene, noch nicht entschiedene Anträge können geändert werden. Es wurde nichts gespeichert.',
        });
      await trx.updateTable('organisation.verleih').set(fields).where('id', '=', current).execute();
      await trx
        .deleteFrom('organisation.verleih_position')
        .where('verleih_id', '=', current)
        .execute();
    } else {
      const { id: created } = await trx
        .insertInto('organisation.verleih')
        .values({
          ...fields,
          ...(anfrageId ? { anfrage_id: anfrageId } : {}),
          anfrage_hash: anfrageHash,
          status: 'antrag',
          antragsteller: actor,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      current = created;
    }
    await positions(trx, current, input);
    await history(trx, current, actor, id ? 'Antrag geändert.' : 'Ausleihe beantragt.');
    const settings = await trx
      .selectFrom('organisation.verleih_einstellung')
      .select('materialwart')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    // No configured recipient means a request must not silently lose its notification.
    if (!settings.materialwart)
      throw new ValidationError({
        form: 'Es ist noch kein Materialwart eingerichtet. Bitte wende dich an den Vorstand. Es wurde nichts gespeichert.',
      });
    await enqueueVerleihMail(
      trx,
      current,
      actor,
      'Ausleihe beantragt',
      `${input.entleiher}: Dein Antrag für ${input.von} bis ${input.bis} ist eingegangen und wartet auf Freigabe.`
    );
    await enqueueVerleihMail(
      trx,
      current,
      settings.materialwart,
      id ? 'Ausleihantrag geändert' : 'Neuer Ausleihantrag',
      `${input.entleiher} beantragt Material für ${input.von} bis ${input.bis}. Bitte prüfe den Antrag.`
    );
    return current;
  });
}
export async function changeVerleih(
  id: number,
  etag: string,
  input: VerleihAktion,
  actor: string
): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, 'inventur-verleih');
    const row = await loaded(trx, id, etag);
    const settings = await trx
      .selectFrom('organisation.verleih_einstellung')
      .select('materialwart')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const wart = settings.materialwart && settings.materialwart === actor;
    if (input.aktion !== 'zurueckziehen' && !wart)
      throw new ValidationError({
        form: 'Nur der Materialwart kann diese Aktion ausführen. Es wurde nichts gespeichert.',
      });
    const positionen = await trx
      .selectFrom('organisation.verleih_position')
      .selectAll()
      .where('verleih_id', '=', id)
      .execute();
    let status = row.status;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (['genehmigen', 'ausgeben'].includes(input.aktion) && row.bis < today)
      throw new ValidationError({
        form: 'Der Rückgabetermin liegt in der Vergangenheit. Bitte sage die Ausleihe ab oder stelle einen neuen Antrag mit aktuellem Zeitraum.',
      });
    if (input.aktion === 'genehmigen' || input.aktion === 'ablehnen') {
      if (status !== 'antrag')
        throw new ValidationError({
          form: 'Dieser Antrag wurde bereits entschieden. Bitte neu laden.',
        });
      if (input.aktion === 'genehmigen') {
        await pruefeVerleihBestand(
          trx,
          positionen.map((p) => ({ varianteId: p.variante_id, menge: p.menge })),
          row.von,
          row.bis,
          id
        );
      }
      status = input.aktion === 'genehmigen' ? 'genehmigt' : 'abgelehnt';
      await trx
        .updateTable('organisation.verleih')
        .set({ entscheidung: input.nachricht, entschieden_von: actor })
        .where('id', '=', id)
        .execute();
      await enqueueVerleihMail(
        trx,
        id,
        row.antragsteller,
        input.aktion === 'genehmigen' ? 'Ausleihe genehmigt' : 'Ausleihe abgelehnt',
        `${row.entleiher}: Deine Ausleihe für ${row.von} bis ${row.bis} wurde ${status}. ${input.nachricht}`
      );
    } else if (input.aktion === 'zurueckziehen') {
      if (row.antragsteller !== actor || status !== 'antrag')
        throw new ValidationError({
          form: 'Nur eigene, noch nicht entschiedene Anträge können zurückgezogen werden.',
        });
      status = 'zurueckgezogen';
      if (settings.materialwart)
        await enqueueVerleihMail(
          trx,
          id,
          settings.materialwart,
          'Ausleihantrag zurückgezogen',
          `${row.entleiher} hat den Ausleihantrag zurückgezogen.`
        );
    } else if (input.aktion === 'stornieren') {
      if (status !== 'genehmigt')
        throw new ValidationError({
          form: 'Nur eine noch nicht ausgegebene, genehmigte Ausleihe kann abgesagt werden.',
        });
      status = 'zurueckgezogen';
      await enqueueVerleihMail(
        trx,
        id,
        row.antragsteller,
        'Ausleihe abgesagt',
        `Die Ausleihe für ${row.entleiher} wurde abgesagt. ${input.nachricht}`
      );
    } else if (input.aktion === 'ausgeben') {
      if (status !== 'genehmigt')
        throw new ValidationError({ form: 'Nur genehmigtes Material kann ausgegeben werden.' });
      await pruefeVerleihBestand(
        trx,
        positionen.map((p) => ({ varianteId: p.variante_id, menge: p.menge })),
        row.von,
        row.bis,
        id
      );
      status = 'ausgegeben';
    } else {
      if (status !== 'ausgegeben')
        throw new ValidationError({ form: 'Eine Rückgabe ist erst nach der Ausgabe möglich.' });
      for (const r of input.rueckgaben) {
        const p = positionen.find((p) => p.id === r.positionId);
        if (!p || p.zurueck + r.menge > p.menge)
          throw new ValidationError({
            rueckgaben:
              'Die Rückgabe überschreitet die offene Menge. Bitte neu laden und die Mengen prüfen.',
          });
        p.zurueck += r.menge;
        await trx
          .updateTable('organisation.verleih_position')
          .set({ zurueck: p.zurueck })
          .where('id', '=', p.id)
          .execute();
        if (r.schaden) {
          const v = await trx
            .selectFrom('organisation.inventar_variante')
            .select('artikel_id')
            .where('id', '=', p.variante_id)
            .executeTakeFirstOrThrow();
          await trx
            .updateTable('organisation.inventar_artikel')
            .set({
              zustand: 'reparatur',
              updated_by: actor,
              updated_at: sql<Date>`SYSUTCDATETIME()`,
              fehlend: sql<string>`LEFT(CONCAT(fehlend, N' ', ${r.schaden}), 1000)`,
            })
            .where('id', '=', v.artikel_id)
            .execute();
        }
        await history(
          trx,
          id,
          actor,
          `${r.menge} × ${p.bezeichnung} zurückgegeben.${r.schaden ? ` Schaden: ${r.schaden}` : ''}`
        );
      }
      if (positionen.every((p) => p.zurueck === p.menge)) status = 'abgeschlossen';
    }
    await trx.updateTable('organisation.verleih').set({ status }).where('id', '=', id).execute();
    await history(
      trx,
      id,
      actor,
      `${{ genehmigen: 'Ausleihe genehmigt.', ablehnen: 'Ausleihe abgelehnt.', ausgeben: 'Material ausgegeben.', zurueckziehen: 'Antrag zurückgezogen.', rueckgabe: 'Rückgabe gespeichert.', stornieren: 'Ausleihe abgesagt.' }[input.aktion]}${input.nachricht ? ` ${input.nachricht}` : ''}`
    );
  });
}
