/** Nikolausdienst in the Leitendenbereich: bookings, Dispo, Fahrt, helpers, Einteilung. */
import type { StaffNikolausDispoRow, StaffNikolausEinteilungRow } from '../src/lib/types';
import {
  bookings,
  deleteHelper,
  dispoData,
  dispoVersion,
  dispoRows,
  einteilungData,
  einteilungRows,
  einteilungVersion,
  fahrtData,
  helfendeData,
  routePaths,
  saveDispo,
  saveEinteilung,
  setVisited,
  slotExists,
  staffOverview,
  stufenSuggestions,
  upsertHelper,
  DAYS,
  MOCK_NIKOLAUS_SETTINGS,
  deleteSteuerungData,
  saveSteuerung,
  steuerungEtag,
  steuerungView,
} from './mock-data/nikolaus';
import type { NikolausSettings } from '../src/lib/nikolausConfig';
import { MOCK_NOW, newEtag } from './mock-data/util';
import { error, json, noContent, notFound, route, str, strings } from './mockCore';
import type { MockRequest } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Nikolaus (Leitendenbereich)

function bookingById(id: string): (typeof bookings)[number] | undefined {
  return bookings.find((b) => b.id === id);
}

function readDay(req: MockRequest): string | null {
  const date = req.query.get('date') ?? '';
  return DAYS.includes(date) ? date : null;
}

route('GET', '/api/intern/nikolaus/bookings', () => json(staffOverview()));

route('GET', '/api/intern/nikolaus/status', () =>
  json({
    staffActive: MOCK_NIKOLAUS_SETTINGS.staffActive,
    maintenance: MOCK_NIKOLAUS_SETTINGS.maintenance,
    deleteBy: null,
    deletionDue: false,
  })
);

route('GET', '/api/intern/nikolaus/steuerung', () => json(steuerungView()));

route('PUT', '/api/intern/pflege/nikolaus-steuerung', (req) => {
  const body = req.json ?? {};
  if (body.etag !== steuerungEtag())
    return error(409, 'CONFLICT', 'Die Einstellungen wurden inzwischen geändert.');
  saveSteuerung(body.settings as NikolausSettings, 'mock@stamm-phoenix.de');
  return json(steuerungView());
});

route('POST', '/api/intern/pflege/nikolaus-steuerung/loeschen', (req) => {
  const body = req.json ?? {};
  const scope = body.scope === 'helpers' ? 'helpers' : 'bookings';
  const expected = steuerungView().confirmations[scope];
  if (body.confirmation !== expected) {
    return json(
      {
        error: 'INVALID',
        code: 'INVALID',
        message: 'Die Eingaben sind unvollständig oder ungültig.',
        fields: { confirmation: `Bitte zur Bestätigung „${expected}“ eintippen.` },
      },
      400
    );
  }
  deleteSteuerungData(scope, 'mock@stamm-phoenix.de');
  return json({ scope, deleted: {}, view: steuerungView() });
});

route('POST', '/api/intern/nikolaus/bookings/:id/message', (req) =>
  bookingById(req.params.id) ? noContent() : notFound()
);

route('POST', '/api/intern/nikolaus/bookings/:id/reschedule', (req) => {
  const booking = bookingById(req.params.id);
  if (!booking) return notFound();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  if (req.json?.fromSlot !== booking.slotKey)
    return error(409, 'ALREADY_CHANGED', 'Die Buchung wurde inzwischen geändert. Bitte neu laden.');
  const target = str(req.json?.toSlot);
  if (!slotExists(target))
    return error(400, 'INVALID', 'Unbekannter Termin.', { toSlot: 'Unbekannter Termin.' });
  booking.slotKey = target;
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json({ id: booking.id, mailSent: true });
});

route('POST', '/api/intern/nikolaus/bookings/:id/cancel', (req) => {
  const booking = bookingById(req.params.id);
  if (!booking) return notFound();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  booking.status = 'cancelled';
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json({ mailSent: true });
});

route('PUT', '/api/intern/pflege/nikolaus-bookings/:id/tags', (req) => {
  const booking = bookingById(req.params.id);
  if (!booking) return notFound();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  booking.internalTags = strings(req.json?.tags);
  booking.etag = newEtag(`nik-${booking.id}`);
  return json({ booking: { ...booking } });
});

