import { getSharePointListItems } from './sharepoint-data-access';
import type { CampflowEvent } from './campflow';
import { CAMPFLOW_EVENT_ID_PATTERN, getCampflowEvents } from './campflow';
import { CONFIG } from './config';

export interface Aktion {
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string | undefined;
  description?: string | undefined;
  start: string;
  end: string;
  /** CampFlow event the entry was published from; its title, dates and link win. */
  campflowId?: string | undefined;
}

/** Fields of a calendar entry that CampFlow owns for linked entries. */
export interface CampflowOwnedFields {
  title: string;
  start: string;
  end: string;
  campflow_link?: string | undefined;
}

const EVENT_CACHE_TTL_MS = 5 * 60 * 1000;
const EVENT_RETRY_AFTER_MS = 60 * 1000;

export function isLeitendeOnly(aktion: Aktion): boolean {
  return aktion.stufen.length === 1 && aktion.stufen.every((s) => s === 'Leitende');
}

/**
 * Title, dates and registration link of a CampFlow event. Missing values fall back to `copy`,
 * the values stored in SharePoint.
 */
export function campflowOverlay(
  event: CampflowEvent,
  copy?: Partial<CampflowOwnedFields>
): CampflowOwnedFields {
  const start = event.start_date ?? event.end_date ?? copy?.start ?? '';
  return {
    title: event.title.trim() || copy?.title || '',
    start,
    end: event.end_date ?? (event.start_date ? start : (copy?.end ?? start)),
    campflow_link: event.url ?? copy?.campflow_link,
  };
}

let eventCache: { events: Map<string, CampflowEvent>; expires: number } | undefined;
let pendingEvents: Promise<Map<string, CampflowEvent> | null> | undefined;

/** Forgets the cached CampFlow events (for tests). */
export function resetCampflowEventCache(): void {
  eventCache = undefined;
  pendingEvents = undefined;
}

/**
 * CampFlow events by id, cached for a few minutes. If CampFlow fails, the last result is served;
 * without one `null` is returned and the stored copies are used.
 */
function cachedCampflowEvents(): Promise<Map<string, CampflowEvent> | null> {
  if (eventCache && eventCache.expires > Date.now()) return Promise.resolve(eventCache.events);
  pendingEvents ??= getCampflowEvents()
    .then((events) => {
      const map = new Map(events.map((event) => [event.id, event]));
      eventCache = { events: map, expires: Date.now() + EVENT_CACHE_TTL_MS };
      return map;
    })
    .catch(() => {
      if (!eventCache) return null;
      eventCache.expires = Date.now() + EVENT_RETRY_AFTER_MS;
      return eventCache.events;
    })
    .finally(() => {
      pendingEvents = undefined;
    });
  return pendingEvents;
}

/** Reads the date part of a SharePoint date field. */
export function dateOnly(value: unknown): string {
  return typeof value === 'string' ? (value.split('T')[0] ?? '') : '';
}

/** Reads the calendar entries as stored in SharePoint, without CampFlow data. */
export async function getStoredAktionen(): Promise<Aktion[]> {
  const SHAREPOINT_CALENDAR_LIST_ID = CONFIG.sharepoint.lists.calendar;

  const items = await getSharePointListItems(SHAREPOINT_CALENDAR_LIST_ID, {
    expand: 'fields',
  });

  return items.map((item: unknown): Aktion => {
    const listItem = item as {
      id: string;
      fields: {
        Stufen: string | string[];
        Title: string;
        CampFlow_x002d_Anmeldung?: { Url: string } | null;
        Beschreibung?: string;
        Start?: string;
        End?: string;
        CampFlowId?: string | null;
      };
    };
    const rawStufen = listItem.fields.Stufen;
    const stufen = Array.isArray(rawStufen) ? rawStufen : rawStufen ? [rawStufen] : [];
    const campflowId = listItem.fields.CampFlowId?.trim();

    return {
      id: listItem.id,
      stufen: stufen,
      title: listItem.fields.Title,
      campflow_link: listItem.fields.CampFlow_x002d_Anmeldung?.Url,
      description: listItem.fields.Beschreibung,
      start: dateOnly(listItem.fields.Start),
      end: dateOnly(listItem.fields.End),
      campflowId: campflowId && CAMPFLOW_EVENT_ID_PATTERN.test(campflowId) ? campflowId : undefined,
    };
  });
}

/**
 * Calendar entries for the public pages. Entries linked to a CampFlow event take title, dates
 * and registration link live from CampFlow; the copy in SharePoint is the fallback.
 */
export async function getAktionen(): Promise<Aktion[]> {
  const aktionen = await getStoredAktionen();
  if (!aktionen.some((a) => a.campflowId)) return aktionen;

  const events = await cachedCampflowEvents();
  if (!events) return aktionen;

  return aktionen.map((aktion) => {
    const event = aktion.campflowId ? events.get(aktion.campflowId) : undefined;
    return event ? { ...aktion, ...campflowOverlay(event, aktion) } : aktion;
  });
}
