import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';
import { CONFIG } from './config';
import type { HelperRole } from './nikolaus-einteilung';
import { HELPER_ROLES, parseTags } from './nikolaus-einteilung';
import type { HelperInput } from './pflege-validation';

/** A helper of the Nikolausdienst as stored in the list „Nikolaus-Helfende“. */
export interface Helper extends HelperInput {
  id: string;
  etag: string;
  /** Stufen whose suggestion from the Stufen-Abgleich was rejected; not part of the form. */
  rejectedStufen: string[];
}

interface HelperListItem {
  id: string;
  eTag?: string;
  fields?: {
    Title?: string;
    Verfuegbarkeit?: string;
    TagsPositiv?: string;
    TagsNegativ?: string;
    Bemerkungen?: string;
    AbgelehnteStufen?: string;
  };
}

function getListId(): string {
  return CONFIG.sharepoint.lists.nikolausHelfende;
}

/** Reads the availability JSON; anything unexpected is dropped instead of failing. */
function parseAvailability(value: string | undefined): Record<string, HelperRole[]> {
  if (!value) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const availability: Record<string, HelperRole[]> = {};
  for (const [date, roles] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(roles)) continue;
    const valid = HELPER_ROLES.filter((role) => roles.includes(role));
    if (valid.length > 0) availability[date] = valid;
  }
  return availability;
}

function mapHelper(item: unknown): Helper {
  const listItem = item as HelperListItem;
  const fields = listItem.fields ?? {};
  return {
    id: String(listItem.id),
    etag: listItem.eTag ?? '',
    name: (fields.Title ?? '').trim(),
    availability: parseAvailability(fields.Verfuegbarkeit),
    positiveTags: parseTags(fields.TagsPositiv ?? ''),
    negativeTags: parseTags(fields.TagsNegativ ?? ''),
    notes: fields.Bemerkungen ?? '',
    rejectedStufen: parseTags(fields.AbgelehnteStufen ?? ''),
  };
}

function toFields(input: HelperInput): Record<string, string> {
  return {
    Title: input.name,
    Verfuegbarkeit: JSON.stringify(input.availability),
    TagsPositiv: input.positiveTags.join(', '),
    TagsNegativ: input.negativeTags.join(', '),
    Bemerkungen: input.notes,
  };
}

/** All helpers, sorted by name. */
export async function getHelpers(): Promise<Helper[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapHelper).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function getHelper(id: string): Promise<Helper | undefined> {
  const item = await getSharePointListItem(getListId(), id);
  return item ? mapHelper(item) : undefined;
}

/**
 * Updates the fields set by the Stufen-Abgleich. They are not part of `toFields`, so saving the
 * helper form never overwrites them.
 */
export async function updateHelperStufen(
  id: string,
  update: { negativeTags?: string[]; rejectedStufen?: string[] },
  etag?: string
): Promise<void> {
  const fields: Record<string, string> = {};
  if (update.negativeTags) fields.TagsNegativ = update.negativeTags.join(', ');
  if (update.rejectedStufen) fields.AbgelehnteStufen = update.rejectedStufen.join(', ');
  await updateSharePointListItem(getListId(), id, fields, etag);
}

export async function createHelper(input: HelperInput): Promise<string> {
  return createSharePointListItem(getListId(), toFields(input));
}

export async function updateHelper(id: string, input: HelperInput, etag?: string): Promise<void> {
  await updateSharePointListItem(getListId(), id, toFields(input), etag);
}

export async function deleteHelper(id: string, etag?: string): Promise<void> {
  await deleteSharePointListItem(getListId(), id, etag);
}
