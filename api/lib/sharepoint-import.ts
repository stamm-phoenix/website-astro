import { deleteBlob, putBlob } from './blob-storage';
import { lockContentIds, recordContentIds } from './content-ids';
import { CONFIG } from './config';
import { getDb, inTransaction, lockResource } from './db';
import { newPhotoFileName, photoBlobName, toStoredPhoto } from './leitende-photos';
import { sanitizeRichText } from './pflege-validation';
import { getSharePointChoiceValues, getSharePointListItems } from './sharepoint-data-access';
import { importAktionen } from './sharepoint-import-aktionen';
import { importBelege } from './sharepoint-import-belege';
import type { ImportList, ImportSummary, ListItem } from './sharepoint-import-common';
import {
  assertEmpty,
  choices,
  chunks,
  countRows,
  forEachLimited,
  imageFileName,
  isImported,
  itemId,
  markImported,
  mayImport,
  readAttachment,
  text,
} from './sharepoint-import-common';
import { importInstagramToken } from './sharepoint-import-instagram';

export type { ImportList, ImportSummary } from './sharepoint-import-common';

/**
 * One-time takeover of the SharePoint lists into Azure SQL (#165): „Gruppenstunden“ and
 * „Leitende“ (migration `0024_gruppenstunden_leitende.sql`, here), „Kalender“, „Belege“ and
 * „InstagramToken“ (migration `0026_aktionen_belege_instagram.sql`, `sharepoint-import-*.ts`).
 * The first access after the deploy copies a list with its IDs (and the photos into Blob
 * Storage) and records it in `content.sharepoint_import`; from then on only Azure SQL is used.
 * The lists in SharePoint are read, never changed. Previews never copy anything: they get
 * invented data from `db-preview.ts`. See `docs/azure-sql.md`.
 */

export interface SourceGruppenstunde {
  id: number;
  stufe: string;
  weekday: string;
  time: string;
  ageRange: string;
  location: string;
  description: string;
}

export interface SourceLeitende {
  id: number;
  name: string;
  teams: string[];
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  /** File name of the photo attachment, if the image column references one. */
  photoFile?: string;
}

const PHOTO_CONCURRENCY = 4;

/** Reads the SharePoint list „Gruppenstunden“. */
export async function readGruppenstundenList(): Promise<SourceGruppenstunde[]> {
  const items = (await getSharePointListItems(CONFIG.sharepoint.lists.gruppenstunden, {
    expand: 'fields',
  })) as ListItem<Record<string, unknown>>[];
  return items.map(({ id, fields }) => ({
    id: itemId(id),
    stufe: text(fields.Title),
    weekday: text(fields.Wochentag),
    time: text(fields.Zeit),
    ageRange: text(fields.Alter),
    location: text(fields.Ort),
    // SharePoint wraps rich text in <div class="ExternalClass…">; keep plain tags only
    description: sanitizeRichText(text(fields.Beschreibung)),
  }));
}

interface Address {
  street: string;
  postalCode: string;
  city: string;
}

/**
 * The address of a person: the fields `Street`, `PostalCode` and `City` that Graph returns for
 * the location column, or else the column „Adresse“ itself (JSON as written by the website).
 */
function address(fields: Record<string, unknown>): Address {
  const direct = {
    street: text(fields.Street),
    postalCode: text(fields.PostalCode),
    city: text(fields.City),
  };
  if (direct.street || direct.postalCode || direct.city) return direct;
  let location: unknown = fields.Adresse;
  if (typeof location === 'string') {
    try {
      location = JSON.parse(location);
    } catch {
      location = undefined;
    }
  }
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const parts = record(record(location).Address ?? record(location).address);
  return {
    street: text(parts.Street ?? parts.street),
    postalCode: text(parts.PostalCode ?? parts.postalCode),
    city: text(parts.City ?? parts.city),
  };
}

/** Reads the SharePoint list „Leitende“ and the choices of its column „Team“. */
export async function readLeitendeList(): Promise<{ items: SourceLeitende[]; teams: string[] }> {
  const listId = CONFIG.sharepoint.lists.leitende;
  const [items, teams] = await Promise.all([
    getSharePointListItems(listId, { expand: 'fields' }) as Promise<
      ListItem<Record<string, unknown>>[]
    >,
    getSharePointChoiceValues(listId, 'Team'),
  ]);
  return {
    teams: teams.map(text).filter(Boolean),
    items: items.map(({ id, fields }) => {
      return {
        id: itemId(id),
        name: text(fields.Title),
        teams: choices(fields.Team),
        phone: text(fields.Telefon),
        ...address(fields),
        photoFile: imageFileName(fields.Image0),
      };
    }),
  };
}

/** The photo attachment of a person, or undefined if SharePoint does not have it. */
export async function readLeitendePhoto(
  id: number,
  fileName: string
): Promise<Uint8Array | undefined> {
  return readAttachment(CONFIG.sharepoint.lists.leitende, id, fileName);
}

/**
 * Copies the photos into Blob Storage before the rows are written (`inTransaction` may repeat
 * its work, so it must not write files). Every run writes names of its own into `stored`, so a
 * run that loses to another one or fails deletes only its own files (`deletePhotos`). A photo
 * SharePoint does not have or that is no readable image is left out and reported; any other
 * error stops the import once all copies in progress are done.
 */
async function copyPhotos(
  items: readonly SourceLeitende[],
  stored: Map<number, string>
): Promise<string[]> {
  const missing: string[] = [];
  const withPhoto = items.filter((item) => item.photoFile !== undefined);
  await forEachLimited(withPhoto, PHOTO_CONCURRENCY, async (item) => {
    const bytes = await readLeitendePhoto(item.id, item.photoFile ?? '');
    let photo: Buffer | undefined;
    try {
      photo = bytes ? await toStoredPhoto(bytes) : undefined;
    } catch {
      photo = undefined;
    }
    if (!photo) {
      missing.push(String(item.id));
      return;
    }
    const file = newPhotoFileName();
    stored.set(item.id, file);
    await putBlob(photoBlobName(item.id, file), photo, 'image/jpeg');
  });
  return missing.sort((a, b) => Number(a) - Number(b));
}

