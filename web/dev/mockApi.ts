import { emptySession, parseSession } from '../../api/lib/abrechnung-session';
import type { AbrechnungEingabe } from '../../api/lib/abrechnung-session';
import { validateTask, validateTemplate } from '../../api/lib/aufgaben-validation';
import {
  ValidationError,
  validateStaffFavorites,
  validateChangelogSeen,
  validateStaffRecentVisit,
  validatePerson,
  validateStaffSettings,
} from '../../api/lib/pflege-validation';
/**
 * Local mock of the Azure Functions API and the Static Web Apps auth endpoints, so every page
 * renders with realistic test data without a backend: `MOCK_API=1 bun run dev`.
 *
 * Handles `/api/*` and `/.auth/*`; everything else goes to Astro. Writes succeed after a short
 * delay (to make loading states visible) and are kept in memory until the dev server restarts.
 * Unknown API paths answer 404 and are logged, so gaps are easy to spot.
 */
import { randomBytes } from 'node:crypto';
import { taggedTaskAssignee, taskPeople } from '../../api/lib/aufgaben-zuordnung';
import type {
  OffeneAufgabeQuelle,
  ProtokollEditorAufgaben,
} from '../../api/lib/protokoll-editor-model';
import { einzeilig } from '../../api/lib/protokoll-editor-model';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type {
  ClientPrincipal,
  TasksOverview,
  ProtokollTermin,
  StaffBeleg,
  TransferredBeleg,
  StaffNikolausDispoRow,
  StaffNikolausEinteilungRow,
  StaffProtokoll,
} from '../src/lib/types';
import { abrechnungFor, belegBildFor, kjrListeFor, kostenstellen } from './mock-data/abrechnung';
import { beitraegeFor } from './mock-data/beitraege';
import { aktionBeitraegeFor, campflowDetail, campflowEvents } from './mock-data/campflow';
import {
  MOCK_LEITENDE,
  addPerson,
  deletePerson,
  mockIch,
  mockPersonen,
  mockEigeneAnmeldungen,
  mockMitEigenerAdresse,
  personenUebersicht,
  resetPersonen,
  updatePerson,
} from './mock-data/personen';
import {
  aktionen,
  blogEntries,
  blogUploads,
  buildIcs,
  calendarAktionen,
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
import type { MockAktion } from './mock-data/content';
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
import {
  createEditorProtokoll,
  mockAufgabenHooks,
  deleteEditorProtokoll,
  editorDetail,
  editorLive,
  editorOverview,
  editorRevision,
  editorPdfName,
  editorRevisions,
  releaseEditorSperre,
  reviewEditorProtokoll,
  saveEditorProtokoll,
  takeEditorSperre,
  versandEditorProtokoll,
  MOCK_VERSAND_LIST,
  mockVersandCount,
} from './mock-data/protokollEditor';
import type { ReviewResult } from './mock-data/protokollEditor';
import { validateKontaktMessage } from '../src/lib/kontaktConfig';
import {
  mockFotoContent,
  mockFotoDetail,
  mockFotoEnsure,
  mockFotoFolder,
  mockFotoPreview,
  mockFotoUploadPart,
  mockFotoUploadSession,
  mockFotoUploadStatus,
} from './mock-data/fotos';
import { aktionFotoPath, cleanName, splitFotoPath } from '../../api/lib/foto-pfade';
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
  MOCK_NIKOLAUS_SETTINGS,
  deleteSteuerungData,
  saveSteuerung,
  steuerungEtag,
  steuerungView,
} from './mock-data/nikolaus';
import { toNikolausConfig } from '../src/lib/nikolausConfig';
import type { NikolausSettings } from '../src/lib/nikolausConfig';
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

route('GET', '/api/karte-quelle/:style/:z', () => json({ copyrights: ['©2026 TomTom'] }), true);

// Map tiles: a plain grid with the tile's coordinates instead of Azure Maps
route(
  'GET',
  '/api/karte/:style/:z/:x/:y',
  (req) => {
    const dark = req.params.style === 'dunkel';
    const label = `${req.params.z}/${req.params.x}/${req.params.y.replace(/\.png$/, '')}`;
    return svg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${dark ? '#1c2630' : '#eef1ea'}" stroke="${dark ? '#33414f' : '#cfd6cc'}"/><text x="8" y="20" font-family="sans-serif" font-size="11" fill="${dark ? '#8796a5' : '#7b8577'}">${label}</text></svg>`
    );
  },
  true
);

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
    body: buildIcs(
      calendarAktionen().filter((a) => a.stufen.length === 1 && a.stufen[0] === 'Leitende'),
      'DPSG Stamm Phoenix - Leitende'
    ),
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
    if (!file?.hasPreview) return notFound();
    if (file.preview)
      return { kind: 'raw', status: 200, contentType: 'image/jpeg', body: file.preview };
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
        : `Testdatei der Mock-API: ${file.fileName}\nIm echten Betrieb kommt hier die hochgeladene Datei.\n`,
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

route('GET', '/api/nikolaus/settings', () => json(toNikolausConfig(MOCK_NIKOLAUS_SETTINGS)));

route('GET', '/api/nikolaus/slots', () => json(publicSlots()));

