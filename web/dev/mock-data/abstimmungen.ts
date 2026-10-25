import {
  abstimmungErgebnis,
  validateAbstimmung,
  validateAbstimmungName,
  validateGewaehlt,
} from '../../../api/lib/abstimmung-model';
import type {
  AbstimmungAnsicht,
  AbstimmungDetail,
  AbstimmungEingabe,
  AbstimmungMailStatus,
  AbstimmungUebersicht,
} from '../../../api/lib/abstimmung-model';
import { ValidationError } from '../../../api/lib/pflege-validation';

/**
 * Abstimmungen of the mock API, kept in memory like `api/lib/abstimmungen.ts` keeps them in
 * Azure SQL. Tokens are readable placeholders: `#link=` + 43 × the ID, `#t=` + the person.
 */

interface MockTeilnahme {
  id: number;
  token: string;
  name: string;
  login: string | null;
  email: string | null;
  gewaehlt: number[];
  geantwortet: boolean;
  mailStatus: AbstimmungMailStatus | null;
  mailArt: 'einladung' | 'erinnerung' | null;
  eingeladenAm: string | null;
  erinnertAm: string | null;
}

interface MockAbstimmung {
  id: number;
  version: number;
  titel: string;
  beschreibung: string;
  mehrfach: boolean;
  linkToken: string;
  erstelltVon: string;
  erstelltVonName: string;
  erstelltAm: string;
  geschlossen: boolean;
  optionen: { id: number; text: string }[];
  teilnahmen: MockTeilnahme[];
}

let nextId = 1;
const abstimmungen: MockAbstimmung[] = [];

function token(seed: string): string {
  return seed
    .replace(/[^A-Za-z0-9]/g, '')
    .padEnd(43, 'x')
    .slice(0, 43);
}

function teilnahme(values: Partial<MockTeilnahme>): MockTeilnahme {
  const id = nextId++;
  return {
    id,
    token: token(`person${id}`),
    name: '',
    login: null,
    email: null,
    gewaehlt: [],
    geantwortet: false,
    mailStatus: null,
    mailArt: null,
    eingeladenAm: null,
    erinnertAm: null,
    ...values,
  };
}

function create(input: AbstimmungEingabe, login: string, name: string): MockAbstimmung {
  const id = nextId++;
  const abstimmung: MockAbstimmung = {
    id,
    version: 1,
    titel: input.titel,
    beschreibung: input.beschreibung,
    mehrfach: input.mehrfach,
    linkToken: token(`link${id}`),
    erstelltVon: login,
    erstelltVonName: name,
    erstelltAm: new Date().toISOString(),
    geschlossen: false,
    optionen: input.optionen.map((option) => ({ id: nextId++, text: option.text })),
    teilnahmen: [],
  };
  abstimmungen.unshift(abstimmung);
  return abstimmung;
}

/** Test data: one Terminfindung by someone else, one decision of the mock login. */
export function resetMockAbstimmungen(login: string): void {
  abstimmungen.length = 0;
  const termin = create(
    validateAbstimmung({
      titel: 'Termin für die Weihnachtsfeier',
      beschreibung: 'Bitte alle Termine wählen, die bei dir gehen.',
      mehrfach: true,
      optionen: [
        { text: 'Fr, 11.12.2026, 19:00 Uhr' },
        { text: 'Sa, 12.12.2026, 18:00 Uhr' },
        { text: 'Fr, 18.12.2026, 19:00 Uhr' },
      ],
    }),
    'vroni@example.test',
    'Vroni Vorstand'
  );
  const [a, b, c] = termin.optionen.map((option) => option.id);
  termin.teilnahmen.push(
    teilnahme({
      name: 'Vroni Vorstand',
      login: 'vroni@example.test',
      gewaehlt: [a, c],
      geantwortet: true,
    }),
    teilnahme({
      name: 'Theo Tester',
      login: 'theo@example.test',
      gewaehlt: [b, c],
      geantwortet: true,
    }),
    teilnahme({ name: 'Oma Erna', gewaehlt: [c], geantwortet: true })
  );
  const essen = create(
    validateAbstimmung({
      titel: 'Was essen wir auf dem Sommerlager?',
      beschreibung: '',
      mehrfach: false,
      optionen: [{ text: 'Spaghetti' }, { text: 'Chili sin Carne' }, { text: 'Kässpatzn' }],
    }),
    login,
    'Lea Leitung'
  );
  essen.teilnahmen.push(
    teilnahme({
      name: 'Theo Tester',
      login: 'theo@example.test',
      gewaehlt: [essen.optionen[2].id],
      geantwortet: true,
    }),
    teilnahme({
      name: 'Alma Altleitung',
      email: 'alma@example.test',
      mailStatus: 'gesendet',
      mailArt: 'einladung',
      eingeladenAm: new Date().toISOString(),
    })
  );
}

