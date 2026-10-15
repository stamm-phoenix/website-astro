import { CAMPFLOW_EVENT_ID_PATTERN } from './campflow';
import { lockContentIds, recordContentIds } from './content-ids';
import { CONFIG } from './config';
import { inTransaction, lockResource } from './db';
import { sanitizeRichText } from './pflege-validation';
import { getSharePointChoiceValues, getSharePointListItems } from './sharepoint-data-access';
import type { ImportSummary, ListItem } from './sharepoint-import-common';
import {
  assertEmpty,
  choices,
  chunks,
  countRows,
  dateOrNull,
  isImported,
  itemId,
  markImported,
  text,
} from './sharepoint-import-common';

/**
 * Takeover of the SharePoint list „Kalender“ into `content.aktion` (migration
 * `0026_aktionen_belege_instagram.sql`), see `sharepoint-import.ts`.
 */

export interface SourceAktion {
  id: number;
  title: string;
  stufen: string[];
  start: string | null;
  end: string | null;
  link: string;
  description: string;
  campflowId: string | null;
}

/** Reads the SharePoint list „Kalender“ and the choices of its column „Stufen“. */
export async function readAktionenList(): Promise<{ items: SourceAktion[]; stufen: string[] }> {
  const listId = CONFIG.sharepoint.lists.calendar;
  const [items, stufen] = await Promise.all([
    getSharePointListItems(listId, { expand: 'fields' }) as Promise<
      ListItem<Record<string, unknown>>[]
    >,
    getSharePointChoiceValues(listId, 'Stufen'),
  ]);
  return {
    stufen: stufen.map(text).filter(Boolean),
    items: items.map(({ id, fields }) => {
      const campflowId = text(fields.CampFlowId);
      const link = fields.CampFlow_x002d_Anmeldung as { Url?: unknown } | null | undefined;
      const start = dateOrNull(fields.Start);
      return {
        id: itemId(id),
        title: text(fields.Title),
        stufen: choices(fields.Stufen),
        start,
        end: dateOrNull(fields.End) ?? start,
        link: text(link?.Url),
        // SharePoint wraps rich text in <div class="ExternalClass…">; keep plain tags only
        description: sanitizeRichText(text(fields.Beschreibung)),
        campflowId: CAMPFLOW_EVENT_ID_PATTERN.test(campflowId) ? campflowId : null,
      };
    }),
  };
}

/** Copies the calendar entries with their Stufen; see `importSharePointList`. */
export async function importAktionen(): Promise<ImportSummary | undefined> {
  const list = 'aktionen';
  const source = await readAktionenList();
  const items = [...source.items].sort((a, b) => a.id - b.id);

  // A CampFlow event belongs to one entry; a later copy keeps its data without the link
  const linked = new Set<string>();
  const unlinked: string[] = [];
  for (const item of items) {
    if (!item.campflowId) continue;
    if (linked.has(item.campflowId)) {
      unlinked.push(String(item.id));
      item.campflowId = null;
    } else {
      linked.add(item.campflowId);
    }
  }

  return inTransaction(async (trx) => {
    await lockResource(trx, `content:sharepoint-import:${list}`);
    if (await isImported(trx, list)) return undefined;
    await lockContentIds(trx, 'content.aktion');
    await assertEmpty(trx, 'content.aktion');

    const known = new Set(
      (await trx.selectFrom('content.aktion_stufe_option').select('name').execute()).map(
        (row) => row.name
      )
    );
    const addedStufen = [
      ...new Set([...source.stufen, ...items.flatMap((item) => item.stufen)]),
    ].filter((stufe) => !known.has(stufe));
    for (const chunk of chunks(addedStufen)) {
      await trx
        .insertInto('content.aktion_stufe_option')
        .values(chunk.map((name) => ({ name })))
        .execute();
    }

    for (const chunk of chunks(items)) {
      await trx
        .insertInto('content.aktion')
        .values(
          chunk.map((item) => ({
            id: item.id,
            title: item.title,
            start_date: item.start,
            end_date: item.end,
            link: item.link,
            description: item.description,
            campflow_id: item.campflowId,
            updated_by: 'SharePoint',
          }))
        )
        .execute();
    }
    const stufen = items.flatMap((item) =>
      item.stufen.map((stufe) => ({ aktion_id: item.id, stufe }))
    );
    for (const chunk of chunks(stufen)) {
      await trx.insertInto('content.aktion_stufe').values(chunk).execute();
    }

    await recordContentIds(trx, 'content.aktion');
    const count = await countRows(trx, 'content.aktion');
    if (count !== items.length) throw new Error(`Imported ${count} of ${items.length} Aktionen`);
    const summary: ImportSummary = { items: count, addedStufen, unlinked };
    await markImported(trx, list, summary);
    return summary;
  });
}