route('POST', '/api/nikolaus/bookings', (req) => {
  const body = req.json ?? {};
  if (str(body.website)) return json({ status: 'pending' }, 201);
  if (typeof body.altcha !== 'string') return CAPTCHA_FAILED();
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

route('POST', '/api/nikolaus/manage/resend-link', (req) =>
  typeof req.json?.altcha === 'string'
    ? json({ status: 'sent', cooldownMinutes: 15 })
    : CAPTCHA_FAILED()
);

// ---------------------------------------------------------------------------------------------
// ALTCHA (Kontakt, Nikolaus booking, Sammelbestellung link request)

const CAPTCHA_FAILED = (): MockResult =>
  error(403, 'CAPTCHA_FAILED', 'Die Prüfung, ob du ein Mensch bist, ist fehlgeschlagen.');

// Unsigned SHA-256 challenge: solved in a few milliseconds; the mock accepts any payload.
route(
  'GET',
  '/api/altcha/challenge',
  () =>
    json({
      parameters: {
        algorithm: 'SHA-256',
        nonce: randomBytes(16).toString('hex'),
        salt: randomBytes(16).toString('hex'),
        cost: 1,
        keyLength: 32,
        keyPrefix: '00',
      },
    }),
  true
);

// ---------------------------------------------------------------------------------------------
// Kontakt

route('POST', '/api/kontakt', (req) => {
  const { message, errors } = validateKontaktMessage(req.json ?? {});
  if (!message)
    return error(
      400,
      'VALIDATION_FAILED',
      'Bitte prüf deine Angaben.',
      errors as Record<string, string>
    );
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  return json({ status: 'sent', receipt: true });
});

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

// ---------------------------------------------------------------------------------------------
// CampFlow (Leitendenbereich → Aktionen)

route('GET', '/api/intern/aktionen', () => json(campflowEvents));
route('GET', '/api/intern/aktionen/:id', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const detail = campflowDetail(req.params.id);
  return detail
    ? json({ ...detail, ich: mockEigeneAnmeldungen(detail.persons) })
    : notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
});

route('GET', '/api/intern/aktionen/:id/beitraege', (req) => {
  const beitraege = aktionBeitraegeFor(req.params.id, req.query.get('refresh') === 'true');
  return beitraege ? json(beitraege) : notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
});

/** The KJR choice per event, kept while it is marked as no Aktion (like the database). */
const zuschussGewaehlt = new Map<string, boolean>();

route('PUT', '/api/intern/pflege/aktionen-zuschuss/:id', (req) => {
  const event = campflowEvents.find((e) => e.id === req.params.id);
  if (!event) return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  const zuschussfaehig = req.json?.zuschussfaehig;
  if (typeof zuschussfaehig !== 'boolean') {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.');
  }
  zuschussGewaehlt.set(event.id, zuschussfaehig);
  event.zuschussfaehig = zuschussfaehig && !event.keineAktion;
  return json({ zuschussfaehig: event.zuschussfaehig });
});

route('PUT', '/api/intern/pflege/aktionen-art/:id', (req) => {
  const event = campflowEvents.find((e) => e.id === req.params.id);
  if (!event) return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  const keineAktion = req.json?.keineAktion;
  if (typeof keineAktion !== 'boolean') {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.');
  }
  event.keineAktion = keineAktion;
  event.zuschussfaehig = !keineAktion && (zuschussGewaehlt.get(event.id) ?? true);
  return json({ keineAktion, zuschussfaehig: event.zuschussfaehig });
});

// Beiträge: read from CampFlow by the Playwright API in production
route('GET', '/api/intern/beitraege', (req) =>
  json(beitraegeFor(req.query.get('refresh') === 'true'))
);

// Abrechnung: Einzelnachweise come from the Playwright API in production
const abrechnungDrafts = new Map<string, AbrechnungEingabe>();
route('GET', '/api/intern/abrechnung/:id/eingaben', (req) =>
  json(
    abrechnungDrafts.get(req.params.id) ?? {
      session: emptySession(),
      etag: null,
      savedAt: null,
      deleteAfter: null,
    }
  )
);
route('PUT', '/api/intern/abrechnung/:id/eingaben', (req) => {
  const body = req.json as { session: unknown; etag: string | null };
  const previous = abrechnungDrafts.get(req.params.id);
  if ((previous?.etag ?? null) !== body.etag)
    return json(
      { code: 'CONFLICT', message: 'Die Eingaben wurden auf einem anderen Gerät geändert.' },
      409
    );
  const saved: AbrechnungEingabe = {
    session: parseSession(body.session),
    etag: String(Number(previous?.etag ?? 0) + 1),
    savedAt: new Date().toISOString(),
    deleteAfter: '2026-12-11',
  };
  abrechnungDrafts.set(req.params.id, saved);
  return json(saved);
});
route('GET', '/api/intern/abrechnung/kostenstellen', () => json(kostenstellen));
route(
  'GET',
  '/api/intern/abrechnung/belege/:nummer/bild',
  (req) => {
    const page = Number(req.query.get('page') ?? '1');
    if (!Number.isInteger(page) || page < 1) return error(400, 'INVALID_PAGE', 'Ungültige Seite.');
    const result = belegBildFor(req.params.nummer, page);
    if (result === 'NOT_FOUND') {
      return error(
        404,
        'BELEG_NOT_FOUND',
        `Den Beleg ${req.params.nummer} gibt es in CampFlow nicht.`
      );
    }
    return {
      kind: 'raw',
      status: 200,
      contentType: 'image/png',
      body: result.png,
      headers: { 'x-campflow-pages': String(result.pages) },
    };
  },
  true
);
route('POST', '/api/intern/abrechnung/:id/kjr-liste', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const result = kjrListeFor(req.params.id, req.json);
  if (result === 'NOT_FOUND') return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  if (result === 'OHNE_ZUSCHUSS') {
    return error(
      409,
      'OHNE_ZUSCHUSS',
      'Für diese Aktion wird kein KJR-Zuschuss beantragt, deshalb gibt es keine Teilnahmeliste für den KJR.'
    );
  }
  if ('error' in result) {
    return error(
      result.status,
      result.status === 422 ? 'TOO_MANY_PERSONS' : 'INVALID_INPUT',
      result.error
    );
  }
  return {
    kind: 'raw',
    status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: result.file,
    headers: {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    },
  };
});
route('GET', '/api/intern/abrechnung/:id', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const requested = req.query.get('kostenstelle') ?? '';
  const result = abrechnungFor(
    req.params.id,
    requested.trim(),
    req.query.get('refresh') === 'true'
  );
  if (result === 'NOT_FOUND') return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  if (result === 'KOSTENSTELLE_NOT_FOUND') {
    const name = requested.trim() || campflowDetail(req.params.id)?.event.title;
    return error(
      404,
      'KOSTENSTELLE_NOT_FOUND',
      `Die Kostenstelle „${name}“ gibt es in CampFlow nicht.`
    );
  }
  return json({
    ...result,
    ich: mockEigeneAnmeldungen(campflowDetail(req.params.id)?.persons ?? []),
  });
});

// ---------------------------------------------------------------------------------------------
// Protokolle (Leitendenbereich → Protokolle)

function mockProtokoll(
  id: string,
  date: string,
  title: string,
  values: Partial<StaffProtokoll>
): StaffProtokoll {
  return {
    id,
    etag: newEtag(`protokoll-${id}`),
    fileName: `${date} ${title}.docx`,
    title,
    date,
    status: 'Entwurf',
    webUrl: `https://example.sharepoint.com/sites/leitende/Protokolle/${encodeURIComponent(`${date} ${title}.docx`)}`,
    createdBy: 'kim.beispiel@example.test',
    lastModifiedAt: isoFromNow(-2),
    lastModifiedBy: 'Kim Beispiel',
    reviewNote: '',
    approvedBy: '',
    approvedAt: '',
    changedSinceApproval: false,
    delivery: null,
    termin: null,
    terminStale: false,
    ...values,
  };
}

function mockTermin(values: Partial<ProtokollTermin>): ProtokollTermin {
  return {
    sourceVersion: 'mock-1',
    extraction: 'gefunden',
    suggestion: { date: null, time: null, place: null, quote: null },
    decision: 'offen',
    confirmed: null,
    decidedBy: '',
    decidedAt: '',
    extractedAt: isoFromNow(-2),
    ...values,
  };
}

/** Approved minutes in the demo, one per state of „Nächste Leitendenrunde“. */
function approvedProtokoll(
  id: string,
  daysAgo: number,
  title: string,
  values: Partial<StaffProtokoll>
): StaffProtokoll {
  return mockProtokoll(id, dayFromToday(-daysAgo), title, {
    status: 'Freigegeben',
    approvedBy: 'stavo@example.test',
    approvedAt: isoFromNow(-1),
    ...values,
  });
}

