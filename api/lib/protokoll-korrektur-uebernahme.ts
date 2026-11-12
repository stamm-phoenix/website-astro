import { sql } from 'kysely';
import { VersionConflictError, inTransaction, lockResource, requireVersion, toVersion } from './db';
import {
  NotEditableError,
  SperreError,
  addRevision,
  editorResource,
  lockedProtokoll,
  parseInhalt,
  readSperre,
  toSperre,
} from './protokoll-editor';
import type { KorrekturUebernahmeResponse } from './protokoll-korrektur-model';
import { wendeKorrekturAn } from './protokoll-korrektur-model';
import type { KorrekturUebernahmeInput } from './validation/protokoll-korrektur';
import { validateProtokollInhalt } from './validation/protokoll-inhalt';

/**
 * Takes correction proposals over into the minutes (#553): like a save of the editor, against
 * the version the page has and under the lock of the minutes, but without a writing tab. Only
 * minutes in draft or review change; while someone writes, the proposals wait. The stored
 * version is kept as a revision first, so „Versionen“ brings it back. A proposal whose passage
 * changed since the check is reported and left out.
 */
export async function uebernehmeKorrekturen(
  id: number,
  input: KorrekturUebernahmeInput,
  actor: string,
  now: Date = new Date()
): Promise<KorrekturUebernahmeResponse> {
  const version = requireVersion(input.etag);
  return inTransaction(async (trx) => {
    await lockResource(trx, editorResource(id));
    const row = await lockedProtokoll(trx, id);
    if (row.status !== 'entwurf' && row.status !== 'review') throw new NotEditableError();
    const sperre = await readSperre(trx, id);
    if (sperre && sperre.until.getTime() > now.getTime()) {
      throw new SperreError(toSperre(sperre, null, now));
    }
    if (!row.version.equals(version)) throw new VersionConflictError();

    let inhalt = parseInhalt(row.content);
    const uebernommen: string[] = [];
    const geaendert: string[] = [];
    for (const vorschlag of input.vorschlaege) {
      const neu = wendeKorrekturAn(inhalt, vorschlag);
      if (neu) {
        inhalt = neu;
        uebernommen.push(vorschlag.id);
      } else {
        geaendert.push(vorschlag.id);
      }
    }
    if (uebernommen.length === 0) {
      return {
        etag: toVersion(row.version),
        updatedAt: row.updated_at.toISOString(),
        uebernommen,
        geaendert,
      };
    }
    // The limits of a save hold here too, e.g. the length of a text
    const content = JSON.stringify(validateProtokollInhalt(inhalt));
    await addRevision(trx, row, 'korrektur', actor, now);
    const updated = await trx
      .updateTable('protokoll.protokoll')
      .set({ content, updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('id', '=', id)
      .output(['inserted.version', 'inserted.updated_at'])
      .executeTakeFirstOrThrow();
    return {
      etag: toVersion(updated.version),
      updatedAt: updated.updated_at.toISOString(),
      uebernommen,
      geaendert,
    };
  });
}
