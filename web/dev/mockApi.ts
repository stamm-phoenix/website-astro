/**
 * Local mock of the Azure Functions API and the Static Web Apps auth endpoints, so every page
 * renders with realistic test data without a backend: `MOCK_API=1 bun run dev`.
 *
 * Handles `/api/*` and `/.auth/*`; everything else goes to Astro. Writes succeed after a short
 * delay (to make loading states visible) and are kept in memory until the dev server restarts.
 * Unknown API paths answer 404 and are logged, so gaps are easy to spot.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type {
  ClientPrincipal,
  StaffBeleg,
  StaffNikolausDispoRow,
  StaffNikolausEinteilungRow,
} from '../src/lib/types';
import { campflowDetail, campflowEvents } from './mock-data/campflow';
import {
  aktionen,
  blogEntries,
  blogUploads,
  buildIcs,
  downloads,
  instagramPosts,
  minimalPdf,
  publicAktionen,
  publicBlogList,
  publicBlogPost,
  publicDownloads,
  QA_CATEGORIES,
  questions,
  staffBlogList,
  staffBlogPost,
  staffDownloads,
} from './mock-data/content';
import {
  bookingForToken,
  bookingInfo,
  bookings,
  createBooking,
  deleteHelper,
  dispoData,
  dispoVersion,
  dispoRows,
  einteilungData,
  einteilungRows,
  einteilungVersion,
  fahrtData,
  geocode,
  helfendeData,
  publicSlots,
  routePaths,
  saveDispo,
  saveEinteilung,
  setVisited,
  slotExists,
  staffOverview,
  stufenSuggestions,
  upsertHelper,
  visitProgress,
  DAYS,
} from './mock-data/nikolaus';
import {
  gruppenstunden,
  leitende,
  leitendePhotos,
  publicGruppenstunden,
  publicLeitende,
  publicVorstand,
  staffGruppenstunden,
  STUFEN,
  TEAMS,
  WEEKDAYS,
} from './mock-data/people';
import {
  campaigns,
  createCampaign,
  invitations,
  orders,
  productInfo,
  touchCampaign,
  touchOrder,
} from './mock-data/sammel';
import { avatarSvg, documentPreviewSvg, pickColor, sceneSvg, STUFE_COLORS } from './mock-data/svg';
import { dayFromToday, isoFromNow, MOCK_NOW, newEtag, newId } from './mock-data/util';

// ---------------------------------------------------------------------------------------------
// Plumbing

/** Delay for reads and writes, so skeletons and busy states can be reviewed. */
const READ_DELAY_MS: [number, number] = [150, 350];
const WRITE_DELAY_MS: [number, number] = [600, 900];

interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  raw: Buffer;
  /** Parsed JSON body, or `null` if the body is empty or not JSON. */
  json: Record<string, unknown> | null;
}

type MockResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | {
      kind: 'raw';
      status: number;
      contentType: string;
      body: string | Uint8Array;
      headers?: Record<string, string>;
    }
  | { kind: 'redirect'; location: string };

type Handler = (req: MockRequest) => MockResult;

interface Route {
  methods: string[];
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Images and files are answered without artificial delay. */
  instant?: boolean;
}

const routes: Route[] = [];

/** Registers a route; `:name` segments become `params.name`. */
function route(methods: string | string[], path: string, handler: Handler, instant = false): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      }) +
      '/?$'
  );
  routes.push({
    methods: Array.isArray(methods) ? methods : [methods],
    pattern,
    keys,
    handler,
    instant,
  });
}

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const noContent = (): MockResult => ({ kind: 'empty', status: 204 });
const error = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
): MockResult => json({ error: code, code, message, ...(fields ? { fields } : {}) }, status);
const notFound = (message = 'Der Eintrag wurde nicht gefunden.'): MockResult =>
  error(404, 'NOT_FOUND', message);
const svg = (body: string): MockResult => ({
  kind: 'raw',
  status: 200,
  contentType: 'image/svg+xml; charset=utf-8',
  body,
  headers: { 'Cache-Control': 'private, max-age=60' },
});
const jpeg = (bytes: Uint8Array): MockResult => ({
  kind: 'raw',
  status: 200,
  contentType: 'image/jpeg',
  body: bytes,
});

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function wait(range: [number, number]): Promise<void> {
  const ms = (range[0] + range[1]) / 2;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(raw: Buffer, contentType: string | undefined): Record<string, unknown> | null {
  if (raw.length === 0 || !contentType?.includes('json')) return null;
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, result: MockResult): void {
  res.setHeader('X-Mock-Api', '1');
  if (result.kind === 'redirect') {
    res.statusCode = 302;
    res.setHeader('Location', result.location);
    res.end();
    return;
  }
  res.statusCode = result.status;
  if (result.kind === 'empty') {
    res.end();
    return;
  }
  if (result.kind === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result.body));
    return;
  }
  res.setHeader('Content-Type', result.contentType);
  for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
  res.end(typeof result.body === 'string' ? result.body : Buffer.from(result.body));
}

// ---------------------------------------------------------------------------------------------
// Static Web Apps auth

const LOGGED_OUT_COOKIE = 'mock_logged_out';