const protokolle: StaffProtokoll[] = [
  mockProtokoll('prot-1', dayFromToday(-1), 'Leitendenrunde', { status: 'Review' }),
  mockProtokoll('prot-2', dayFromToday(-8), 'Stavo-Sitzung', {
    status: 'Entwurf',
    createdBy: PRINCIPAL.userDetails,
    reviewNote: 'Bitte noch die Termine für das Sommerlager ergänzen.',
  }),
  mockProtokoll('prot-3', dayFromToday(-29), 'Leitendenrunde', {
    status: 'Verschickt',
    approvedBy: 'stavo@example.test',
    approvedAt: isoFromNow(-27),
    delivery: { state: 'sent', recipients: 23, at: isoFromNow(-27), by: 'stavo@example.test' },
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(-1),
        time: '19:30',
        place: 'Pfarrheim',
        quote: 'Nächste LR am Dienstag um 19:30 im Pfarrheim.',
      },
      decision: 'bestaetigt',
      confirmed: { date: dayFromToday(-1), time: '19:30', place: 'Pfarrheim' },
      decidedBy: 'stavo@example.test',
      decidedAt: isoFromNow(-27),
    }),
  }),
  approvedProtokoll('prot-5', 2, 'Leitendenrunde', {
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(26),
        time: '19:30',
        place: 'Pfarrheim St. Georg',
        quote:
          'Die nächste Leitendenrunde findet am Dienstag in vier Wochen um 19:30 Uhr im Pfarrheim St. Georg statt.',
      },
    }),
  }),
  approvedProtokoll('prot-6', 3, 'Stavo-Sitzung', {
    termin: mockTermin({
      extraction: 'unklar',
      suggestion: {
        date: dayFromToday(30),
        time: null,
        place: null,
        quote: 'Nächstes Treffen voraussichtlich Anfang nächsten Monats, Termin folgt per Mail.',
      },
    }),
  }),
  approvedProtokoll('prot-7', 4, 'Leitendenrunde Sommerlager', {
    termin: mockTermin({ extraction: 'fehler' }),
  }),
  approvedProtokoll('prot-8', 5, 'Leitendenrunde', {
    status: 'Verschickt',
    delivery: { state: 'sent', recipients: 23, at: isoFromNow(-3), by: 'stavo@example.test' },
    termin: mockTermin({
      extraction: 'nicht gefunden',
      decision: 'abgelehnt',
      decidedBy: 'stavo@example.test',
      decidedAt: isoFromNow(-3),
    }),
  }),
  approvedProtokoll('prot-9', 6, 'Klausur', {
    changedSinceApproval: true,
    terminStale: true,
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(12),
        time: '18:00',
        place: 'Zeltplatz',
        quote: 'Nächste LR: Freitag, 18 Uhr am Zeltplatz.',
      },
    }),
  }),
  approvedProtokoll('prot-10', 7, 'Leitendenrunde', {
    termin: mockTermin({ extraction: 'nicht gefunden' }),
  }),
  approvedProtokoll('prot-11', 9, 'Leitendenrunde', {
    termin: mockTermin({ extraction: 'nicht eingerichtet' }),
  }),
  mockProtokoll('prot-4', '2025-09-16', 'Protokoll LR', {
    status: 'Archiv',
    fileName: 'Protokoll LR 16.09.25.docx',
    createdBy: '',
    lastModifiedAt: '2025-09-17T19:30:00Z',
  }),
];
const initialProtokolle = structuredClone(protokolle);
/** Back to the demo minutes, for tests that need them as they were (e.g. not sent yet). */
route('POST', '/api/__mock/protokolle/reset', () => {
  protokolle.splice(0, protokolle.length, ...structuredClone(initialProtokolle));
  return noContent();
});

// Shared tasks; proposals remain separate until a leader accepts them.
const taskData: TasksOverview = {
  login: PRINCIPAL.userDetails,
  extractionConfigured: true,
  projects: [{ id: 1, etag: newEtag(newId()), title: 'Herbstlager', campflowId: '' }],
  templates: [
    {
      id: 1,
      etag: newEtag(newId()),
      title: 'Lager vorbereiten',
      items: [
        { title: 'Zelte prüfen', description: 'Material durchsehen.', assignee: '', daysBefore: 7 },
        { title: 'Einkauf planen', description: '', assignee: '', daysBefore: 3 },
      ],
    },
  ],
  tasks: [
    {
      id: 1,
      etag: newEtag(newId()),
      title: 'Küche vorbereiten',
      description: 'Speiseplan abstimmen.',
      assignee: PRINCIPAL.userDetails,
      dueDate: '2026-10-12',
      projectId: 1,
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
    },
  ],
};
const initialTaskData = structuredClone(taskData);
let nextTaskId = 2;
const appliedTaskTemplates = new Set<string>();
const recognizedTaskProtocols = new Set<string>();
const TASK_BASE = '/api/intern/pflege/aufgaben';
route('POST', '/api/__mock/aufgaben/reset', () => {
  staffFavorites = null;
  Object.assign(taskData, structuredClone(initialTaskData));
  nextTaskId = 2;
  appliedTaskTemplates.clear();
  recognizedTaskProtocols.clear();
  return noContent();
});
route('GET', `${TASK_BASE}/benutzer`, () =>
  json({
    users: [
      { name: 'Demo Leitung', login: PRINCIPAL.userDetails },
      { name: 'Alex Beispiel', login: 'alex@example.test' },
      { name: 'Bea Beispiel', login: 'bea@example.test' },
    ],
    unavailable: false,
  })
);
const TASK_CONFLICT = (): MockResult =>
  error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
