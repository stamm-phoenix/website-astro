import type { HttpRequest } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointChoiceValues,
  getSharePointListItems,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import { getLeitende } from '../lib/leitende-list';
import type { GruppenstundeInput } from '../lib/pflege-validation';
import {
  NON_STUFE_TEAMS,
  WEEKDAYS,
  sanitizeRichText,
  validateGruppenstunde,
} from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readJsonBody,
} from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';

interface GruppenstundeListItem {
  id: string;
  eTag?: string;
  fields: {
    Title?: string;
    Beschreibung?: string;
    Wochentag?: string;
    Zeit?: string;
    Alter?: string;
    Ort?: string;
  };
}

function listId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_GRUPPENSTUNDEN_LIST_ID);
}

/** The Stufen a Gruppenstunde can belong to: the Team values of the Leitende list. */
async function getStufen(): Promise<string[]> {
  const teams = await getSharePointChoiceValues(
    getEnvironment(EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID),
    'Team'
  );
  return teams.filter((team) => !NON_STUFE_TEAMS.includes(team));
}

function toFields(input: GruppenstundeInput): Record<string, string> {
  return {
    Title: input.stufe,
    Wochentag: input.weekday,
    Zeit: input.time,
    Alter: input.ageRange,
    Ort: input.location,
    Beschreibung: input.description,
  };
}

async function list(): Promise<unknown> {
  const [items, stufen, leitende] = await Promise.all([
    getSharePointListItems(listId(), { expand: 'fields' }) as Promise<GruppenstundeListItem[]>,
    getStufen(),
    getLeitende(),
  ]);

  return {
    stufen,
    weekdays: WEEKDAYS,
    items: items.map((item) => ({
      id: item.id,
      etag: item.eTag ?? '',
      stufe: item.fields.Title ?? '',
      weekday: item.fields.Wochentag ?? '',
      time: item.fields.Zeit ?? '',
      ageRange: item.fields.Alter ?? '',
      location: item.fields.Ort ?? '',
      // SharePoint wraps rich text in <div class="ExternalClass…">; the editor gets plain tags
      description: sanitizeRichText(item.fields.Beschreibung ?? ''),
      leitende: leitende
        .filter((l) => l.teams.includes(item.fields.Title ?? ''))
        .map((l) => ({ id: l.id, name: l.name, hasImage: l.hasImage })),
    })),
  };
}

/** GET: all Gruppenstunden with the allowed Stufen; POST: create a Gruppenstunde. */
export const GruppenstundenCollectionEndpoint = pflegeHandler(
  'gruppenstunden',
  async (request: HttpRequest) => {
    if (request.method === 'GET') return ok(await list());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateGruppenstunde(await readJsonBody(request), await getStufen());
    const id = await createSharePointListItem(listId(), toFields(input));
    return ok({ id }, 201);
  }
);

/** PATCH: update a Gruppenstunde (optimistic locking via etag); DELETE: remove it. */
export const GruppenstundeItemEndpoint = pflegeHandler(
  'gruppenstunden',
  async (request: HttpRequest) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteSharePointListItem(listId(), id);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateGruppenstunde(body, await getStufen());
    await updateSharePointListItem(listId(), id, toFields(input), readEtag(body));
    return NO_CONTENT;
  }
);

export const GruppenstundenCollection = withErrorHandling(GruppenstundenCollectionEndpoint);
export const GruppenstundeItem = withErrorHandling(GruppenstundeItemEndpoint);