const PRINCIPAL: ClientPrincipal = {
  identityProvider: 'aad',
  userId: 'mock-0f3c2a7e9b1d4c58',
  userDetails: 'leitung@example.test',
  userRoles: ['anonymous', 'authenticated'],
  claims: [
    { typ: 'name', val: 'Demo Leitung' },
    { typ: 'given_name', val: 'Demo' },
    { typ: 'family_name', val: 'Leitung' },
    { typ: 'preferred_username', val: 'leitung@example.test' },
    { typ: 'tid', val: '0e650e3e-3da0-4a47-bf6c-df3dd3980caa' },
  ],
};

function isLoggedOut(req: MockRequest): boolean {
  return /(?:^|;\s*)mock_logged_out=1/.test(req.headers.cookie ?? '');
}

function safeRedirect(target: string | null, fallback: string): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : fallback;
}

function handleAuth(req: MockRequest, res: ServerResponse): void {
  if (req.path === '/.auth/me') {
    send(res, json({ clientPrincipal: isLoggedOut(req) ? null : PRINCIPAL }));
    return;
  }
  if (req.path.startsWith('/.auth/login')) {
    res.setHeader('Set-Cookie', `${LOGGED_OUT_COOKIE}=; Path=/; Max-Age=0`);
    send(res, {
      kind: 'redirect',
      location: safeRedirect(req.query.get('post_login_redirect_uri'), '/leitendenbereich'),
    });
    return;
  }
  if (req.path.startsWith('/.auth/logout')) {
    res.setHeader('Set-Cookie', `${LOGGED_OUT_COOKIE}=1; Path=/`);
    send(res, {
      kind: 'redirect',
      location: safeRedirect(req.query.get('post_logout_redirect_uri'), '/'),
    });
    return;
  }
  send(res, notFound('Unbekannter Auth-Endpunkt (Mock).'));
}

/** Like `requireStaff`: intern endpoints need a login. */
function requireLogin(req: MockRequest): MockResult | null {
  return isLoggedOut(req) ? error(401, 'UNAUTHORIZED', 'Bitte melde dich an.') : null;
}

// ---------------------------------------------------------------------------------------------
// Public content

route('GET', '/api/gruppenstunden', () => json(publicGruppenstunden()));
route(
  'GET',
  '/api/mock/campflow-embed',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: `(() => {
      const script = document.currentScript;
      if (!script || script.parentElement.querySelector('iframe')) return;
      const frame = document.createElement('iframe');
      frame.title = 'Mitgliedsantrag';
      frame.style.cssText = 'width:100%;height:200px;border:0';
      frame.srcdoc = '<p>Demo-Mitgliedsantrag. Diese Eingaben werden nicht versendet.</p><form><label>Vorname <input name="firstName"></label><button type="button" disabled>Antrag senden (Demo)</button></form>';
      script.after(frame);
    })();`,
  }),
  true
);
route('GET', '/api/leitende', () => json(publicLeitende()));
route('GET', '/api/vorstand', () => json(publicVorstand()));
route('GET', '/api/aktionen', () => json(publicAktionen()));
route(
  'GET',
  '/api/aktionen.ics',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: buildIcs(publicAktionen(), 'DPSG Stamm Phoenix - Aktionen'),
    headers: { 'Content-Disposition': 'attachment; filename="aktionen.ics"' },
  }),
  true
);
route(
  'GET',
  '/api/leitende.ics',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: buildIcs(aktionen, 'DPSG Stamm Phoenix - Leitende'),
    headers: { 'Content-Disposition': 'attachment; filename="leitende.ics"' },
  }),
  true
);

route(
  'GET',
  '/api/leitende/:id/image',
  (req) => {
    const person = leitende.find((p) => p.id === req.params.id);
    if (!person || !person.hasImage) return notFound();
    const photo = leitendePhotos.get(person.id);
    if (photo) return jpeg(photo);
    const team = person.teams.find((t) => STUFE_COLORS[t]) ?? '';
    return svg(avatarSvg(person.name, STUFE_COLORS[team] ?? pickColor(person.name)));
  },
  true
);

route('GET', '/api/blog', () => json(publicBlogList()));
route('GET', '/api/blog/:id', (req) => {
  const post = publicBlogPost(req.params.id);
  return post ? json(post) : notFound('Der Beitrag wurde nicht gefunden.');
});

function blogImage(
  postId: string,
  file: string,
  requestedWidth: string | null,
  onlyPublished: boolean
): MockResult {
  const entry = blogEntries.find((e) => e.id === postId && (!onlyPublished || e.published));
  const image = entry?.images.find((i) => i.file === file);
  if (!entry || !image) return notFound();
  const upload = blogUploads.get(`${postId}/${file}`);
  if (upload) return jpeg(upload);
  const width = Math.min(Number(requestedWidth) || 800, image.width);
  const height = Math.max(1, Math.round((width * image.height) / image.width));
  return svg(sceneSvg(`${postId}-${file}`, width, height, image.alt || undefined));
}

route(
  'GET',
  '/api/blog/:id/bilder/:file',
  (req) => blogImage(req.params.id, req.params.file, req.query.get('w'), true),
  true
);