route(['GET', 'POST'], TASK_BASE, (req) => {
  if (req.method === 'GET') return json(taskData);
  taskData.tasks.push({
    id: nextTaskId++,
    etag: newEtag(newId()),
    ...validateTask(req.json),
    state: 'offen',
    sourceId: '',
    sourceVersion: '',
    quote: '',
  });
  return noContent();
});
route(['PUT', 'DELETE'], `${TASK_BASE}/:id`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if ((req.method === 'DELETE' ? req.headers['if-match'] : req.json?.etag) !== task.etag)
    return TASK_CONFLICT();
  if (req.method === 'PUT' && typeof req.json?.done !== 'boolean')
    throw new ValidationError({ done: 'Bitte den Erledigt-Status angeben.' });
  if (req.method === 'DELETE') taskData.tasks = taskData.tasks.filter((t) => t.id !== task.id);
  else
    Object.assign(task, {
      ...validateTask(req.json),
      state: req.json?.done ? 'erledigt' : 'offen',
      etag: newEtag(newId()),
    });
  return req.method === 'PUT' ? json(task) : noContent();
});
route('DELETE', `${TASK_BASE}/projekte/:id`, (req) => {
  const id = Number(req.params.id);
  const project = taskData.projects.find((p) => p.id === id);
  if (!project || project.etag !== req.headers['if-match']) return TASK_CONFLICT();
  taskData.projects = taskData.projects.filter((p) => p.id !== id);
  for (const task of taskData.tasks)
    if (task.projectId === id) {
      task.projectId = null;
      task.etag = newEtag(newId());
    }
  for (const key of appliedTaskTemplates)
    if (key.startsWith(`${id}:`)) appliedTaskTemplates.delete(key);
  return noContent();
});
for (const kind of ['projekte', 'vorlagen']) {
  const handler: Handler = (req) => {
    const collection = kind === 'projekte' ? taskData.projects : taskData.templates;
    const current = collection.find((p) => p.id === Number(req.params.id));
    if (req.method === 'PUT' && (!current || current.etag !== req.json?.etag))
      return TASK_CONFLICT();
    const common = {
      id: current?.id ?? Math.max(0, ...collection.map((p) => p.id)) + 1,
      etag: newEtag(newId()),
      title: str(req.json?.title),
    };
    if (kind === 'projekte') {
      const value = { ...common, campflowId: str(req.json?.campflowId) };
      if (current) Object.assign(current, value);
      else taskData.projects.push(value);
    } else {
      const value = {
        ...common,
        ...validateTemplate(req.json),
      };
      if (current) Object.assign(current, value);
      else taskData.templates.push(value);
    }
    return noContent();
  };
  route('POST', `${TASK_BASE}/${kind}`, handler);
  route('PUT', `${TASK_BASE}/${kind}/:id`, handler);
}
route('POST', `${TASK_BASE}/checkliste`, (req) => {
  const template = taskData.templates.find((t) => t.id === req.json?.templateId);
  if (!template || template.etag !== req.json?.etag) return TASK_CONFLICT();
  const key = `${req.json?.projectId}:${template.id}`;
  if (appliedTaskTemplates.has(key)) return json({ count: 0 });
  appliedTaskTemplates.add(key);
  for (const item of template.items) {
    const date = new Date(`${str(req.json?.date)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - item.daysBefore);
    taskData.tasks.push({
      ...item,
      id: nextTaskId++,
      etag: newEtag(newId()),
      dueDate: date.toISOString().slice(0, 10),
      projectId: Number(req.json?.projectId),
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
    });
  }
  return json({ count: template.items.length });
});
route('POST', `${TASK_BASE}/protokolle/:id/erkennen`, (req) => {
  const protocol = protokolle.find((p) => p.id === req.params.id);
  if (!protocol) return notFound();
  if (protocol.etag !== req.json?.etag || protocol.changedSinceApproval) return TASK_CONFLICT();
  if (recognizedTaskProtocols.has(protocol.id)) return json({ count: 0 });
  recognizedTaskProtocols.add(protocol.id);
  taskData.tasks.push({
    id: nextTaskId++,
    etag: newEtag(newId()),
    title: 'Lagerküche planen',
    description: 'Plan für das Lager erstellen.',
    assignee: 'Alex',
    dueDate: null,
    projectId: null,
    state: 'vorschlag',
    sourceId: protocol.id,
    sourceVersion: 'mock-content-v1',
    quote: 'Alex plant die Lagerküche für die Winteraktion.',
    suggestedProjectTitle: 'Winteraktion',
  });
  return json({ count: 1 });
});
route('POST', `${TASK_BASE}/:id/zuordnung`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if (task.etag !== req.json?.etag || task.state !== 'vorschlag') return TASK_CONFLICT();
  return json({
    assignee:
      taggedTaskAssignee(task, [
        { name: 'Demo Leitung', login: PRINCIPAL.userDetails },
        { name: 'Alex', login: 'alex@example.test' },
      ]) ?? null,
    unavailable: false,
  });
});
route('POST', `${TASK_BASE}/:id/entscheidung`, (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task) return notFound();
  if (task.etag !== req.json?.etag || task.state !== 'vorschlag') return TASK_CONFLICT();
  if (req.json?.action === 'annehmen') {
    const input = validateTask(req.json);
    let projectId = req.json?.projectId ?? null;
    const title = str(req.json?.newProjectTitle).trim();
    if (title && task.suggestedProjectTitle) {
      let project = taskData.projects.find(
        (p) => p.title.toLocaleLowerCase('de') === title.toLocaleLowerCase('de')
      );
      if (!project) {
        project = {
          id: Math.max(0, ...taskData.projects.map((p) => p.id)) + 1,
          title,
          campflowId: '',
          etag: newEtag(newId()),
        };
        taskData.projects.push(project);
      }
      projectId = project.id;
    }
    Object.assign(task, {
      ...input,
      projectId,
      suggestedProjectTitle: '',
      state: 'offen',
      etag: newEtag(newId()),
    });
  } else Object.assign(task, { state: 'abgelehnt', etag: newEtag(newId()) });
  return noContent();
});

route(['GET', 'POST'], '/api/intern/pflege/protokolle', (req) => {
  if (req.method === 'GET') {
    return json({
      configured: true,
      defaultTitle: 'Leitendenrunde',
      sendingConfigured: true,
      terminConfigured: true,
      login: PRINCIPAL.userDetails,
      items: protokolle,
    });
  }
  const title = str(req.json?.title).trim();
  const date = str(req.json?.date);
  const fields: Record<string, string> = {};
  if (!title || /["*:<>?/\\|#%]/.test(title)) fields.title = 'Bitte einen gültigen Titel angeben.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte das Datum der Sitzung angeben.';
  if (Object.keys(fields).length > 0) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
  }
  if (protokolle.some((p) => p.fileName === `${date} ${title}.docx`)) {
    return error(409, 'EXISTS', 'Für diesen Tag gibt es schon ein Protokoll mit diesem Titel.');
  }
  const created = mockProtokoll(newId(), date, title, {
    createdBy: PRINCIPAL.userDetails,
    lastModifiedAt: new Date(MOCK_NOW).toISOString(),
    lastModifiedBy: 'Demo Leitung',
  });
  protokolle.unshift(created);
  return json({ id: created.id, webUrl: created.webUrl }, 201);
});

route(['POST', 'DELETE'], '/api/intern/pflege/protokolle/:id', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (req.method === 'DELETE') {
    if (protokoll.status === 'Verschickt' || protokoll.status === 'Archiv') {
      return error(400, 'INVALID', 'Verschickte und archivierte Protokolle bleiben erhalten.');
    }
    protokolle.splice(protokolle.indexOf(protokoll), 1);
    return noContent();
  }
  if (str(req.json?.etag) !== protokoll.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  const action = str(req.json?.action);
  const note = str(req.json?.note).trim();
  if (action === 'review' && protokoll.status === 'Entwurf') {
    Object.assign(protokoll, { status: 'Review', reviewNote: '' });
  } else if (
    action === 'approve' &&
    (protokoll.status === 'Entwurf' || protokoll.status === 'Review')
  ) {
    if (protokoll.createdBy === PRINCIPAL.userDetails && req.json?.ownConfirmed !== true) {
      return error(
        400,
        'INVALID',
        'Bestätige bitte, dass du dein eigenes Protokoll ohne zweite Person freigibst.'
      );
    }
    Object.assign(protokoll, {
      status: 'Freigegeben',
      reviewNote: '',
      approvedBy: PRINCIPAL.userDetails,
      approvedAt: new Date(MOCK_NOW).toISOString(),
      terminStale: false,
      termin: mockTermin({
        suggestion: {
          date: dayFromToday(27),
          time: '20:00',
          place: 'Pfarrheim',
          quote: 'Nächste Leitendenrunde: in vier Wochen, 20 Uhr, Pfarrheim.',
        },
      }),
    });
  } else if (action === 'reject' && protokoll.status === 'Review') {
    if (!note) {
      return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
        note: 'Bitte kurz schreiben, was noch fehlt.',
      });
    }
    Object.assign(protokoll, { status: 'Entwurf', reviewNote: note });
  } else if (action === 'reopen' && protokoll.status === 'Freigegeben') {
    Object.assign(protokoll, { status: 'Entwurf', approvedBy: '', approvedAt: '' });
  } else {
    return error(400, 'INVALID', 'Das geht in diesem Status nicht.');
  }
  protokoll.etag = newEtag(`protokoll-${protokoll.id}`);
  // The demo pretends the mail to the author was sent
  return json({ mailSent: action === 'reject' });
});

route(
  'GET',
  '/api/intern/pflege/protokolle/:id/pdf',
  (req) => {
    const protokoll = protokolle.find((p) => p.id === req.params.id);
    if (!protokoll) return notFound();
    const fileName = protokoll.fileName.replace(/\.docx$/, '.pdf');
    return {
      kind: 'raw',
      status: 200,
      contentType: 'application/pdf',
      body: minimalPdf(fileName),
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    };
  },
  true
);

route('GET', '/api/intern/pflege/protokolle/:id/vorschau', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  return json({ url: `/api/intern/pflege/protokolle/${protokoll.id}/vorschau-demo` });
});

route(
  'GET',
  '/api/intern/pflege/protokolle/:id/vorschau-demo',
  (req) => {
    const protokoll = protokolle.find((p) => p.id === req.params.id);
    if (!protokoll) return notFound();
    const title = protokoll.title.replace(/[<>&"]/g, '');
    return {
      kind: 'raw',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem;color:#14202c"><h1>${title}</h1><p>Im echten Betrieb zeigt SharePoint hier das Word-Dokument (nur lesen).</p></body>`,
    };
  },
  true
);

route('POST', '/api/intern/pflege/protokolle/:id/termin', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (!['Freigegeben', 'Verschickt', 'Archiv'].includes(protokoll.status)) {
    return error(400, 'INVALID', 'Nur freigegebene Protokolle haben einen nächsten Termin.');
  }
  if (str(req.json?.etag) !== protokoll.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  const action = str(req.json?.action);
  const now = new Date(MOCK_NOW).toISOString();
  if (protokoll.changedSinceApproval || (action !== 'erkennen' && protokoll.terminStale)) {
    return error(400, 'INVALID', 'Der Termin kann gerade nicht festgelegt werden.');
  }
  const termin =
    protokoll.termin ?? mockTermin({ extraction: 'nicht ausgefuehrt', extractedAt: '' });
  if (action === 'erkennen') {
    protokoll.terminStale = false;
    protokoll.termin = mockTermin({
      extractedAt: now,
      suggestion: {
        date: dayFromToday(21),
        time: '19:30',
        place: 'Pfarrheim',
        quote: 'Nächste Leitendenrunde in drei Wochen, 19:30 Uhr im Pfarrheim.',
      },
    });
  } else if (action === 'bestaetigen') {
    const date = str(req.json?.date);
    const time = str(req.json?.time);
    const place = str(req.json?.place).trim();
    const fields: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte ein Datum angeben.';
    if (time && !/^\d{2}:\d{2}$/.test(time)) fields.time = 'Bitte die Uhrzeit als HH:MM angeben.';
    if (place.length > 120) fields.place = 'Der Ort darf höchstens 120 Zeichen lang sein.';
    if (Object.keys(fields).length > 0) {
      return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
    }
    protokoll.termin = {
      ...termin,
      decision: 'bestaetigt',
      confirmed: { date, time: time || null, place: place || null },
      decidedBy: PRINCIPAL.userDetails,
      decidedAt: now,
    };
  } else if (action === 'ablehnen') {
    protokoll.termin = {
      ...termin,
      decision: 'abgelehnt',
      confirmed: null,
      decidedBy: PRINCIPAL.userDetails,
      decidedAt: now,
    };
  } else {
    return error(400, 'INVALID', 'Unbekannte Aktion.');
  }
  protokoll.etag = newEtag(`protokoll-${protokoll.id}`);
  return json({ termin: protokoll.termin });
});

route('POST', '/api/intern/pflege/protokolle/:id/versand', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (protokoll.status !== 'Freigegeben') {
    return error(400, 'INVALID', 'Nur freigegebene Protokolle können verschickt werden.');
  }
  if (str(req.json?.action) === 'preview') {
    return json({
      recipients: MOCK_VERSAND_LIST.length,
      version: 'mock',
      list: mockMitEigenerAdresse(MOCK_VERSAND_LIST),
    });
  }
  const recipients = mockVersandCount(strings(req.json?.excluded), strings(req.json?.extra));
  if (recipients === 0) return error(400, 'INVALID', 'Es ist niemand ausgewählt.');
  Object.assign(protokoll, {
    status: 'Verschickt',
    etag: newEtag(`protokoll-${protokoll.id}`),
    delivery: {
      state: 'sent',
      recipients,
      at: new Date(MOCK_NOW).toISOString(),
      by: PRINCIPAL.userDetails,
    },
  });
  return json({ recipients });
});

