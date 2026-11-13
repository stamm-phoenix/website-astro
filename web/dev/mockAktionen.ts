import type { MockRequest, MockResult } from './mockCore';
import { aktionen, type MockAktion } from './mock-data/content';
import { campflowEvents } from './mock-data/campflow';
import { newId, newEtag } from './mock-data/util';
const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', body, status });
const error = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
): MockResult => json({ error: code, code, message, ...(fields ? { fields } : {}) }, status);
const notFound = (): MockResult => error(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');
const noContent = (): MockResult => ({ kind: 'empty', status: 204 });
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const CALENDAR_STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'Leitende'];
const aktionEtags = new Map<string, string>();

function aktionEtag(id: string): string {
  let etag = aktionEtags.get(id);
  if (!etag) aktionEtags.set(id, (etag = newEtag(`aktion-${id}`)));
  return etag;
}

/** Applies the form to an entry; linked entries take title, dates and link from CampFlow. */
function aktionFields(body: Record<string, unknown>): MockResult | Partial<MockAktion> {
  const campflowId = str(body.campflowId) || undefined;
  const fields = {
    stufen: strings(body.stufen).filter((s) => CALENDAR_STUFEN.includes(s)),
    description: str(body.description),
    meetingPoint: str(body.meetingPoint),
    packingList: strings(body.packingList),
    downloadIds: strings(body.downloadIds),
    campflowId,
  };
  if (fields.stufen.length === 0)
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      stufen: 'Bitte mindestens eine Stufe auswählen.',
    });
  if (campflowId) {
    const event = campflowEvents.find((e) => e.id === campflowId);
    if (!event?.start_date)
      return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
        campflowId: 'Diese Aktion gibt es in CampFlow nicht (mehr).',
      });
    return {
      ...fields,
      title: event.title,
      start: event.start_date,
      end: event.end_date ?? event.start_date,
      campflow_link: event.url ?? undefined,
    };
  }
  const start = str(body.start);
  if (!str(body.title).trim() || !start)
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      ...(str(body.title).trim() ? {} : { title: 'Bitte einen Titel angeben.' }),
      ...(start ? {} : { start: 'Bitte ein Startdatum angeben.' }),
    });
  return {
    ...fields,
    title: str(body.title).trim(),
    start,
    end: str(body.end) || start,
    campflow_link: str(body.link) || undefined,
  };
}

export function registerAktionenRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void
): void {
  route(['GET', 'POST'], '/api/intern/pflege/aktionen', (req) => {
    if (req.method === 'GET')
      return json({
        stufen: CALENDAR_STUFEN,
        items: aktionen.map((a) => ({
          id: a.id,
          etag: aktionEtag(a.id),
          campflowId: a.campflowId ?? null,
          title: a.title,
          stufen: a.stufen,
          start: a.start,
          end: a.end,
          link: a.campflow_link ?? '',
          description: a.description ?? '',
          meetingPoint: a.meetingPoint ?? '',
          packingList: a.packingList ?? [],
          downloadIds: a.downloadIds ?? [],
        })),
      });
    const body = req.json ?? {};
    if (str(body.campflowId) && aktionen.some((a) => a.campflowId === str(body.campflowId)))
      return error(409, 'CONFLICT', 'Diese Aktion ist schon veröffentlicht.');
    const fields = aktionFields(body);
    if ('kind' in fields) return fields;
    const id = newId();
    aktionen.push({ id, title: '', start: '', end: '', stufen: [], ...fields });
    return json({ id }, 201);
  });

  route(['PATCH', 'DELETE'], '/api/intern/pflege/aktionen/:id', (req) => {
    const index = aktionen.findIndex((a) => a.id === req.params.id);
    if (index < 0) return notFound();
    if (req.method === 'DELETE') {
      aktionen.splice(index, 1);
      return noContent();
    }
    const body = req.json ?? {};
    const campflowId = str(body.campflowId);
    if (campflowId && aktionen.some((a, i) => i !== index && a.campflowId === campflowId))
      return error(409, 'CONFLICT', 'Diese Aktion ist schon mit einem anderen Eintrag verknüpft.');
    const fields = aktionFields(body);
    if ('kind' in fields) return fields;
    Object.assign(aktionen[index], fields);
    aktionEtags.delete(req.params.id);
    return noContent();
  });
}