route('GET', '/api/intern/nikolaus/dispo', (req) => {
  const date = readDay(req);
  return date ? json(dispoData(date)) : notFound();
});

route('POST', '/api/intern/nikolaus/dispo/routes', (req) => {
  const date = readDay(req);
  if (!date) return notFound();
  const raw = req.json?.routes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return error(400, 'INVALID', 'Die Routen sind ungültig.');
  const teamRoutes = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([team, ids]) => [team, strings(ids)])
  );
  return json({ paths: routePaths(teamRoutes) });
});

route('PUT', '/api/intern/pflege/nikolaus-dispo', (req) => {
  const date = readDay(req);
  if (!date) return notFound();
  const body = req.json ?? {};
  const entries = (Array.isArray(body.entries) ? body.entries : []) as Omit<
    StaffNikolausDispoRow,
    'visited' | 'visitedAt'
  >[];
  const current = dispoRows.get(date) ?? [];
  const slots = new Map(dispoData(date).stops.map((booking) => [booking.id, booking.slotKey]));
  const desired = entries.map((entry) => ({ ...entry, slotKey: slots.get(entry.bookingId) ?? '' }));
  if (str(body.version) !== dispoVersion(current)) {
    if (
      dispoVersion(desired.map((entry) => ({ ...entry, visited: false, visitedAt: '' }))) ===
      dispoVersion(current)
    )
      return json({ rows: current, version: dispoVersion(current) });
    return error(409, 'CONFLICT', 'Die Dispo wurde inzwischen geändert.');
  }
  return json(saveDispo(date, desired));
});

route('GET', '/api/intern/nikolaus/fahrt', (req) => {
  const date = readDay(req);
  return date ? json(fahrtData(date)) : notFound();
});

route('POST', '/api/intern/pflege/nikolaus-fahrt', (req) => {
  const date = readDay(req);
  if (!date) return notFound();
  try {
    const saved = setVisited(date, str(req.json?.bookingId), req.json?.visited === true, {
      version: str(req.json?.version),
      operationId: str(req.json?.operationId),
    });
    return saved ? json(saved) : notFound();
  } catch {
    return error(409, 'CONFLICT', 'Der Besuch oder die Route wurde inzwischen geändert.');
  }
});

route('GET', '/api/intern/nikolaus/helfende', () => json(helfendeData()));
route('GET', '/api/intern/nikolaus/einteilung', () => json(einteilungData()));

route('POST', '/api/intern/pflege/nikolaus-helfende', (req) => {
  if (!str(req.json?.name).trim())
    return error(400, 'INVALID', 'Bitte gib einen Namen an.', {
      name: 'Bitte gib einen Namen an.',
    });
  return json({ id: upsertHelper(null, req.json ?? {}).id }, 201);
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/nikolaus-helfende/:id', (req) => {
  if (req.method === 'DELETE') return deleteHelper(req.params.id) ? noContent() : notFound();
  upsertHelper(req.params.id, req.json ?? {});
  return noContent();
});

route('PUT', '/api/intern/pflege/nikolaus-einteilung', (req) => {
  const body = req.json ?? {};
  const rows = (
    Array.isArray(body.assignments) ? body.assignments : []
  ) as StaffNikolausEinteilungRow[];
  if (str(body.version) !== einteilungVersion(einteilungRows)) {
    if (einteilungVersion(rows) === einteilungVersion(einteilungRows))
      return json({ rows: einteilungRows, version: einteilungVersion(einteilungRows) });
    return error(409, 'CONFLICT', 'Die Einteilung wurde inzwischen geändert.');
  }
  return json(saveEinteilung(rows));
});

route('GET', '/api/intern/nikolaus/stufen-abgleich', () =>
  json({ suggestions: stufenSuggestions })
);

route('POST', '/api/intern/pflege/nikolaus-stufen-abgleich', (req) => {
  const body = req.json ?? {};
  const index = stufenSuggestions.findIndex(
    (s) => s.kind === body.kind && s.targetId === body.targetId && s.stufe === body.stufe
  );
  if (index >= 0) {
    const [suggestion] = stufenSuggestions.splice(index, 1);
    if (body.decision === 'accept' && suggestion.kind === 'booking') {
      const booking = bookingById(suggestion.targetId);
      if (booking && !booking.internalTags.includes(suggestion.stufe))
        booking.internalTags = [...booking.internalTags, suggestion.stufe];
    }
  }
  return noContent();
});