// Pflege: FAQ, Gruppenstunden, Leitende, Downloads, Blog

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

// --- Protokoll-Editor ---

const EDITOR_LOCKED = (sperre: { name: string }): MockResult =>
  json(
    {
      error: 'LOCKED',
      code: 'LOCKED',
      message: `Das Protokoll wird gerade von ${sperre.name} geschrieben.`,
      sperre,
    },
    423
  );

/** The token of the editor tab, sent in a header by reads. */
function tabToken(req: MockRequest): string | null {
  const value = req.headers['x-protokoll-tab'];
  return typeof value === 'string' && value ? value : null;
}

route('GET', '/api/intern/protokoll-editor', () => json(editorOverview()));

route('GET', '/api/intern/protokoll-editor-personen', () =>
  json({
    personen: [
      ...MOCK_LEITENDE.map((person) => ({ ...person, gruppe: 'leitende' })),
      ...mockPersonen()
        .filter((person) => person.aktiv && person.gruppe !== 'leitende')
        .sort((a, b) => (a.gruppe === b.gruppe ? 0 : a.gruppe === 'altleitende' ? -1 : 1))
        .map(({ name, login, gruppe }) => ({ name, login, gruppe })),
    ],
    unavailable: false,
  })
);

/** Favorites of the start page; `null` until the demo account saves some, like a new account. */
let staffFavorites: string[] | null = null;
let staffSettings: Record<string, unknown> = {};
route(['GET', 'PUT'], '/api/intern/einstellungen', (req) => {
  if (req.method === 'GET') return json({ settings: staffSettings });
  staffSettings = { ...staffSettings, ...validateStaffSettings(req.json) };
  return json({ settings: staffSettings });
});
route('POST', '/api/__mock/einstellungen/reset', () => {
  staffSettings = {};
  return noContent();
});

/** Recently opened areas of the demo account, the latest first. */
let staffRecent: string[] = [];
route(['GET', 'POST'], '/api/intern/zuletzt', (req) => {
  if (req.method === 'GET') return json({ modules: staffRecent });
  const module = validateStaffRecentVisit(req.json);
  staffRecent = [module, ...staffRecent.filter((entry) => entry !== module)].slice(0, 8); // MAX_RECENT of the API
  return json({ modules: staffRecent });
});
route('POST', '/api/__mock/zuletzt/reset', () => {
  staffRecent = [];
  return noContent();
});

/** Newest changelog entry the demo account has seen; `null` until the changelog is opened. */
let changelogSeen: string | null = null;
route(['GET', 'PUT'], '/api/intern/neuigkeiten', (req) => {
  if (req.method === 'GET') return json({ lastSeenId: changelogSeen });
  const id = validateChangelogSeen(req.json);
  if (changelogSeen === null || id > changelogSeen) changelogSeen = id;
  return json({ lastSeenId: changelogSeen });
});
route('POST', '/api/__mock/neuigkeiten/reset', (req) => {
  const id = req.json?.lastSeenId;
  changelogSeen = typeof id === 'string' ? id : null;
  return noContent();
});

route(['GET', 'PUT'], '/api/intern/favoriten', (req) => {
  if (req.method === 'GET') return json({ modules: staffFavorites });
  const modules = validateStaffFavorites(req.json);
  if (req.json?.takeover === true) {
    staffFavorites ??= modules;
    return json({ modules: staffFavorites });
  }
  staffFavorites = modules;
  return noContent();
});

