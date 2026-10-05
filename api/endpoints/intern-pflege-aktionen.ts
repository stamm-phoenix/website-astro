import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { CONFIG } from '../lib/config';
import type { CampflowEvent } from '../lib/campflow';
import { getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { campflowOverlay, dateOnly, getStoredAktionen } from '../lib/aktionen-list';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointChoiceValues,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import { toUrlFieldValue, validateUpdateListItem } from '../lib/sharepoint-rest';
import type { AktionInput } from '../lib/pflege-validation';
import {
  LEITENDE_STUFE,
  STUFEN,
  ValidationError,
  sanitizeRichText,
  validateAktion,
} from '../lib/pflege-validation';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';

/** Hyperlink column with the registration link; Graph cannot write it. */
const LINK_FIELD = 'CampFlow_x002d_Anmeldung';
const LINK_DESCRIPTION = 'Anmeldung';

interface CalendarListItem {
  id: string;
  eTag?: string;
  fields: {
    Title?: string;
    Stufen?: string | string[];
    Beschreibung?: string;
    Start?: string;
    End?: string;
    CampFlow_x002d_Anmeldung?: { Url?: string } | null;
    CampFlowId?: string | null;
  };
}

function listId(): string {
  return CONFIG.sharepoint.lists.calendar;
}

/** Stufen offered by the choice column; `Leitende` entries only appear in the Leitende calendar. */
async function getStufen(): Promise<string[]> {
  const choices = await getSharePointChoiceValues(listId(), 'Stufen');
  return choices.length > 0 ? choices : [...STUFEN, LEITENDE_STUFE];
}

/** SharePoint stores date and time; noon UTC keeps the day in every time zone. */
function toDateTime(date: string): string {
  return `${date}T12:00:00Z`;
}

function toGraphFields(input: AktionInput): Record<string, unknown> {
  return {
    Title: input.title,
    'Stufen@odata.type': 'Collection(Edm.String)',
    Stufen: input.stufen,
    Beschreibung: input.description,
    Start: toDateTime(input.start),
    End: toDateTime(input.end || input.start),
    CampFlowId: input.campflowId ?? '',
  };
}

async function writeLink(id: string, link: string): Promise<void> {
  await validateUpdateListItem(listId(), id, {
    [LINK_FIELD]: toUrlFieldValue(link, LINK_DESCRIPTION),
  });
}

function findEvent(events: CampflowEvent[], campflowId: string): CampflowEvent {
  const event = events.find((e) => e.id === campflowId);
  if (!event) {
    throw new ValidationError({ campflowId: 'Diese Aktion gibt es in CampFlow nicht (mehr).' });
  }
  return event;
}

/** Title, dates and link of linked entries always come from CampFlow, never from the form. */
function applyCampflow(input: AktionInput, event: CampflowEvent): AktionInput {
  const owned = campflowOverlay(event);
  if (!owned.start) {
    throw new ValidationError({
      campflowId: 'Die Aktion hat in CampFlow noch kein Datum. Bitte dort zuerst ein Datum setzen.',
    });
  }
  return {
    ...input,
    title: owned.title,
    start: owned.start,
    end: owned.end || owned.start,
    link: owned.campflow_link ?? '',
  };
}

function toStaffItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as CalendarListItem;
  if (typeof item.id !== 'string' || !/^\d+$/.test(item.id)) return null;
  const rawStufen = item.fields?.Stufen;
  const campflowId = item.fields?.CampFlowId?.trim();
  return {
    id: item.id,
    etag: item.eTag ?? '',
    campflowId: campflowId || null,
    title: item.fields?.Title ?? '',
    stufen: Array.isArray(rawStufen) ? rawStufen : rawStufen ? [rawStufen] : [],
    start: dateOnly(item.fields?.Start),
    end: dateOnly(item.fields?.End),
    link: item.fields?.CampFlow_x002d_Anmeldung?.Url ?? '',
    // SharePoint wraps rich text in <div class="ExternalClass…">; the editor gets plain tags
    description: sanitizeRichText(item.fields?.Beschreibung ?? ''),
  };
}

async function loadEvents(): Promise<CampflowEvent[] | HttpResponseInit> {
  try {
    return await getCampflowEvents();
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

/** GET: all calendar entries with the Stufen; POST: publish a CampFlow event or a free entry. */
export const AktionenCollectionEndpoint = pflegeHandler(
  'aktionen',
  async (request: HttpRequest) => {
    if (request.method === 'GET') {
      const [items, stufen] = await Promise.all([
        getSharePointListItems(listId(), { expand: 'fields' }),
        getStufen(),
      ]);
      return ok({ stufen, items: items.map(toStaffItem).filter((item) => item !== null) });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    let input = validateAktion(await readJsonBody(request), await getStufen());
    if (input.campflowId) {
      const campflowId = input.campflowId;
      const existing = await getStoredAktionen();
      if (existing.some((a) => a.campflowId === campflowId)) return CONFLICT;
      const events = await loadEvents();
      if (!Array.isArray(events)) return events;
      input = applyCampflow(input, findEvent(events, campflowId));
    }

    const id = await createSharePointListItem(listId(), toGraphFields(input));
    if (input.link) await writeLink(id, input.link);
    return ok({ id }, 201);
  }
);

/**
 * PATCH: change the loaded version of an entry. An entry without CampFlow event (or whose event
 * was deleted in CampFlow) can be linked to an event no other entry uses, e.g. once the event of
 * an Aktion planned ahead exists; `campflowId: null` turns it into an entry without CampFlow.
 * Entries stay linked as long as their CampFlow event exists. DELETE: remove the entry from the
 * public calendar; CampFlow is not touched.
 */
export const AktionItemEndpoint = pflegeHandler('aktionen', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;

  if (request.method === 'DELETE') {
    await deleteSharePointListItem(listId(), id, requireVersion(readIfMatch(request)));
    return NO_CONTENT;
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const etag = requireVersion(readEtag(body));
  let input = validateAktion(body, await getStufen());

  const stored = (await getSharePointListItem(listId(), id)) as CalendarListItem | undefined;
  if (!stored) return NOT_FOUND;
  const linkedId = stored.fields.CampFlowId?.trim() || null;
  if (input.campflowId && input.campflowId !== linkedId) {
    const campflowId = input.campflowId;
    const existing = await getStoredAktionen();
    if (existing.some((a) => a.id !== id && a.campflowId === campflowId)) return CONFLICT;
  }

  if (input.campflowId || linkedId) {
    const events = await loadEvents();
    if (!Array.isArray(events)) return events;
    if (input.campflowId !== linkedId && events.some((e) => e.id === linkedId)) {
      // The form was based on an outdated state of the entry
      return CONFLICT;
    }
    if (input.campflowId) input = applyCampflow(input, findEvent(events, input.campflowId));
  }

  await updateSharePointListItem(listId(), id, toGraphFields(input), etag);
  await writeLink(id, input.link);
  return NO_CONTENT;
});

export const AktionenCollection = withErrorHandling(AktionenCollectionEndpoint);
export const AktionItem = withErrorHandling(AktionItemEndpoint);