async function deletePhotos(stored: ReadonlyMap<number, string>): Promise<void> {
  for (const [id, file] of stored) await deleteBlob(photoBlobName(id, file));
}

/** Copies a list unless it was copied already; returns undefined if there was nothing to do. */
export async function importSharePointList(list: ImportList): Promise<ImportSummary | undefined> {
  if (await isImported(getDb(), list)) return undefined;
  if (list === 'aktionen') return importAktionen();
  if (list === 'belege') return importBelege();
  if (list === 'instagram') return importInstagramToken();
  // Read SharePoint before taking the lock; another instance may be importing meanwhile
  if (list === 'gruppenstunden') {
    const items = await readGruppenstundenList();
    return inTransaction(async (trx) => {
      await lockResource(trx, `content:sharepoint-import:${list}`);
      if (await isImported(trx, list)) return undefined;
      // The IDs of SharePoint; new entries get theirs only after this transaction
      await lockContentIds(trx, 'content.gruppenstunde');
      await assertEmpty(trx, 'content.gruppenstunde');
      for (const chunk of chunks(items)) {
        await trx
          .insertInto('content.gruppenstunde')
          .values(
            chunk.map((item) => ({
              id: item.id,
              stufe: item.stufe,
              weekday: item.weekday,
              meeting_time: item.time,
              age_range: item.ageRange,
              location: item.location,
              description: item.description,
              updated_by: 'SharePoint',
            }))
          )
          .execute();
      }
      await recordContentIds(trx, 'content.gruppenstunde');
      const count = await countRows(trx, 'content.gruppenstunde');
      if (count !== items.length) {
        throw new Error(`Imported ${count} of ${items.length} Gruppenstunden`);
      }
      const summary: ImportSummary = { items: count };
      await markImported(trx, list, summary);
      return summary;
    });
  }

  const source = await readLeitendeList();
  const stored = new Map<number, string>();
  let summary: ImportSummary | undefined;
  try {
    const missingPhotos = await copyPhotos(source.items, stored);
    summary = await writeLeitende(source, stored, missingPhotos);
    return summary;
  } finally {
    // Another run took over the list first, or this one failed: its files are not referenced
    if (!summary) await deletePhotos(stored);
  }
}

async function writeLeitende(
  source: { items: SourceLeitende[]; teams: string[] },
  stored: ReadonlyMap<number, string>,
  missingPhotos: string[]
): Promise<ImportSummary | undefined> {
  const list: ImportList = 'leitende';
  return inTransaction(async (trx) => {
    await lockResource(trx, `content:sharepoint-import:${list}`);
    if (await isImported(trx, list)) return undefined;
    await lockContentIds(trx, 'content.leitende');
    await assertEmpty(trx, 'content.leitende');

    const known = new Set(
      (await trx.selectFrom('content.team').select('name').execute()).map((row) => row.name)
    );
    const addedTeams = [
      ...new Set([...source.teams, ...source.items.flatMap((item) => item.teams)]),
    ].filter((team) => !known.has(team));
    for (const chunk of chunks(addedTeams)) {
      await trx
        .insertInto('content.team')
        .values(chunk.map((name) => ({ name })))
        .execute();
    }

    for (const chunk of chunks(source.items)) {
      await trx
        .insertInto('content.leitende')
        .values(
          chunk.map((item) => ({
            id: item.id,
            name: item.name,
            phone: item.phone,
            street: item.street,
            postal_code: item.postalCode,
            city: item.city,
            photo: stored.get(item.id) ?? null,
            updated_by: 'SharePoint',
          }))
        )
        .execute();
    }
    const memberships = source.items.flatMap((item) =>
      item.teams.map((team) => ({ leitende_id: item.id, team }))
    );
    for (const chunk of chunks(memberships)) {
      await trx.insertInto('content.leitende_team').values(chunk).execute();
    }

    await recordContentIds(trx, 'content.leitende');
    const count = await countRows(trx, 'content.leitende');
    if (count !== source.items.length) {
      throw new Error(`Imported ${count} of ${source.items.length} Leitende`);
    }
    const summary: ImportSummary = {
      items: count,
      photos: stored.size,
      missingPhotos,
      addedTeams,
    };
    await markImported(trx, list, summary);
    return summary;
  });
}

const imported = new Set<ImportList>();
const running = new Map<ImportList, Promise<void>>();

async function runImport(list: ImportList): Promise<void> {
  if (!mayImport()) return;
  const summary = await importSharePointList(list);
  if (!summary) return;
  console.info(JSON.stringify({ scope: 'sharepoint-import', list, ...summary }));
  if (summary.missingPhotos?.length) {
    console.warn(
      JSON.stringify({
        scope: 'sharepoint-import',
        list,
        warning: 'Photos could not be copied; add them again in the Leitendenbereich',
        ids: summary.missingPhotos,
      })
    );
  }
}

/**
 * Makes sure the list was taken over from SharePoint, copying it on the first call. Concurrent
 * calls of this process share one run; a failed run is retried by the next call.
 */
export async function ensureImported(list: ImportList): Promise<void> {
  if (imported.has(list)) return;
  let run = running.get(list);
  if (!run) {
    run = runImport(list)
      .then(() => {
        imported.add(list);
      })
      .finally(() => running.delete(list));
    running.set(list, run);
  }
  await run;
}