route(['GET', 'POST'], '/api/intern/pflege/personen', (req) => {
  if (req.method === 'GET') return json(personenUebersicht());
  const id = addPerson(validatePerson(req.json));
  if (typeof id !== 'number') throw new ValidationError(id);
  return json({ id }, 201);
});

route('GET', '/api/intern/ich', () => json(mockIch(PRINCIPAL.userDetails)));
route('POST', '/api/__mock/personen/reset', () => {
  resetPersonen();
  return noContent();
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/personen/:id', (req) => {
  const id = Number(req.params.id);
  const result =
    req.method === 'DELETE'
      ? deletePerson(id, str(req.headers['if-match']))
      : updatePerson(id, validatePerson(req.json), str(req.json?.etag));
  if (typeof result === 'object') throw new ValidationError(result);
  if (result === 'conflict') {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  return result ? noContent() : notFound();
});

/** Projects and open tasks of the mock module Aufgaben, as `getProtokollEditorAufgaben`. */
function editorAufgaben(): ProtokollEditorAufgaben {
  return {
    projekte: [...taskData.projects]
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .map((project) => ({
        id: project.id,
        titel: einzeilig(project.title),
        campflowId: project.campflowId,
      })),
    offen: taskData.tasks
      .filter((task) => task.state === 'offen')
      .map((task): OffeneAufgabeQuelle => ({
        id: task.id,
        titel: einzeilig(task.title),
        zustaendig: taskPeople(task).map(({ login, name }) => ({
          login: einzeilig(login, 254),
          name: einzeilig(name),
        })),
        faellig: task.dueDate ?? '',
        projektId: task.projectId,
        ausProtokoll: Boolean(task.protokollId) || task.sourceId !== '',
      })),
    versionen: Object.fromEntries(
      taskData.tasks
        .filter((task) => task.state === 'offen' || task.state === 'erledigt')
        .map((task) => [task.id, task.etag])
    ),
  };
}

// Approving minutes creates their tasks, as on the server
mockAufgabenHooks.create = (protokollId, eintraege) => {
  const known = new Set(taskData.projects.map((project) => project.id));
  for (const { aufgabe, punkt, projekt } of eintraege) {
    taskData.tasks.push({
      id: nextTaskId++,
      etag: newEtag(newId()),
      title: aufgabe.titel.trim().slice(0, 200),
      description: '',
      assignee: aufgabe.zustaendig[0]?.login || aufgabe.zustaendig[0]?.name || '',
      assignees: aufgabe.zustaendig.map(({ login, name }) => ({ login, name })),
      dueDate: aufgabe.faellig || null,
      projectId: projekt && known.has(projekt.id) ? projekt.id : null,
      state: 'offen',
      sourceId: '',
      sourceVersion: '',
      quote: '',
      protokollId,
      protokollPunkt: punkt,
    });
  }
  return eintraege.length;
};

route('GET', '/api/intern/protokoll-editor-aufgaben', () => json(editorAufgaben()));

route('PUT', '/api/intern/pflege/protokoll-editor-aufgaben/:id', (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task || (task.state !== 'offen' && task.state !== 'erledigt')) return notFound();
  if (typeof req.json?.erledigt !== 'boolean') {
    throw new ValidationError({ erledigt: 'Bitte angeben, ob die Aufgabe erledigt ist.' });
  }
  if (req.json.etag !== task.etag) return TASK_CONFLICT();
  task.state = req.json.erledigt ? 'erledigt' : 'offen';
  task.etag = newEtag(newId());
  return json({ etag: task.etag });
});

route('GET', '/api/intern/protokoll-editor/:id', (req) => {
  const detail = editorDetail(req.params.id, tabToken(req));
  return detail ? json(detail) : notFound();
});

route(
  'GET',
  '/api/intern/protokoll-editor/:id/live',
  (req) => {
    const live = editorLive(req.params.id, req.query.get('etag') ?? '', tabToken(req));
    return live ? json(live) : notFound();
  },
  true
);

route('GET', '/api/intern/protokoll-editor/:id/versionen', (req) => {
  const list = editorRevisions(req.params.id);
  return list ? json(list) : notFound();
});

route('GET', '/api/intern/protokoll-editor/:id/versionen/:revisionId', (req) => {
  const revision = editorRevision(req.params.id, req.params.revisionId);
  return revision ? json(revision) : notFound();
});

route('POST', '/api/intern/pflege/protokoll-editor', (req) => {
  const body = req.json ?? {};
  const title = str(body.title).trim();
  const date = str(body.date);
  const beginn = str(body.beginn);
  const fields: Record<string, string> = {};
  if (!title) fields.title = 'Bitte einen Titel angeben.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte das Datum der Sitzung angeben.';
  if (beginn && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(beginn)) {
    fields.beginn = 'Bitte eine Uhrzeit wie 19:30 angeben.';
  }
  if (Object.keys(fields).length > 0) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
  }
  return json({ id: createEditorProtokoll(title, date, beginn, editorAufgaben().offen) }, 201);
});

route(['PUT', 'DELETE'], '/api/intern/pflege/protokoll-editor/:id', (req) => {
  if (req.method === 'DELETE') {
    return deleteEditorProtokoll(req.params.id) ? noContent() : notFound();
  }
  const body = req.json ?? {};
  const result = saveEditorProtokoll(req.params.id, {
    token: str(body.token),
    etag: str(body.etag),
    title: str(body.title),
    date: str(body.date),
    inhalt: body.inhalt as Parameters<typeof saveEditorProtokoll>[1]['inhalt'],
    aktiverPunkt: typeof body.aktiverPunkt === 'string' ? body.aktiverPunkt : null,
    sicherung:
      body.sicherung === 'ueberschreiben' || body.sicherung === 'wiederherstellen'
        ? body.sicherung
        : null,
  });
  if (!result) return notFound();
  if ('locked' in result) return EDITOR_LOCKED(result.locked);
  if ('notEditable' in result) return EDITOR_NOT_EDITABLE();
  if ('conflict' in result) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  return json(result.ok);
});

route(['POST', 'DELETE'], '/api/intern/pflege/protokoll-editor/:id/sperre', (req) => {
  const body = req.json ?? {};
  const token = str(body.token);
  if (req.method === 'DELETE') {
    releaseEditorSperre(req.params.id, token);
    return noContent();
  }
  const result = takeEditorSperre(
    req.params.id,
    token,
    body.uebernehmen === true,
    typeof body.aktiverPunkt === 'string' ? body.aktiverPunkt : null
  );
  if (!result) return notFound();
  if ('notEditable' in result) return EDITOR_NOT_EDITABLE();
  return 'locked' in result ? EDITOR_LOCKED(result.locked) : json(result.ok);
});

const EDITOR_NOT_EDITABLE = (): MockResult =>
  error(
    409,
    'NOT_EDITABLE',
    'Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.'
  );

function reviewResponse(result: ReviewResult): MockResult {
  if (!result) return notFound();
  if ('locked' in result) return EDITOR_LOCKED(result.locked);
  if ('conflict' in result) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  if ('invalid' in result) {
    return error(
      400,
      'INVALID',
      result.invalid,
      result.field ? { [result.field]: result.invalid } : { form: result.invalid }
    );
  }
  return json(result.ok);
}

route('POST', '/api/intern/pflege/protokoll-editor/:id/review', (req) => {
  const body = req.json ?? {};
  return reviewResponse(
    reviewEditorProtokoll(req.params.id, {
      action: str(body.action),
      etag: str(body.etag),
      token: typeof body.token === 'string' ? body.token : null,
      note: str(body.note),
      ownConfirmed: body.ownConfirmed === true,
    })
  );
});

