/** Anwesenheit of the Gruppenstunden. */
import type { StufeSlug } from '../../api/lib/anwesenheit-model';
import {
  addAnwesenheitGuest,
  anwesenheitOverview,
  anwesenheitSlug,
  anwesenheitTermin,
  deleteAnwesenheitTermin,
  markAnwesenheitAbsent,
  markAnwesenheitChild,
  removeAnwesenheitGuest,
  saveAnwesenheitNotes,
  setAnwesenheitCancelled,
} from './mock-data/anwesenheit';
import { error, json, noContent, notFound, route, str } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';

// The demo login leads the Wölflinge, so their tab is preselected.
route('GET', '/api/intern/anwesenheit', () => json(anwesenheitOverview(['Wölflinge'])));

/** The Stufe of the path, if it names a known Stufe and a date that is not in the future. */
function anwesenheitSlugOf(req: MockRequest): StufeSlug | undefined {
  return anwesenheitSlug(req.params.stufe, req.params.datum);
}

route('GET', '/api/intern/anwesenheit/:stufe/:datum', (req) => {
  const slug = anwesenheitSlugOf(req);
  return slug ? json(anwesenheitTermin(slug, req.params.datum)) : notFound();
});

const ANWESENHEIT_CANCELLED = (): MockResult =>
  error(
    400,
    'VALIDATION',
    'Diese Gruppenstunde ist als ausgefallen markiert. Nimm „Ausgefallen“ zurück, um Kinder einzutragen.',
    { cancelled: 'Ausgefallen' }
  );

route(['PUT', 'DELETE'], '/api/intern/pflege/anwesenheit/:stufe/:datum', (req) => {
  const slug = anwesenheitSlugOf(req);
  if (!slug) return notFound();
  if (req.method === 'DELETE') {
    return deleteAnwesenheitTermin(
      slug,
      req.params.datum,
      str(req.headers['if-match']),
      str(req.json?.attendance)
    )
      ? noContent()
      : error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert.');
  }
  const body = req.json ?? {};
  const etag = typeof body.etag === 'string' ? body.etag : null;
  const saved = saveAnwesenheitNotes(slug, req.params.datum, str(body.notes), etag);
  return saved === null
    ? error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert.')
    : json({ etag: saved });
});

route(['PUT', 'DELETE'], '/api/intern/pflege/anwesenheit/:stufe/:datum/kinder/:id', (req) => {
  const slug = anwesenheitSlugOf(req);
  if (!slug) return notFound();
  if (req.method === 'DELETE') {
    markAnwesenheitAbsent(slug, req.params.datum, req.params.id);
    return noContent();
  }
  const status = req.json?.status;
  if (status !== 'anwesend' && status !== 'entschuldigt') {
    return error(400, 'VALIDATION', 'Bitte eine gültige Auswahl treffen.', { status: 'Auswahl' });
  }
  const result = markAnwesenheitChild(
    slug,
    req.params.datum,
    req.params.id,
    status === 'entschuldigt'
  );
  if (result === 'cancelled') return ANWESENHEIT_CANCELLED();
  return result === 'ok' ? noContent() : notFound();
});

route('PUT', '/api/intern/pflege/anwesenheit/:stufe/:datum/ausgefallen', (req) => {
  const slug = anwesenheitSlugOf(req);
  if (!slug) return notFound();
  const cancelled = req.json?.cancelled;
  if (typeof cancelled !== 'boolean') return error(400, 'VALIDATION', 'Ungültige Angabe.');
  const etag = typeof req.json?.etag === 'string' ? req.json.etag : null;
  const entries = typeof req.json?.entries === 'number' ? req.json.entries : 0;
  const saved = setAnwesenheitCancelled(slug, req.params.datum, cancelled, etag, entries);
  return saved === null
    ? error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert.')
    : json({ etag: saved });
});

route('POST', '/api/intern/pflege/anwesenheit/:stufe/:datum/gaeste', (req) => {
  const slug = anwesenheitSlugOf(req);
  if (!slug) return notFound();
  const name = str(req.json?.name).trim();
  if (!name) return error(400, 'VALIDATION', 'Bitte einen Namen angeben.', { name: 'Pflichtfeld' });
  const guest = addAnwesenheitGuest(slug, req.params.datum, name);
  return guest ? json(guest, 201) : ANWESENHEIT_CANCELLED();
});

route('DELETE', '/api/intern/pflege/anwesenheit/:stufe/:datum/gaeste/:id', (req) => {
  if (!anwesenheitSlugOf(req)) return notFound();
  removeAnwesenheitGuest(req.params.stufe, req.params.datum, req.params.id);
  return noContent();
});