route('GET', '/api/downloads', () => json(publicDownloads()));
route(
  'GET',
  '/api/downloads/:id/image/:size',
  (req) => {
    const file = downloads.find((d) => d.id === req.params.id);
    if (!file) return notFound();
    const width = req.params.size === 'large' ? 800 : req.params.size === 'medium' ? 400 : 200;
    return svg(
      file.mimeType.startsWith('image/')
        ? sceneSvg(file.id, width, Math.round(width * 0.75))
        : documentPreviewSvg(file.fileName, width, Math.round(width * 1.414))
    );
  },
  true
);
route(
  'GET',
  '/api/downloads/:id/file',
  (req) => {
    const file = downloads.find((d) => d.id === req.params.id);
    if (!file) return notFound();
    const isPdf = file.mimeType === 'application/pdf';
    return {
      kind: 'raw',
      status: 200,
      contentType: isPdf ? 'application/pdf' : 'text/plain; charset=utf-8',
      body: isPdf
        ? minimalPdf(file.fileName)
        : `Testdatei der Mock-API: ${file.fileName}\nIm echten Betrieb kommt hier die Datei aus SharePoint.\n`,
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          isPdf ? file.fileName : `${file.fileName}.txt`
        )}`,
      },
    };
  },
  true
);

route('GET', '/api/qa', () =>
  json(
    questions
      .filter((q) => q.published)
      .map((q) => ({ id: q.id, question: q.question, answer: q.answer, category: q.category }))
  )
);

route('GET', '/api/instagram', () => json(instagramPosts));
route(
  'GET',
  '/api/instagram/:id/image',
  (req) => {
    const post = instagramPosts.find((p) => p.id === req.params.id);
    const index = Number(req.query.get('index') ?? '0');
    if (!post || !Number.isInteger(index) || index < 0 || index >= post.imageCount)
      return notFound();
    const size = req.query.get('size') === 'large' ? 1080 : 480;
    // Carousels alternate between square and portrait images, like real posts
    const height =
      post.mediaType === 'CAROUSEL_ALBUM' && index % 2 === 1 ? Math.round(size * 1.25) : size;
    return svg(sceneSvg(`ig-${post.id}-${index}`, size, height));
  },
  true
);
route(
  'GET',
  '/api/instagram/:id/video',
  () => error(404, 'NO_VIDEO', 'Im Mock-Modus gibt es keine Videos.'),
  true
);

// ---------------------------------------------------------------------------------------------
// Nikolaus (public)

route('GET', '/api/nikolaus/slots', () => json(publicSlots()));

route('POST', '/api/nikolaus/bookings', (req) => {
  const body = req.json ?? {};
  if (str(body.website)) return json({ status: 'pending' }, 201);
  if (!slotExists(str(body.slot)))
    return error(400, 'INVALID_SLOT', 'Dieser Termin existiert nicht.');
  const booking = createBooking(body);
  return json({ status: 'pending', reservedUntil: booking.reservedUntil }, 201);
});

route('POST', '/api/nikolaus/geocode', (req) => {
  const body = req.json ?? {};
  const location = geocode(str(body.street), str(body.postalCode), str(body.city));
  if (!location) return json({ found: false });
  return json({
    found: true,
    precision: location.approximate ? 'area' : 'address',
    lat: location.lat,
    lon: location.lon,
  });
});

function manageBooking(req: MockRequest): ReturnType<typeof bookingForToken> {
  return bookingForToken(str(req.json?.token));
}

const INVALID_TOKEN = (): MockResult =>
  error(404, 'INVALID_TOKEN', 'Dieser Link ist ungültig oder abgelaufen.');

route('POST', '/api/nikolaus/manage/lookup', (req) => {
  const booking = manageBooking(req);
  return booking ? json(bookingInfo(booking)) : INVALID_TOKEN();
});

route('POST', '/api/nikolaus/manage/progress', (req) => {
  const booking = manageBooking(req);
  return booking ? json(visitProgress(str(req.json?.token), booking)) : INVALID_TOKEN();
});

route('POST', '/api/nikolaus/manage/confirm', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  if (booking.status === 'cancelled')
    return error(410, 'CANCELLED', 'Dieser Termin wurde abgesagt.');
  if (booking.status === 'expired')
    return error(410, 'EXPIRED', 'Die Reservierung ist abgelaufen. Bitte buchen Sie erneut.');
  booking.status = 'confirmed';
  booking.reservedUntil = null;
  booking.confirmedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/cancel', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  booking.status = 'cancelled';
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

const DETAIL_KEYS = [
  'familyName',
  'email',
  'phone',
  'street',
  'postalCode',
  'city',
  'addressNotes',
  'hidingPlace',
  'notes',
] as const;

route('POST', '/api/nikolaus/manage/update', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  const body = req.json ?? {};
  const address = `${booking.street}|${booking.postalCode}|${booking.city}`;
  for (const key of DETAIL_KEYS)
    if (typeof body[key] === 'string') booking[key] = str(body[key]).trim();
  if (typeof body.childrenCount === 'number') booking.childrenCount = body.childrenCount;
  if (typeof body.withKrampus === 'boolean') booking.withKrampus = body.withKrampus;
  if (address !== `${booking.street}|${booking.postalCode}|${booking.city}`)
    booking.location = geocode(booking.street, booking.postalCode, booking.city);
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/reschedule', (req) => {
  const booking = manageBooking(req);
  if (!booking) return INVALID_TOKEN();
  if (!req.json?.etag || req.json.etag === '*' || req.json.etag !== booking.etag)
    return error(
      409,
      'ALREADY_CHANGED',
      'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
    );
  const slot = str(req.json?.slot);
  if (!slotExists(slot)) return error(400, 'INVALID_SLOT', 'Dieser Termin existiert nicht.');
  const free = publicSlots().find((s) => s.key === slot);
  if (free && free.available <= 0 && slot !== booking.slotKey)
    return error(409, 'SLOT_FULL', 'Dieser Termin ist inzwischen leider ausgebucht.');
  booking.slotKey = slot;
  booking.changedAt = new Date(MOCK_NOW).toISOString();
  booking.etag = newEtag(`nik-${booking.id}`);
  return json(bookingInfo(booking));
});

route('POST', '/api/nikolaus/manage/resend-link', () =>
  json({ status: 'sent', cooldownMinutes: 15 })
);

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
  const saved = setVisited(date, str(req.json?.bookingId), req.json?.visited === true);
  return saved ? json(saved) : notFound();
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

// ---------------------------------------------------------------------------------------------
// CampFlow (Leitendenbereich → Aktionen)

route('GET', '/api/intern/aktionen', () => json(campflowEvents));
route('GET', '/api/intern/aktionen/:id', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const detail = campflowDetail(req.params.id);
  return detail ? json(detail) : notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
});

// ---------------------------------------------------------------------------------------------
// Pflege: FAQ, Gruppenstunden, Leitende, Downloads, Blog

route(['GET', 'POST'], '/api/intern/pflege/qa', (req) => {
  if (req.method === 'GET')
    return json({ items: questions, categories: QA_CATEGORIES, allowCustomCategories: true });
  const body = req.json ?? {};
  const id = newId();
  questions.push({
    id,
    etag: newEtag(`qa-${id}`),
    question: str(body.question),
    answer: str(body.answer),
    category: str(body.category, QA_CATEGORIES[0]),
    published: body.published === true,
  });
  return json({ id }, 201);
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/qa/:id', (req) => {
  const index = questions.findIndex((q) => q.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    questions.splice(index, 1);
    return noContent();
  }
  const body = req.json ?? {};
  const q = questions[index];
  Object.assign(q, {
    question: str(body.question, q.question),
    answer: str(body.answer, q.answer),
    category: str(body.category, q.category),
    published: typeof body.published === 'boolean' ? body.published : q.published,
    etag: newEtag(`qa-${q.id}`),
  });
  return noContent();
});

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
    etag: newEtag(`gs-${g.id}`),
  });
  return noContent();
});

function applyLeitende(target: (typeof leitende)[number], body: Record<string, unknown>): void {
  target.name = str(body.name, target.name);
  target.teams = Array.isArray(body.teams) ? strings(body.teams) : target.teams;
  target.phone = str(body.phone, target.phone);
  target.street = str(body.street, target.street);
  target.postalCode = str(body.postalCode, target.postalCode);
  target.city = str(body.city, target.city);
  target.etag = newEtag(`leitende-${target.id}`);
}

route(['GET', 'POST'], '/api/intern/pflege/leitende', (req) => {
  if (req.method === 'GET') return json({ items: leitende, teams: TEAMS });
  const person = {
    id: newId(),
    etag: '',
    name: '',
    teams: [],
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    hasImage: false,
  };
  applyLeitende(person, req.json ?? {});
  leitende.push(person);
  return json({ id: person.id }, 201);
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/leitende/:id', (req) => {
  const index = leitende.findIndex((p) => p.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    leitende.splice(index, 1);
    return noContent();
  }
  applyLeitende(leitende[index], req.json ?? {});
  return noContent();
});

route(['PUT', 'DELETE'], '/api/intern/pflege/leitende/:id/foto', (req) => {
  const person = leitende.find((p) => p.id === req.params.id);
  if (!person) return notFound();
  if (req.method === 'DELETE') {
    leitendePhotos.delete(person.id);
    person.hasImage = false;
  } else {
    if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
      return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    leitendePhotos.set(person.id, new Uint8Array(req.raw));
    person.hasImage = true;
  }
  person.etag = newEtag(`leitende-${person.id}`);
  return req.method === 'DELETE' ? noContent() : json({ hasImage: true });
});

// --- Belege ---

/** What the mocked image model answers for every photo. */
function mockBelegCheck(): NonNullable<StaffBeleg['aiCheck']> {
  return {
    ok: true,
    isReceipt: true,
    complete: true,
    readable: true,
    issues: [],
    shop: 'Demo-Markt',
    date: dayFromToday(-1),
    amountCent: 999,
    checkedAt: new Date(MOCK_NOW).toISOString(),
  };
}

const belege: StaffBeleg[] = [
  {
    id: '41',
    etag: newEtag('beleg-41'),
    shop: 'REWE',
    date: dayFromToday(-2),
    amountCent: 4387,
    paidBy: 'Demo Leitung',
    payout: true,
    aktion: 'Herbstlager 2026',
    note: 'Lebensmittel für Samstag',
    status: 'Eingereicht',
    reviewNote: '',
    paidOut: false,
    submittedBy: 'leitung@example.test',
    submittedAt: isoFromNow(-1.8),
    hasImage: true,
    hasOriginal: false,
    aiCheck: { ...mockBelegCheck(), shop: 'REWE', amountCent: 4387 },
  },
  {
    id: '40',
    etag: newEtag('beleg-40'),
    shop: 'Bauhaus',
    date: dayFromToday(-9),
    amountCent: 2199,
    paidBy: 'Kim Beispiel',
    payout: true,
    aktion: 'Gruppenstunde Pfadfinder',
    note: '',
    status: 'Rückfrage',
    reviewNote: 'Der Betrag ist auf dem Foto abgeschnitten. Bitte neu fotografieren.',
    paidOut: false,
    submittedBy: 'kim@example.test',
    submittedAt: isoFromNow(-8),
    hasImage: true,
    hasOriginal: false,
    aiCheck: {
      ...mockBelegCheck(),
      ok: false,
      complete: false,
      issues: ['Der untere Rand mit dem Gesamtbetrag ist abgeschnitten.'],
      shop: 'Bauhaus',
      amountCent: null,
    },
  },
  {
    id: '39',
    etag: newEtag('beleg-39'),
    shop: 'Deutsche Bahn',
    date: dayFromToday(-20),
    amountCent: 11840,
    paidBy: 'Sam Muster',
    payout: true,
    aktion: 'Pfingstlager 2026',
    note: 'Fahrkarten Vorbereitungsteam',
    status: 'Geprüft',
    reviewNote: '',
    paidOut: false,
    submittedBy: 'sam@example.test',
    submittedAt: isoFromNow(-19),
    hasImage: true,
    hasOriginal: false,
    aiCheck: null,
  },
];
const belegPhotos = new Map<string, Uint8Array>();
const belegOriginals = new Map<string, Uint8Array>();

/** Stores `photo` and the optional `original` of a JSON body; returns an error if invalid. */
function storeBelegPhotos(beleg: StaffBeleg, body: Record<string, unknown>): MockResult | null {
  const photo = Buffer.from(str(body.photo), 'base64');
  const original = body.original ? Buffer.from(str(body.original), 'base64') : null;
  for (const bytes of [photo, original]) {
    if (bytes && (bytes[0] !== 0xff || bytes[1] !== 0xd8))
      return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  }
  setBelegPhoto(beleg.id, photo);
  if (original) belegOriginals.set(beleg.id, new Uint8Array(original));
  else belegOriginals.delete(beleg.id);
  beleg.hasOriginal = original !== null;
  return null;
}

function setBelegPhoto(id: string, bytes: Uint8Array): void {
  belegPhotos.set(id, new Uint8Array(bytes));
}

function applyBeleg(target: StaffBeleg, body: Record<string, unknown>): void {
  target.shop = str(body.shop, target.shop);
  target.date = str(body.date, target.date);
  target.amountCent = typeof body.amountCent === 'number' ? body.amountCent : target.amountCent;
  target.paidBy = str(body.paidBy, target.paidBy);
  target.payout = body.payout === true;
  target.aktion = str(body.aktion, target.aktion);
  target.note = str(body.note, target.note);
  target.status = (str(body.status, target.status) as StaffBeleg['status']) || 'Eingereicht';
  target.reviewNote = str(body.reviewNote, target.reviewNote);
  target.paidOut = target.payout && body.paidOut === true;
  target.etag = newEtag(`beleg-${target.id}`);
}

route(['GET', 'POST'], '/api/intern/pflege/belege', (req) => {
  if (req.method === 'GET') return json(belege);
  const body = req.json ?? {};
  const beleg: StaffBeleg = {
    id: newId(),
    etag: '',
    shop: '',
    date: '',
    amountCent: 0,
    paidBy: '',
    payout: false,
    aktion: '',
    note: '',
    status: 'Eingereicht',
    reviewNote: '',
    paidOut: false,
    submittedBy: PRINCIPAL.userDetails,
    submittedAt: new Date(MOCK_NOW).toISOString(),
    hasImage: true,
    hasOriginal: false,
    aiCheck: mockBelegCheck(),
  };
  const invalid = storeBelegPhotos(beleg, body);
  if (invalid) return invalid;
  applyBeleg(beleg, { ...body, status: 'Eingereicht', reviewNote: '', paidOut: false });
  belege.unshift(beleg);
  return json({ id: beleg.id }, 201);
});

route('POST', '/api/intern/pflege/belege/pruefung', (req) => {
  if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
    return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  return json({ available: true, check: mockBelegCheck() });
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/belege/:id', (req) => {
  const index = belege.findIndex((b) => b.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    belege.splice(index, 1);
    return noContent();
  }
  if (str(req.json?.status) === 'Rückfrage' && !str(req.json?.reviewNote).trim()) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      reviewNote: 'Bitte die Rückfrage beschreiben.',
    });
  }
  applyBeleg(belege[index], req.json ?? {});
  return noContent();
});

route(
  ['GET', 'PUT'],
  '/api/intern/pflege/belege/:id/foto',
  (req) => {
    const beleg = belege.find((b) => b.id === req.params.id);
    if (!beleg) return notFound();
    if (req.method === 'PUT') {
      const invalid = storeBelegPhotos(beleg, req.json ?? {});
      if (invalid) return invalid;
      beleg.etag = newEtag(`beleg-${beleg.id}`);
      return json({ hasImage: true });
    }
    const stored = (req.query.get('original') ? belegOriginals : belegPhotos).get(beleg.id);
    if (stored) return jpeg(stored);
    return svg(documentPreviewSvg(`${beleg.shop}.jpg`, 600, 800));
  },
  true
);

route('GET', '/api/intern/pflege/downloads', () => json(staffDownloads()));

/** Running uploads: upload id → target file name. */
const uploadSessions = new Map<string, { fileName: string; replace: boolean }>();

route('POST', '/api/intern/pflege/downloads/upload', (req) => {
  const body = req.json ?? {};
  const fileName = str(body.fileName).trim();
  if (!fileName)
    return error(400, 'INVALID', 'Bitte gib einen Dateinamen an.', {
      fileName: 'Bitte gib einen Dateinamen an.',
    });
  if (body.replace !== true && downloads.some((d) => d.fileName === fileName))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es schon.');
  const id = newId();
  uploadSessions.set(id, { fileName, replace: body.replace === true });
  return json({ uploadUrl: `/api/__mock/upload/${id}` });
});

/** Upload session (stands in for the SharePoint upload URL); chunks with `Content-Range`. */
route(
  'PUT',
  '/api/__mock/upload/:id',
  (req) => {
    const session = uploadSessions.get(req.params.id);
    if (!session) return notFound();
    const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(String(req.headers['content-range'] ?? ''));
    const end = range ? Number(range[2]) : req.raw.length - 1;
    const total = range ? Number(range[3]) : req.raw.length;
    if (end + 1 < total) return json({ nextExpectedRanges: [`${end + 1}-`] }, 202);
    uploadSessions.delete(req.params.id);
    const extension = session.fileName.split('.').pop()?.toLowerCase() ?? '';
    const mimeType =
      { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[
        extension
      ] ?? 'application/octet-stream';
    const now = new Date(MOCK_NOW).toISOString();
    const existing = downloads.find((d) => d.fileName === session.fileName);
    if (existing)
      Object.assign(existing, { size: total, lastModifiedAt: now, lastModifiedBy: 'Demo Leitung' });
    else
      downloads.push({
        id: `01MOCKUP${req.params.id}`,
        fileName: session.fileName,
        size: total,
        mimeType,
        createdAt: now,
        createdBy: 'Demo Leitung',
        lastModifiedAt: now,
        lastModifiedBy: 'Demo Leitung',
        hasPreview: mimeType === 'application/pdf' || mimeType.startsWith('image/'),
      });
    return json({ id: req.params.id }, 201);
  },
  true
);

route(['PATCH', 'DELETE'], '/api/intern/pflege/downloads/:id', (req) => {
  const index = downloads.findIndex((d) => d.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    downloads.splice(index, 1);
    return noContent();
  }
  const fileName = str(req.json?.fileName).trim();
  if (fileName && downloads.some((d, i) => i !== index && d.fileName === fileName))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es schon.');
  if (fileName) downloads[index].fileName = fileName;
  downloads[index].lastModifiedAt = new Date(MOCK_NOW).toISOString();
  return noContent();
});

route(['GET', 'POST'], '/api/intern/pflege/blog', (req) => {
  if (req.method === 'GET') return json(staffBlogList());
  const body = req.json ?? {};
  const id = newId();
  const entry = {
    id,
    etag: newEtag(`blog-${id}`),
    title: str(body.title),
    date: str(body.date, new Date(MOCK_NOW).toISOString().slice(0, 10)),
    published: body.published === true,
    content: str(body.content),
    images: [],
  };
  blogEntries.push(entry);
  return json({ id, etag: entry.etag }, 201);
});

route(['GET', 'PATCH', 'DELETE'], '/api/intern/pflege/blog/:id', (req) => {
  const index = blogEntries.findIndex((e) => e.id === req.params.id);
  if (index < 0) return notFound('Der Beitrag wurde nicht gefunden.');
  const entry = blogEntries[index];
  if (req.method === 'GET') return json(staffBlogPost(entry));
  if (req.method === 'DELETE') {
    blogEntries.splice(index, 1);
    return noContent();
  }
  const body = req.json ?? {};
  entry.title = str(body.title, entry.title);
  entry.date = str(body.date, entry.date);
  entry.published = typeof body.published === 'boolean' ? body.published : entry.published;
  entry.content = str(body.content, entry.content);
  entry.etag = newEtag(`blog-${entry.id}`);
  return json({ etag: entry.etag });
});

/** Width and height from the SOF marker of a JPEG, if found. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

route(['PUT', 'PATCH'], '/api/intern/pflege/blog/:id/bilder', (req) => {
  const entry = blogEntries.find((e) => e.id === req.params.id);
  if (!entry) return notFound('Der Beitrag wurde nicht gefunden.');
  if (req.method === 'PATCH') {
    const raw = Array.isArray(req.json?.images) ? (req.json?.images as unknown[]) : [];
    const byFile = new Map(entry.images.map((i) => [i.file, i]));
    entry.images = raw.flatMap((value) => {
      const item = value as { file?: unknown; alt?: unknown };
      const image = byFile.get(str(item.file));
      return image ? [{ ...image, alt: str(item.alt, image.alt) }] : [];
    });
    entry.etag = newEtag(`blog-${entry.id}`);
    return json({ etag: entry.etag, images: entry.images });
  }
  if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
    return error(400, 'INVALID', 'Bitte ein Bild im JPEG-Format hochladen.');
  const size = jpegSize(req.raw) ?? { width: 1600, height: 1067 };
  const image = { file: `bild-${MOCK_NOW}.jpg`, alt: '', ...size };
  blogUploads.set(`${entry.id}/${image.file}`, new Uint8Array(req.raw));
  entry.images = [...entry.images, image];
  entry.etag = newEtag(`blog-${entry.id}`);
  return json({ etag: entry.etag, images: entry.images, image }, 201);
});

route(['GET', 'DELETE'], '/api/intern/pflege/blog/:id/bilder/:file', (req) => {
  if (req.method === 'GET')
    return blogImage(req.params.id, req.params.file, req.query.get('w'), false);
  const entry = blogEntries.find((e) => e.id === req.params.id);
  if (!entry || !entry.images.some((i) => i.file === req.params.file)) return notFound();
  entry.images = entry.images.filter((i) => i.file !== req.params.file);
  blogUploads.delete(`${entry.id}/${req.params.file}`);
  entry.etag = newEtag(`blog-${entry.id}`);
  return json({ etag: entry.etag, images: entry.images });
});

// ---------------------------------------------------------------------------------------------
// Sammelbestellungen

function isOpen(campaign: (typeof campaigns)[number]): boolean {
  const now = MOCK_NOW;
  return (
    !campaign.archived && Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt)
  );
}

function campaignById(id: unknown): (typeof campaigns)[number] | undefined {
  return campaigns.find((c) => c.id === id);
}

function orderById(id: unknown): (typeof orders)[number] | undefined {
  return orders.find((o) => o.id === id);
}

const INVALID_LINK = (): MockResult =>
  error(
    404,
    'INVALID_LINK',
    'Dieser Link ist ungültig. Bitte verwende den vollständigen Link aus deiner E-Mail.'
  );
const CLOSED = (): MockResult =>
  error(
    403,
    'CLOSED',
    'Der Bestellzeitraum ist geschlossen oder deine Bestellung wird bereits bearbeitet.'
  );
const SAMMEL_CONFLICT = (): MockResult =>
  error(
    409,
    'CONFLICT',
    'Die Bestellung wurde inzwischen geändert. Bitte neu laden und erneut versuchen.'
  );

function memberView(order: (typeof orders)[number]): MockResult {
  const campaign = campaignById(order.campaignId);
  if (!campaign) return INVALID_LINK();
  return json({ campaign, order, canEdit: isOpen(campaign) && order.status === 'Eingereicht' });
}

route('POST', '/api/sammelbestellungen/campaign', (req) => {
  const campaign = campaignById(req.json?.id);
  if (!campaign || !str(req.json?.token)) return INVALID_LINK();
  return isOpen(campaign) ? json(campaign) : CLOSED();
});

route('POST', '/api/sammelbestellungen/request-link', (req) => {
  const campaign = campaignById(req.json?.id);
  if (!campaign) return INVALID_LINK();
  if (!isOpen(campaign)) return CLOSED();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(req.json?.email)))
    return error(400, 'INVALID', 'Bitte gib eine gültige E-Mail-Adresse an.', {
      email: 'Bitte gib eine gültige E-Mail-Adresse an.',
    });
  return json({ sent: true });
});

route(['POST', 'PUT'], '/api/sammelbestellungen/order', (req) => {
  const order = orderById(req.json?.id);
  if (!order || !str(req.json?.token)) return INVALID_LINK();
  if (req.method === 'POST') return memberView(order);
  const campaign = campaignById(order.campaignId);
  if (!campaign || !isOpen(campaign) || order.status !== 'Eingereicht') return CLOSED();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const body = req.json ?? {};
  order.name = str(body.name, order.name);
  order.notes = str(body.notes, order.notes);
  if (Array.isArray(body.items)) order.items = body.items as typeof order.items;
  order.submitted = true;
  order.totalCents = null;
  order.paid = false;
  touchOrder(order);
  return json({ confirmationMailSent: true });
});

route('POST', '/api/sammelbestellungen/product', (req) => {
  const order = orderById(req.json?.id);
  if (!order) return INVALID_LINK();
  return json(productInfo(str(req.json?.reference)));
});

const SAMMEL_STAFF = '/api/intern/pflege/sammelbestellungen';

route(['GET', 'POST'], SAMMEL_STAFF, (req) => {
  if (req.method === 'GET') return json(campaigns);
  if (!str(req.json?.title).trim())
    return error(400, 'INVALID', 'Bitte gib einen Titel an.', {
      title: 'Bitte gib einen Titel an.',
    });
  return json({ id: createCampaign(req.json ?? {}).id }, 201);
});

route('POST', `${SAMMEL_STAFF}/product`, (req) => json(productInfo(str(req.json?.reference))));

route('PATCH', `${SAMMEL_STAFF}/orders/:id`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const body = req.json ?? {};
  const status = str(body.status, order.status);
  if (['Eingereicht', 'Bestellt', 'Eingetroffen', 'Storniert'].includes(status))
    order.status = status as typeof order.status;
  order.paid = body.paid === true;
  order.delivered = body.delivered === true;
  order.totalCents = typeof body.totalCents === 'number' ? body.totalCents : null;
  touchOrder(order);
  return noContent();
});

route('PATCH', `${SAMMEL_STAFF}/orders/:id/item`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const index = Number(req.json?.index);
  const item = order.items[index];
  if (!item)
    return error(400, 'INVALID', 'Bitte wähle einen Artikel.', {
      form: 'Bitte wähle einen Artikel.',
    });
  order.items = order.items.map((it, i) => {
    if (i !== index) return it;
    const rest = { ...it };
    delete rest.excluded;
    return req.json?.excluded === true
      ? { ...rest, excluded: { reason: str(req.json?.reason) } }
      : rest;
  });
  order.totalCents = null;
  order.paid = false;
  touchOrder(order);
  return json({ confirmationMailSent: true });
});

route('POST', `${SAMMEL_STAFF}/orders/:id/message`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== undefined && req.json.etag !== order.etag) return SAMMEL_CONFLICT();
  return noContent();
});

route('POST', `${SAMMEL_STAFF}/:id/invite`, (req) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return notFound();
  if (!isOpen(campaign))
    return error(
      400,
      'INVALID',
      'Nur aktuell offene Sammelbestellungen können freigegeben werden.',
      {
        form: 'Nur aktuell offene Sammelbestellungen können freigegeben werden.',
      }
    );
  const state = invitations.get(campaign.id);
  if (req.json?.action === 'preview') {
    const total = state?.total ?? 87;
    const sent = state?.sent ?? 0;
    return json({
      total,
      pending: total - sent,
      sent,
      uncertain: 0,
      started: !!state,
      version: String(state?.version ?? 0),
    });
  }
  const next = state ?? { total: 87, sent: 0, version: 0 };
  next.sent = Math.min(next.total, next.sent + 25);
  next.version++;
  invitations.set(campaign.id, next);
  return json({
    total: next.total,
    pending: next.total - next.sent,
    sent: next.sent,
    uncertain: next.sent === next.total ? 1 : 0,
    started: true,
    version: String(next.version),
  });
});

route(['GET', 'PATCH'], `${SAMMEL_STAFF}/:id`, (req) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return notFound();
  if (req.method === 'PATCH') {
    if (req.json?.etag !== campaign.etag) return SAMMEL_CONFLICT();
    if (typeof req.json?.archived === 'boolean') campaign.archived = req.json.archived;
    touchCampaign(campaign);
    return noContent();
  }
  return json({
    campaign,
    invitationUrl: `http://${req.headers.host ?? 'localhost:4321'}/mitgliederbereich/sammelbestellungen#kind=campaign&id=${campaign.id}&token=mock`,
    orders: orders.filter((o) => o.campaignId === campaign.id),
  });
});

