import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { CampflowEvent } from '../lib/campflow';
import { getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import {
  campflowOverlay,
  createAktion,
  deleteAktion,
  getAktionStufen,
  getStaffAktionen,
  updateAktion,
} from '../lib/aktionen-list';
import { parseId } from '../lib/db';
import type { AktionInput } from '../lib/pflege-validation';
import { ValidationError, validateAktion } from '../lib/pflege-validation';
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
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const [items, stufen] = await Promise.all([getStaffAktionen(), getAktionStufen()]);
      return ok({ stufen, items });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    let input = validateAktion(await readJsonBody(request), await getAktionStufen());
    if (input.campflowId) {
      const campflowId = input.campflowId;
      const existing = await getStaffAktionen();
      if (existing.some((a) => a.campflowId === campflowId)) return CONFLICT;
      const events = await loadEvents();
      if (!Array.isArray(events)) return events;
      input = applyCampflow(input, findEvent(events, campflowId));
    }

    // The database refuses a second entry for the same CampFlow event (409)
    return ok({ id: await createAktion(input, principal.userDetails) }, 201);
  }
);

/**
 * PATCH: change the loaded version of an entry. An entry without CampFlow event (or whose event
 * was deleted in CampFlow) can be linked to an event no other entry uses, e.g. once the event of
 * an Aktion planned ahead exists; `campflowId: null` turns it into an entry without CampFlow.
 * Entries stay linked as long as their CampFlow event exists. DELETE: remove the entry from the
 * public calendar; CampFlow is not touched.
 */
export const AktionItemEndpoint = pflegeHandler(
  'aktionen',
  async (request: HttpRequest, _context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteAktion(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    let input = validateAktion(body, await getAktionStufen());

    const existing = await getStaffAktionen();
    const stored = existing.find((a) => a.id === String(id));
    if (!stored) return NOT_FOUND;
    const linkedId = stored.campflowId;
    if (input.campflowId && input.campflowId !== linkedId) {
      const campflowId = input.campflowId;
      if (existing.some((a) => a.id !== String(id) && a.campflowId === campflowId)) return CONFLICT;
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

    await updateAktion(id, input, etag, principal.userDetails);
    return NO_CONTENT;
  }
);

export const AktionenCollection = withErrorHandling(AktionenCollectionEndpoint);
export const AktionItem = withErrorHandling(AktionItemEndpoint);
