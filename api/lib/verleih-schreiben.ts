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
import type { VerleihInput, VerleihStatus } from './verleih-model';
import type { VerleihAktion } from './validation/verleih';
import { ValidationError } from './validation/errors';
import { enqueueVerleihMail } from './verleih-mail';
import { speichereVerleihPositionen } from './verleih-positionen';

async function history(db: Db, id: number, actor: string, text: string): Promise<void> {
  await db
    .insertInto('organisation.verleih_verlauf')
    .values({ verleih_id: id, von: actor, text })
    .execute();
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
            form: 'Diese Eintragung gehört zu einer anderen Person. Es wurde nichts gespeichert.',
          });
        if (exists.anfrage_hash !== anfrageHash)
          throw new ValidationError({
            form: 'Die Ausleihe ist bereits eingetragen. Schließe diesen Dialog und öffne die Ausleihe in der Liste, um sie zu ändern. Die neuen Eingaben wurden nicht gespeichert.',
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
    let zeitraumGeaendert = true;
    if (current !== undefined) {
      const row = await loaded(trx, current, etag ?? '');
      if (row.status !== 'ausgegeben')
        throw new ValidationError({
          form: 'Nur offene Ausleihen können geändert werden. Es wurde nichts gespeichert.',
        });
      zeitraumGeaendert = row.von !== input.von || row.bis !== input.bis;
      await trx.updateTable('organisation.verleih').set(fields).where('id', '=', current).execute();
    } else {
      const { id: created } = await trx
        .insertInto('organisation.verleih')
        .values({
          ...fields,
          ...(anfrageId ? { anfrage_id: anfrageId } : {}),
          anfrage_hash: anfrageHash,
          status: 'ausgegeben',
          antragsteller: actor,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      current = created;
    }
    const abgeschlossen = await speichereVerleihPositionen(trx, current, input, zeitraumGeaendert);
    if (abgeschlossen)
      await trx
        .updateTable('organisation.verleih')
        .set({ status: 'abgeschlossen' })
        .where('id', '=', current)
        .execute();
    await history(trx, current, actor, id ? 'Ausleihe geändert.' : 'Ausleihe eingetragen.');
    const settings = await trx
      .selectFrom('organisation.verleih_einstellung')
      .select('materialwart')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const betreff = id ? 'Ausleihe geändert' : 'Ausleihe eingetragen';
    const text = `${input.entleiher}: Material für ${input.von} bis ${input.bis} wurde von ${actor} ${id ? 'aktualisiert' : 'eingetragen'}.`;
    await enqueueVerleihMail(trx, current, actor, betreff, text);
    if (settings.materialwart && settings.materialwart !== actor)
      await enqueueVerleihMail(trx, current, settings.materialwart, betreff, text);
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
    if (row.status !== 'ausgegeben')
      throw new ValidationError({
        form: 'Diese Ausleihe ist bereits abgeschlossen oder abgesagt. Bitte neu laden.',
      });
    const positionen = await trx
      .selectFrom('organisation.verleih_position')
      .selectAll()
      .where('verleih_id', '=', id)
      .execute();
    let status: VerleihStatus = row.status;
    if (input.aktion === 'stornieren') {
      if (positionen.some((p) => p.zurueck > 0))
        throw new ValidationError({
          form: 'Für diese Ausleihe gibt es bereits Rückgaben. Bitte erfasse stattdessen die noch offenen Rückgaben.',
        });
      status = 'zurueckgezogen';
      await enqueueVerleihMail(
        trx,
        id,
        row.antragsteller,
        'Ausleihe abgesagt',
        `Die Ausleihe für ${row.entleiher} wurde von ${actor} abgesagt. ${input.nachricht}`
      );
    } else {
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
      `${input.aktion === 'stornieren' ? 'Ausleihe abgesagt.' : 'Rückgabe gespeichert.'}${input.nachricht ? ` ${input.nachricht}` : ''}`
    );
  });
}
