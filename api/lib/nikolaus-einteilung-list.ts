import { createHash } from 'node:crypto';
import {
  deleteSharePointListItem,
  getGraphStatus,
  getSharePointListItems,
} from './sharepoint-data-access';
import { CONFIG } from './config';
import type { HelperRole } from './nikolaus-einteilung';
import type { EinteilungSaveInput } from './pflege-validation';
import {
  mutateNikolausState,
  readNikolausState,
  NikolausStateConflictError,
} from './nikolaus-state';
import { hasFields, parsePlanSnapshot } from './nikolaus-plan-snapshot';

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

const PLAN_KEY = 'planning:einteilung';

function getListId(): string {
  return CONFIG.sharepoint.lists.nikolausEinteilung;
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

function isEinteilungRow(value: unknown): value is EinteilungRow {
  return hasFields(value, ['id', 'etag', 'personId', 'name', 'date', 'team', 'role'], ['fixed']);
}

export async function getEinteilungRows(): Promise<EinteilungRow[]> {
  const state = await readNikolausState(PLAN_KEY);
  const legacy = state
    ? []
    : (await getSharePointListItems(getListId(), { expand: 'fields' })).map(mapRow);
  return parsePlanSnapshot(state?.data, legacy, isEinteilungRow).rows;
}

/** Fingerprint includes content; the opaque storage etag is not a planning version. */
export function getEinteilungVersion(rows: EinteilungRow[]): string {
  const parts = rows
    .map((row) => JSON.stringify([row.id, row.personId, row.date, row.team, row.role, row.fixed]))
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** One complete snapshot replaces all assignments atomically, preserving existing IDs. */
export async function saveEinteilung(
  entries: EinteilungEntry[],
  existing: EinteilungRow[],
  names: Map<string, string>,
  expectedVersion: string = getEinteilungVersion(existing)
): Promise<void> {
  const legacy = await getEinteilungRows();
  await mutateNikolausState(
    PLAN_KEY,
    (value) => parsePlanSnapshot(value, legacy, isEinteilungRow),
    (current) => {
      const byKey = new Map(current.rows.map((row) => [`${row.personId}|${row.date}`, row]));
      const rows = entries.map((entry): EinteilungRow => ({
        ...entry,
        name: names.get(entry.personId) ?? '',
        etag: '',
        id:
          byKey.get(`${entry.personId}|${entry.date}`)?.id ??
          `einteilung:${entry.date}:${entry.personId}`,
      }));
      if (getEinteilungVersion(rows) === getEinteilungVersion(current.rows)) return undefined;
      if (getEinteilungVersion(current.rows) !== expectedVersion)
        throw new NikolausStateConflictError();
      return { schema: 1 as const, rows };
    }
  );
}

export async function renameInEinteilung(personId: string, name: string): Promise<void> {
  const legacy = await getEinteilungRows();
  await mutateNikolausState(
    PLAN_KEY,
    (value) => parsePlanSnapshot(value, legacy, isEinteilungRow),
    (current) =>
      current.rows.some((row) => row.personId === personId && row.name !== name)
        ? {
            schema: 1 as const,
            rows: current.rows.map((row) => (row.personId === personId ? { ...row, name } : row)),
          }
        : undefined
  );
}

export async function deleteEinteilungOfPerson(personId: string): Promise<void> {
  const rawLegacy = (await getSharePointListItems(getListId(), { expand: 'fields' })).map(mapRow);
  const matchingLegacy = rawLegacy.filter((row) => row.personId === personId);
  if (matchingLegacy.some((row) => !row.etag || row.etag === '*')) {
    throw new NikolausStateConflictError();
  }
  const legacy = await getEinteilungRows();
  await mutateNikolausState(
    PLAN_KEY,
    (value) => parsePlanSnapshot(value, legacy, isEinteilungRow),
    (current) =>
      current.rows.some((row) => row.personId === personId)
        ? { schema: 1 as const, rows: current.rows.filter((row) => row.personId !== personId) }
        : undefined
  );
  for (const row of matchingLegacy) {
    try {
      await deleteSharePointListItem(getListId(), row.id, row.etag);
    } catch (error: unknown) {
      if (getGraphStatus(error) === 404) continue;
      if (getGraphStatus(error) === 412) throw new NikolausStateConflictError();
      throw error;
    }
  }
}