route('POST', '/api/intern/pflege/protokoll-editor/:id/versand', (req) => {
  const body = req.json ?? {};
  return reviewResponse(
    versandEditorProtokoll(req.params.id, {
      action: str(body.action),
      etag: str(body.etag),
      version: str(body.version),
      retry: body.retry === true,
      excluded: strings(body.excluded),
      extra: strings(body.extra),
    })
  );
});

route(
  'GET',
  '/api/intern/protokoll-editor/:id/pdf',
  (req) => {
    const fileName = editorPdfName(req.params.id);
    if (!fileName) return notFound();
    return {
      kind: 'raw',
      status: 200,
      contentType: 'application/pdf',
      body: minimalPdf(fileName),
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    };
  },
  true
);

// Stands in for Blob Storage: accepts the upload and forgets it
route('PUT', '/api/mock-upload/:id', () => ({ kind: 'empty', status: 201 }), true);

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
  return json({ hasImage: person.hasImage, etag: person.etag });
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
    restrictedItems: [],
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
    submittedBy: 'leitung@example.test',
    submittedAt: isoFromNow(-1.8),
    hasImage: true,
    hasOriginal: false,
    aiCheck: {
      ...mockBelegCheck(),
      shop: 'REWE',
      amountCent: 4387,
      restrictedItems: ['Augustiner Hell 0,5l'],
    },
    campflow: null,
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
    status: 'Abgelehnt',
    reviewNote: 'Der Betrag ist auf dem Foto abgeschnitten. Bitte neu fotografieren.',
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
    campflow: null,
  },
  {
    id: '39',
    etag: newEtag('beleg-39'),
    shop: 'Deutsche Bahn',
    date: dayFromToday(-20),
    amountCent: 11840,
    paidBy: 'Sam Muster',
    payout: true,
    aktion: 'Sommerlager 2026 Oberjoch',
    note: 'Fahrkarten Vorbereitungsteam',
    status: 'Angenommen',
    reviewNote: '',
    submittedBy: 'sam@example.test',
    submittedAt: isoFromNow(-19),
    hasImage: true,
    hasOriginal: false,
    aiCheck: null,
    campflow: null,
  },
];
/** Receipts the demo Kasse already transferred to CampFlow; their images come from CampFlow. */
const uebertrageneBelege: TransferredBeleg[] = [
  {
    id: '35',
    shop: 'Edeka',
    date: dayFromToday(-30),
    amountCent: 6412,
    paidBy: 'Demo Leitung',
    payout: true,
    aktion: 'Sommerlager 2026 Oberjoch',
    note: 'Grillabend',
    submittedBy: 'leitung@example.test',
    number: '2026-104',
    costUnitName: 'Sommerlager 2026 Oberjoch',
    categoryName: 'Verpflegung',
    transferredBy: 'kasse@example.test',
    transferredAt: isoFromNow(-25),
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
    submittedBy: PRINCIPAL.userDetails,
    submittedAt: new Date(MOCK_NOW).toISOString(),
    hasImage: true,
    hasOriginal: false,
    aiCheck: mockBelegCheck(),
    campflow: null,
  };
  const invalid = storeBelegPhotos(beleg, body);
  if (invalid) return invalid;
  applyBeleg(beleg, { ...body, status: 'Eingereicht', reviewNote: '' });
  belege.unshift(beleg);
  return json({ id: beleg.id }, 201);
});

route('POST', '/api/intern/pflege/belege/pruefung', (req) => {
  if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
    return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  return json({ available: true, check: mockBelegCheck() });
});

route(['GET'], '/api/intern/pflege/belege/rolle', () => json({ reviewer: true }));

route(['GET'], '/api/intern/pflege/belege/uebertragen', () => json(uebertrageneBelege));

route(['PATCH', 'DELETE'], '/api/intern/pflege/belege/:id', (req) => {
  const index = belege.findIndex((b) => b.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    belege.splice(index, 1);
    return noContent();
  }
  if (str(req.json?.status) === 'Abgelehnt' && !str(req.json?.reviewNote).trim()) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      reviewNote: 'Bitte begründen, warum der Beleg abgelehnt wird.',
    });
  }
  const rejected = str(req.json?.status) === 'Abgelehnt' && belege[index].status !== 'Abgelehnt';
  applyBeleg(belege[index], req.json ?? {});
  // The demo pretends the rejection mail was sent
  return json({ mailed: rejected });
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
      beleg.hasImage = true;
      beleg.etag = newEtag(`beleg-${beleg.id}`);
      return json(beleg);
    }
    const stored = (req.query.get('original') ? belegOriginals : belegPhotos).get(beleg.id);
    if (stored) return jpeg(stored);
    return svg(documentPreviewSvg(`${beleg.shop}.jpg`, 600, 800));
  },
  true
);

/** Next Belegnummer the demo CampFlow hands out. */
let nextCampflowNumber = 112;