function byId(id: number): MockAbstimmung | undefined {
  return abstimmungen.find((a) => a.id === id);
}

function ergebnis(a: MockAbstimmung) {
  return abstimmungErgebnis({
    ...a,
    antworten: a.teilnahmen
      .filter((t) => t.geantwortet)
      .map((t) => ({ teilnahmeId: t.id, name: t.name, gewaehlt: t.gewaehlt })),
  });
}

export function mockAbstimmungenList(login: string): AbstimmungUebersicht[] {
  return abstimmungen.map((a) => ({
    id: a.id,
    titel: a.titel,
    geschlossen: a.geschlossen,
    erstelltVonName: a.erstelltVonName,
    erstelltAm: a.erstelltAm,
    eigene: a.erstelltVon === login,
    antworten: a.teilnahmen.filter((t) => t.geantwortet).length,
    ichGeantwortet: a.teilnahmen.some((t) => t.login === login && t.geantwortet),
  }));
}

export function mockAbstimmungDetail(
  id: number,
  login: string,
  host: string
): AbstimmungDetail | undefined {
  const a = byId(id);
  if (!a) return undefined;
  const eigene = a.erstelltVon === login;
  const ich = a.teilnahmen.find((t) => t.login === login);
  return {
    ...ergebnis(a),
    ich: ich ? { name: ich.name, gewaehlt: ich.gewaehlt, geantwortet: ich.geantwortet } : null,
    etag: `"${a.version}"`,
    erstelltAm: a.erstelltAm,
    eigene,
    link: eigene ? `http://${host}/abstimmung#link=${a.linkToken}` : null,
    teilnahmen: eigene
      ? a.teilnahmen.map((t) => ({
          id: t.id,
          name: t.name,
          email: t.email ?? '',
          geantwortet: t.geantwortet,
          eingeladenAm: t.eingeladenAm,
          erinnertAm: t.erinnertAm,
          mailStatus: t.mailStatus,
        }))
      : null,
  };
}

export function mockCreateAbstimmung(body: unknown, login: string, name: string): number {
  return create(validateAbstimmung(body as Record<string, unknown>), login, name).id;
}

/** `'conflict'`, `'forbidden'`, `'missing'` or `'ok'`. */
export function mockUpdateAbstimmung(
  id: number,
  body: Record<string, unknown> | null,
  login: string
): 'conflict' | 'forbidden' | 'missing' | 'ok' {
  const a = byId(id);
  if (!a) return 'missing';
  if (a.erstelltVon !== login) return 'forbidden';
  if (body?.etag !== `"${a.version}"`) return 'conflict';
  if (typeof body.geschlossen === 'boolean' && body.titel === undefined) {
    a.geschlossen = body.geschlossen;
  } else {
    const input = validateAbstimmung(body);
    const keep = new Set(input.optionen.flatMap((o) => (o.id ? [o.id] : [])));
    if (
      !input.mehrfach &&
      a.teilnahmen.some((t) => t.gewaehlt.filter((g) => keep.has(g)).length > 1)
    )
      throw new ValidationError({
        mehrfach:
          'Es haben schon Leute mehrere Optionen gewählt. Lass „Mehrere Optionen wählbar“ an oder leg eine neue Abstimmung an.',
      });
    Object.assign(a, {
      titel: input.titel,
      beschreibung: input.beschreibung,
      mehrfach: input.mehrfach,
    });
    a.optionen = input.optionen.map((o) => ({ id: o.id ?? nextId++, text: o.text }));
    for (const t of a.teilnahmen) t.gewaehlt = t.gewaehlt.filter((g) => keep.has(g));
  }
  a.version++;
  return 'ok';
}

export function mockDeleteAbstimmung(
  id: number,
  etag: string,
  login: string
): 'conflict' | 'forbidden' | 'missing' | 'ok' {
  const index = abstimmungen.findIndex((a) => a.id === id);
  const a = abstimmungen[index];
  if (!a) return 'missing';
  if (a.erstelltVon !== login) return 'forbidden';
  if (etag !== `"${a.version}"`) return 'conflict';
  abstimmungen.splice(index, 1);
  return 'ok';
}

