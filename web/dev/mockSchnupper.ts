import type { MockRequest, MockResult } from './mockApi';
import { validateSchnupperAnfrage } from '../../api/lib/schnupper-model';
import type { StaffSchnupperAnfrage } from '../../api/lib/schnupper-model';
import {
  validateSchnupperAbsage,
  validateSchnupperBestaetigung,
} from '../../api/lib/validation/schnupper';
import { newEtag } from './mock-data/util';

/** Demo data and routes of the Schnupperstunden-Anfragen (#139). */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string, fields?: object): MockResult =>
  json({ error: code, code, message, ...(fields ? { fields } : {}) }, status);
const notFound = (): MockResult => error(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');
const conflict = (): MockResult =>
  error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function anfrage(id: number, values: Partial<StaffSchnupperAnfrage>): StaffSchnupperAnfrage {
  return {
    id,
    etag: newEtag(`schnupper-${id}`),
    createdAt: new Date(Date.now() - id * 86_400_000).toISOString(),
    alter: 8,
    stufe: 'woelflinge',
    kindVorname: '',
    name: '',
    email: '',
    telefon: '',
    wunschzeit: '',
    nachricht: '',
    status: 'offen',
    termin: null,
    antwort: '',
    antwortMail: null,
    bearbeitetVon: null,
    bearbeitetAm: null,
    ...values,
  };
}

const anfragen: StaffSchnupperAnfrage[] = [
  anfrage(1, {
    kindVorname: 'Mia',
    name: 'Erika Muster',
    email: 'erika.muster@example.invalid',
    telefon: '0170 1234567',
    wunschzeit: 'Gern nach den Herbstferien, freitags passt gut.',
    nachricht: 'Mia war noch nie bei den Pfadfindern und ist etwas schüchtern.',
  }),
  anfrage(2, {
    alter: 14,
    stufe: 'unklar',
    name: 'Jonas Beispiel',
    email: 'jonas.beispiel@example.invalid',
    wunschzeit: 'So bald wie möglich',
  }),
  anfrage(3, {
    alter: 11,
    stufe: 'jupfis',
    kindVorname: 'Lena',
    name: 'Petra Probe',
    email: 'petra.probe@example.invalid',
    wunschzeit: 'Nächste Woche',
    status: 'bestaetigt',
    termin: { datum: inDays(7), zeit: '17:00', ort: 'Pfarrheim Feldkirchen' },
    antwortMail: false,
    bearbeitetVon: 'leitung@stamm-phoenix.de',
    bearbeitetAm: new Date().toISOString(),
  }),
];

function find(req: MockRequest): StaffSchnupperAnfrage | undefined {
  return anfragen.find((item) => item.id === Number(req.params.id));
}

export function registerSchnupperRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void
): void {
  route('POST', '/api/schnupperanfrage', (req) => {
    const { anfrage: input, errors } = validateSchnupperAnfrage(req.json ?? {});
    if (!input) return error(400, 'VALIDATION_FAILED', 'Bitte prüf deine Angaben.', errors);
    if (typeof req.json?.altcha !== 'string')
      return error(
        403,
        'CAPTCHA_FAILED',
        'Die Prüfung, ob du ein Mensch bist, ist fehlgeschlagen.'
      );
    const id = Math.max(0, ...anfragen.map((item) => item.id)) + 1;
    anfragen.unshift(anfrage(id, { ...input, createdAt: new Date().toISOString() }));
    return json({ status: 'sent', receipt: true });
  });

  route('GET', '/api/intern/pflege/schnupperanfragen', () =>
    json(
      [...anfragen].sort(
        (a, b) =>
          Number(b.status === 'offen') - Number(a.status === 'offen') ||
          b.createdAt.localeCompare(a.createdAt)
      )
    )
  );

  route('DELETE', '/api/intern/pflege/schnupperanfragen/:id', (req) => {
    const item = find(req);
    if (!item) return notFound();
    if (req.headers['if-match'] !== item.etag) return conflict();
    anfragen.splice(anfragen.indexOf(item), 1);
    return { kind: 'empty', status: 204 };
  });

  route('POST', '/api/intern/pflege/schnupperanfragen/:id/:art', (req) => {
    const item = find(req);
    if (!item) return notFound();
    if (req.json?.etag !== item.etag) return conflict();
    if (req.params.art === 'bestaetigen') {
      const input = validateSchnupperBestaetigung(req.json);
      item.status = 'bestaetigt';
      item.termin = { datum: input.datum, zeit: input.zeit, ort: input.ort };
      item.antwort = input.antwort;
    } else if (req.params.art === 'absagen') {
      item.status = 'abgesagt';
      item.termin = null;
      item.antwort = validateSchnupperAbsage(req.json).antwort;
    } else {
      return notFound();
    }
    item.antwortMail = true;
    item.bearbeitetVon = 'leitung@stamm-phoenix.de';
    item.bearbeitetAm = new Date().toISOString();
    item.etag = newEtag(`schnupper-${item.id}`);
    return json({ anfrage: item, mailSent: true });
  });
}