// ---------------------------------------------------------------------------------------------
// Middleware

async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const raw = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
  const request: MockRequest = {
    method: (req.method ?? 'GET').toUpperCase(),
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    params: {},
    headers: req.headers,
    raw,
    json: parseJson(raw, req.headers['content-type']),
  };

  if (request.path.startsWith('/.auth/')) {
    handleAuth(request, res);
    return;
  }

  const method = request.method === 'HEAD' ? 'GET' : request.method;
  let pathMatched = false;
  for (const candidate of routes) {
    const match = candidate.pattern.exec(request.path);
    if (!match) continue;
    pathMatched = true;
    if (!candidate.methods.includes(method)) continue;
    candidate.keys.forEach((key, i) => (request.params[key] = decodeURIComponent(match[i + 1])));

    if (!candidate.instant) await wait(method === 'GET' ? READ_DELAY_MS : WRITE_DELAY_MS);
    const denied = request.path.startsWith('/api/intern/') ? requireLogin(request) : null;
    send(res, denied ?? candidate.handler(request));
    return;
  }

  if (pathMatched) {
    send(res, error(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.'));
    return;
  }
  console.warn(`[mock-api] No mock for ${request.method} ${request.path}`);
  send(res, error(404, 'NOT_FOUND', `Kein Mock für ${request.method} ${request.path}.`));
}

/** Connect middleware serving the mock API for `/api/*` and `/.auth/*`. */
export function mockApiMiddleware(): Connect.NextHandleFunction {
  console.info('[mock-api] Serving /api/* and /.auth/* with test data (MOCK_API=1).');
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/.auth/')) {
      next();
      return;
    }
    handle(req, res, url).catch((caught: unknown) => {
      console.error('[mock-api] Handler failed', caught);
      if (!res.headersSent) send(res, error(500, 'MOCK_ERROR', 'Fehler in der Mock-API.'));
      else res.end();
    });
  };
}
