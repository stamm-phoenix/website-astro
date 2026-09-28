import { createHash } from 'node:crypto';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { HelperRole } from './nikolaus-einteilung';
import type { EinteilungSaveInput } from './pflege-validation';

/** One row of the list „Nikolaus-Einteilung“: a person on one day. */
export interface EinteilungRow {
  id: string;
  etag: string;
  personId: string;
  /** Name of the person as written into the row, only for reading the list in SharePoint. */
  name: string;
  date: string;
  /** Team name or `Küche`. */
  team: string;
  role: HelperRole;
  fixed: boolean;
}

type EinteilungEntry = EinteilungSaveInput['assignments'][number];

interface EinteilungListItem {
  id: string;
  eTag?: string;
  fields?: {
    /** Name of the person, for reading the list in SharePoint. */
    Title?: string;
    /** ID of the person in „Nikolaus-Helfende“ – the key the code uses. */
    HelferId?: number;
    Datum?: string;
    Team?: string;
    Posten?: string;
    Fixiert?: boolean;
  };
}

/** Parallel requests when saving; SharePoint throttles larger bursts. */
const SAVE_CONCURRENCY = 4;

function getListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_EINTEILUNG_LIST_ID);
}

function mapRow(item: unknown): EinteilungRow {
  const listItem = item as EinteilungListItem;
  const fields = listItem.fields ?? {};
  return {
    id: String(listItem.id),
    etag: listItem.eTag ?? '',
    personId: fields.HelferId ? String(fields.HelferId) : '',
    name: fields.Title ?? '',
    date: fields.Datum ?? '',
    team: fields.Team ?? '',
    role: (fields.Posten ?? '') as HelperRole,
    fixed: fields.Fixiert === true,
  };
}

/** All rows of the Einteilung (all days). */
export async function getEinteilungRows(): Promise<EinteilungRow[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapRow);
}

/** Fingerprint of the rows as loaded, to detect a save by someone else in between. */
export function getEinteilungVersion(rows: EinteilungRow[]): string {
  const parts = rows.map((row) => `${row.id}:${row.etag}`).sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

function entryFields(entry: EinteilungEntry, name: string): Record<string, unknown> {
  return {
    Title: name,
    HelferId: Number(entry.personId),
    Datum: entry.date,
    Team: entry.team,
    Posten: entry.role,
    Fixiert: entry.fixed,
  };
}

async function runLimited(tasks: (() => Promise<unknown>)[]): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, tasks.length) }, worker));
}

/**
 * Replaces the whole Einteilung: one row per person and day is updated in place, missing
 * rows are created and rows no longer needed are deleted.
 * @param names Name per person ID, written into `Title` so the list is readable in SharePoint.
 */
export async function saveEinteilung(
  entries: EinteilungEntry[],
  existing: EinteilungRow[],
  names: Map<string, string>
): Promise<void> {
  const listId = getListId();
  const byKey = new Map<string, EinteilungRow>();
  const surplus: EinteilungRow[] = [];
  for (const row of existing) {
    const key = `${row.personId}|${row.date}`;
    if (byKey.has(key)) surplus.push(row);
    else byKey.set(key, row);
  }

  const tasks: (() => Promise<unknown>)[] = [];
  const kept = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.personId}|${entry.date}`;
    kept.add(key);
    const row = byKey.get(key);
    const name = names.get(entry.personId) ?? '';
    const fields = entryFields(entry, name);
    if (!row) {
      tasks.push(() => createSharePointListItem(listId, fields));
    } else if (
      row.team !== entry.team ||
      row.role !== entry.role ||
      row.fixed !== entry.fixed ||
      row.name !== name
    ) {
      tasks.push(() => updateSharePointListItem(listId, row.id, fields, row.etag || undefined));
    }
  }
  for (const [key, row] of byKey) if (!kept.has(key)) surplus.push(row);
  for (const row of surplus) {
    tasks.push(() => deleteSharePointListItem(listId, row.id, row.etag || undefined));
  }
  await runLimited(tasks);
}

/** Writes a changed name into the rows of a person, so SharePoint shows the current name. */
export async function renameInEinteilung(personId: string, name: string): Promise<void> {
  const listId = getListId();
  const rows = (await getEinteilungRows()).filter(
    (row) => row.personId === personId && row.name !== name
  );
  await runLimited(
    rows.map((row) => () => updateSharePointListItem(listId, row.id, { Title: name }))
  );
}

/** Deletes all rows of a person, e.g. when the person is removed. */
export async function deleteEinteilungOfPerson(personId: string): Promise<void> {
  const listId = getListId();
  const rows = (await getEinteilungRows()).filter((row) => row.personId === personId);
  await runLimited(rows.map((row) => () => deleteSharePointListItem(listId, row.id)));
}
