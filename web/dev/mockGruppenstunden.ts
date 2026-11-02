import type { MockRequest, MockResult } from './mockApi';
import { readGruppenstundenException } from '../../api/lib/validation/gruppenstunden-exception';
import {
  gruppenstunden,
  publicGruppenstunden,
  staffGruppenstunden,
  STUFEN,
  WEEKDAYS,
} from './mock-data/people';
import { newId, newEtag } from './mock-data/util';
const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const noContent = (): MockResult => ({ kind: 'empty', status: 204 });
const notFound = (): MockResult =>
  json(
    { error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Der Eintrag wurde nicht gefunden.' },
    404
  );
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export function registerGruppenstundenRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void
): void {
  route('GET', '/api/gruppenstunden', () => json(publicGruppenstunden()));
  route(['GET', 'POST'], '/api/intern/pflege/gruppenstunden', (req) => {
    if (req.method === 'GET')
      return json({ items: staffGruppenstunden(), stufen: STUFEN, weekdays: WEEKDAYS });
    const body = req.json ?? {};
    const id = newId();
    gruppenstunden.push({
      id,
      etag: newEtag(`gs-${id}`),
      stufe: str(body.stufe, STUFEN[0]),
      weekday: str(body.weekday, WEEKDAYS[0]),
      time: str(body.time),
      ageRange: str(body.ageRange),
      location: str(body.location),
      description: str(body.description),
      exception: readGruppenstundenException(JSON.stringify(body.exception) ?? null),
    });
    return json({ id }, 201);
  });

  route(['PATCH', 'DELETE'], '/api/intern/pflege/gruppenstunden/:id', (req) => {
    const index = gruppenstunden.findIndex((g) => g.id === req.params.id);
    if (index < 0) return notFound();
    if (req.method === 'DELETE') {
      gruppenstunden.splice(index, 1);
      return noContent();
    }
    const body = req.json ?? {};
    const g = gruppenstunden[index];
    Object.assign(g, {
      stufe: str(body.stufe, g.stufe),
      weekday: str(body.weekday, g.weekday),
      time: str(body.time, g.time),
      ageRange: str(body.ageRange, g.ageRange),
      location: str(body.location, g.location),
      description: str(body.description, g.description),
      exception:
        body.exception === undefined
          ? (g.exception ?? null)
          : readGruppenstundenException(JSON.stringify(body.exception) ?? null),
      etag: newEtag(`gs-${g.id}`),
    });
    return noContent();
  });
}