// Like the API: checks the version, books the receipt in the demo CampFlow and deletes it here
route('POST', '/api/intern/pflege/belege/:id/campflow', (req) => {
  const index = belege.findIndex((b) => b.id === req.params.id);
  if (index < 0) return notFound();
  const beleg = belege[index];
  if (str(req.json?.etag) !== beleg.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  if (beleg.status !== 'Angenommen') {
    return error(
      409,
      'NOT_ACCEPTED',
      'Nur angenommene Belege können nach CampFlow übertragen werden.'
    );
  }
  const unit = kostenstellen.find((k) => k.id === str(req.json?.costUnitId));
  const category = unit?.categories.find((c) => c.id === str(req.json?.categoryId));
  if (!unit || !category) {
    return error(
      400,
      'INVALID_CHOICE',
      'Diese Kostenstelle oder Kategorie gibt es in CampFlow nicht (mehr).'
    );
  }
  belege.splice(index, 1);
  const number = `2026-${nextCampflowNumber++}`;
  uebertrageneBelege.unshift({
    id: beleg.id,
    shop: beleg.shop,
    date: beleg.date,
    amountCent: beleg.amountCent,
    paidBy: beleg.paidBy,
    payout: beleg.payout,
    aktion: beleg.aktion,
    note: beleg.note,
    submittedBy: beleg.submittedBy,
    number,
    costUnitName: unit.name,
    categoryName: category.name,
    transferredBy: PRINCIPAL.userDetails,
    transferredAt: new Date(MOCK_NOW).toISOString(),
  });
  return json({
    campflow: {
      state: 'Hochgeladen',
      costUnitId: unit.id,
      costUnitName: unit.name,
      categoryId: category.id,
      categoryName: category.name,
      number,
      error: '',
      startedBy: PRINCIPAL.userDetails,
      startedAt: new Date(MOCK_NOW).toISOString(),
    },
    created: true,
    deleted: true,
  });
});

route('GET', '/api/intern/pflege/downloads', () => json(staffDownloads()));

/** Running uploads (upload id → parts), as the API stages them in Blob Storage. */
const uploadParts = new Map<string, Map<number, number>>();
const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

route('POST', '/api/intern/pflege/downloads/upload', (req) => {
  const body = req.json ?? {};
  const fileName = str(body.fileName).trim();
  if (!fileName)
    return error(400, 'INVALID', 'Bitte gib einen Dateinamen an.', {
      fileName: 'Bitte gib einen Dateinamen an.',
    });
  if (body.replace !== true && downloads.some((d) => sameName(d.fileName, fileName)))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
  const id = newId();
  uploadParts.set(id, new Map());
  return json({ uploadId: id, partSize: UPLOAD_PART_BYTES });
});

route(
  'PUT',
  '/api/intern/pflege/downloads/upload/:id/:index',
  (req) => {
    const parts = uploadParts.get(req.params.id);
    if (!parts) return notFound();
    parts.set(Number(req.params.index), req.raw.length);
    return noContent();
  },
  true
);

route('POST', '/api/intern/pflege/downloads/upload/:id', (req) => {
  const body = req.json ?? {};
  const fileName = str(body.fileName).trim();
  const replace = body.replace === true;
  const existing = downloads.find((d) => sameName(d.fileName, fileName));
  if (existing && !replace)
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
  const parts = uploadParts.get(req.params.id);
  const received = [...(parts?.values() ?? [])].reduce((total, part) => total + part, 0);
  if (!parts || parts.size === 0 || received !== Number(body.size))
    return error(
      409,
      'INCOMPLETE',
      'Die Datei ist nicht vollständig angekommen und wurde nicht gespeichert. Lade sie noch einmal hoch.'
    );
  uploadParts.delete(req.params.id);
  const size = [...parts.values()].reduce((total, part) => total + part, 0);
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeType =
    { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[
      extension
    ] ?? 'application/octet-stream';
  const preview =
    typeof body.preview === 'string' ? Buffer.from(body.preview, 'base64') : undefined;
  const now = new Date(MOCK_NOW).toISOString();
  const values = {
    fileName,
    size,
    mimeType,
    lastModifiedAt: now,
    lastModifiedBy: PRINCIPAL.userDetails,
    hasPreview: preview !== undefined,
    preview,
  };
  if (existing) {
    Object.assign(existing, values);
    return json({ id: existing.id }, 201);
  }
  const id = `01MOCKUP${req.params.id}`;
  downloads.push({ id, createdAt: now, createdBy: PRINCIPAL.userDetails, ...values });
  return json({ id }, 201);
});

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

route(['PATCH', 'DELETE'], '/api/intern/pflege/downloads/:id', (req) => {
  const index = downloads.findIndex((d) => d.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    downloads.splice(index, 1);
    return noContent();
  }
  const fileName = str(req.json?.fileName).trim();
  if (fileName && downloads.some((d, i) => i !== index && sameName(d.fileName, fileName)))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
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
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
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

// ---------------------------------------------------------------------------------------------
// Fotos: the library in SharePoint, and SharePoint's own preview, download and upload URLs

route('GET', '/api/intern/fotos/ordner', (req) => {
  const path = req.query.get('pfad') ?? '';
  if (!splitFotoPath(path)) return error(400, 'INVALID', 'Ungültiger Ordner.');
  const folder = mockFotoFolder(path);
  return folder
    ? json(folder)
    : notFound(
        'Diesen Ordner gibt es nicht mehr. Vielleicht wurde er in SharePoint umbenannt oder verschoben.'
      );
});

route('GET', '/api/intern/fotos/dateien/:id', (req) => {
  const detail = mockFotoDetail(req.params.id);
  return detail ? json(detail) : notFound('Diese Datei gibt es nicht mehr.');
});

/** The API names the folder of an Aktion upload; the browser may see another first name. */
const MOCK_FOTO_PERSON = 'Demo';

route('GET', '/api/intern/fotos/ziel', () => json({ vorname: MOCK_FOTO_PERSON }));

route('POST', '/api/intern/fotos/ziel', (req) => {
  const body = req.json ?? {};
  let path: string | null;
  if ('aktion' in body) {
    path = aktionFotoPath(str(body.jahr), str(body.aktion), MOCK_FOTO_PERSON);
  } else {
    path = [str(body.pfad), cleanName(str(body.unterordner))].filter(Boolean).join('/');
  }
  if (!path || !splitFotoPath(path))
    return error(400, 'INVALID', 'Bitte wähle einen Ordner aus, nicht die oberste Ebene.');
  return json(mockFotoEnsure(path));
});

route('POST', '/api/intern/fotos/upload', (req) => {
  const body = req.json ?? {};
  const size = Number(body.size);
  if (!str(body.name) || !(size > 0)) return error(400, 'INVALID', 'Ungültige Datei.');
  const reserved = Array.isArray(body.belegt) ? body.belegt.map(String) : [];
  return json(
    mockFotoUploadSession(str(body.pfad), str(body.name), size, {
      newName: body.neu === true,
      reserved,
    })
  );
});

route(
  'GET',
  '/api/mock-fotos/vorschau/:id',
  (req) => {
    const preview = mockFotoPreview(req.params.id, req.query.has('gross'));
    return preview ? svg(preview) : notFound();
  },
  true
);

route(
  'GET',
  '/api/mock-fotos/datei/:id',
  (req) => {
    const content = mockFotoContent(req.params.id);
    return content
      ? {
          kind: 'raw',
          status: 200,
          contentType: 'application/octet-stream',
          body: content,
          headers: { 'Content-Disposition': 'attachment' },
        }
      : notFound();
  },
  true
);

route(['PUT', 'GET'], '/api/mock-fotos/upload/:id', (req) => {
  const result =
    req.method === 'PUT'
      ? mockFotoUploadPart(req.params.id, req.headers['content-range'], new Uint8Array(req.raw))
      : mockFotoUploadStatus(req.params.id);
  return json(result.body, result.status);
});

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
    try {
      send(res, denied ?? candidate.handler(request));
    } catch (caught) {
      if (caught instanceof ValidationError)
        send(res, json({ code: 'INVALID', message: caught.message, fields: caught.fields }, 400));
      else throw caught;
    }
    return;
  }

  if (pathMatched) {
    send(res, error(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.'));
    return;
  }
  console.warn(`[mock-api] No mock for ${request.method} ${request.path}`);
  send(res, error(404, 'NOT_FOUND', `Kein Mock für ${request.method} ${request.path}.`));
}

/**
 * Answers a GET like the middleware, without server and delay. The build bakes these answers
 * into the pages when `CONTENT_SOURCE` is `mock` (see `src/lib/content/source.ts`).
 */
export function handleMockGet(pathWithQuery: string): {
  status: number;
  contentType: string;
  body: Uint8Array;
} {
  const url = new URL(pathWithQuery, 'http://localhost');
  const request: MockRequest = {
    method: 'GET',
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    params: {},
    headers: {},
    raw: Buffer.alloc(0),
    json: null,
  };
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  for (const candidate of routes) {
    const match = candidate.pattern.exec(request.path);
    if (!match || !candidate.methods.includes('GET')) continue;
    candidate.keys.forEach((key, i) => (request.params[key] = decodeURIComponent(match[i + 1])));
    const result = candidate.handler(request);
    if (result.kind === 'json') {
      return {
        status: result.status,
        contentType: 'application/json; charset=utf-8',
        body: encode(JSON.stringify(result.body)),
      };
    }
    if (result.kind === 'raw') {
      return {
        status: result.status,
        contentType: result.contentType,
        body: typeof result.body === 'string' ? encode(result.body) : result.body,
      };
    }
    return {
      status: result.kind === 'empty' ? result.status : 302,
      contentType: '',
      body: encode(''),
    };
  }
  return { status: 404, contentType: '', body: encode('') };
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