export function mockStaffVote(
  id: number,
  login: string,
  name: string,
  gewaehlt: unknown
): 'closed' | 'missing' | 'ok' {
  const a = byId(id);
  if (!a) return 'missing';
  if (a.geschlossen) return 'closed';
  const choice = validateGewaehlt(
    gewaehlt,
    a.optionen.map((o) => o.id),
    a.mehrfach
  );
  let own = a.teilnahmen.find((t) => t.login === login);
  if (!own) {
    own = teilnahme({ login });
    a.teilnahmen.push(own);
  }
  Object.assign(own, { name, gewaehlt: choice, geantwortet: true });
  return 'ok';
}

function find(link: {
  link?: unknown;
  token?: unknown;
}): { a: MockAbstimmung; t?: MockTeilnahme } | undefined {
  for (const a of abstimmungen) {
    if (link.link && a.linkToken === link.link) return { a };
    const t = a.teilnahmen.find((entry) => entry.token === link.token);
    if (link.token && t) return { a, t };
  }
  return undefined;
}

export function mockPublicAnsicht(link: {
  link?: unknown;
  token?: unknown;
}): AbstimmungAnsicht | undefined {
  const found = find(link);
  if (!found) return undefined;
  const { a, t } = found;
  return {
    ...ergebnis(a),
    ich: t ? { name: t.name, gewaehlt: t.gewaehlt, geantwortet: t.geantwortet } : null,
  };
}

export function mockPublicVote(
  body: Record<string, unknown>
): { token: string } | 'closed' | 'missing' {
  const found = find(body);
  if (!found) return 'missing';
  const { a } = found;
  if (a.geschlossen) return 'closed';
  const name = validateAbstimmungName(body.name);
  const choice = validateGewaehlt(
    body.gewaehlt,
    a.optionen.map((o) => o.id),
    a.mehrfach
  );
  let t = found.t;
  // Another name on a link that has an answer is another person, as in the API
  const norm = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (t?.geantwortet && norm(t.name) !== norm(name)) t = undefined;
  if (!t) {
    t = teilnahme({});
    a.teilnahmen.push(t);
  }
  Object.assign(t, { name, gewaehlt: choice, geantwortet: true });
  return { token: t.token };
}

export function mockInvite(
  id: number,
  addresses: { email: string; name: string }[]
): { neu: number; schon: number } {
  const a = byId(id)!;
  let neu = 0;
  for (const { email, name } of addresses) {
    if (a.teilnahmen.some((t) => t.email === email)) continue;
    a.teilnahmen.push(teilnahme({ email, name, mailStatus: 'offen', mailArt: 'einladung' }));
    neu++;
  }
  return { neu, schon: addresses.length - neu };
}

export function mockInvited(id: number): string[] {
  return (byId(id)?.teilnahmen ?? []).flatMap((t) => (t.email ? [t.email] : []));
}

function erinnerbar(a: MockAbstimmung): MockTeilnahme[] {
  return a.teilnahmen.filter(
    (t) => t.email && !t.geantwortet && (t.mailStatus === 'gesendet' || t.mailStatus === 'versucht')
  );
}

export function mockRemind(id: number, send: boolean): number {
  const list = erinnerbar(byId(id)!);
  if (send) for (const t of list) Object.assign(t, { mailStatus: 'offen', mailArt: 'erinnerung' });
  return list.length;
}

export function mockMailStand(id: number): { offen: number; gesendet: number; unklar: number } {
  const list = byId(id)?.teilnahmen ?? [];
  return {
    offen: list.filter((t) => t.mailStatus === 'offen').length,
    gesendet: list.filter((t) => t.mailStatus === 'gesendet').length,
    unklar: list.filter((t) => t.mailStatus === 'versucht').length,
  };
}

/** Sends up to two queued mails per request, so the progress is visible. */
export function mockSendMails(id: number): void {
  const now = new Date().toISOString();
  for (const t of (byId(id)?.teilnahmen ?? [])
    .filter((x) => x.mailStatus === 'offen')
    .slice(0, 2)) {
    t.mailStatus = 'gesendet';
    if (t.mailArt === 'erinnerung') t.erinnertAm = now;
    else t.eingeladenAm = now;
  }
}

export function mockAbstimmungOwner(id: number): string | undefined {
  return byId(id)?.erstelltVon;
}

export function mockAbstimmungClosed(id: number): boolean {
  return byId(id)?.geschlossen ?? false;
}
