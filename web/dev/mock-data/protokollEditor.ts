import {
  SPERRE_SECONDS,
  neuerInhalt,
  offeneAufgabenPunkt,
  protokollEintraege,
} from '../../../api/lib/protokoll-editor-model';
import type { ProtokollEintrag } from '../../../api/lib/protokoll-editor-model';
import type {
  OffeneAufgabeQuelle,
  ProtokollEditorAblage,
  ProtokollEditorDetail,
  ProtokollEditorStatus,
  ProtokollEditorVersand,
  ProtokollEditorOverview,
  ProtokollInhalt,
  ProtokollLiveResponse,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollRevisionReason,
  ProtokollSaveResponse,
  ProtokollSperre,
} from '../../src/lib/types';
import { dayFromToday, isoFromNow } from './util';

/**
 * Minutes of the Protokoll-Editor in the mock API: lock, versions and revisions work as on the
 * server (`api/lib/protokoll-editor.ts`), but the content is only checked roughly.
 */

const LOGIN = 'leitung@example.test';
const NAME = 'Demo Leitung';

interface MockSperre {
  login: string;
  name: string;
  token: string;
  since: number;
  until: number;
  aktiverPunkt: string | null;
}

interface MockEditorProtokoll {
  id: number;
  version: number;
  title: string;
  date: string;
  inhalt: ProtokollInhalt;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  sperre: MockSperre | null;
  revisions: ProtokollRevision[];
  status: ProtokollEditorStatus;
  submittedBy: string;
  submittedAt: string;
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  ablage: ProtokollEditorAblage | null;
  versand: ProtokollEditorVersand | null;
  aufgabenAngelegt: number;
}

/**
 * The module Aufgaben of the mock API (`mockApi.ts`): approving minutes creates their tasks
 * there, as on the server (`api/lib/protokoll-editor-aufgaben.ts`).
 */
export const mockAufgabenHooks: {
  create: (protokollId: number, eintraege: ProtokollEintrag[]) => number;
} = { create: () => 0 };

/** Review fields of new minutes. */
const NO_REVIEW = {
  status: 'entwurf' as ProtokollEditorStatus,
  submittedBy: '',
  submittedAt: '',
  reviewNote: '',
  approvedBy: '',
  approvedAt: '',
  ablage: null,
  versand: null,
  aufgabenAngelegt: 0,
};

const protokolle = new Map<number, MockEditorProtokoll>();
let nextId = 1;
let nextRevision = 1;
let idCounter = 1;
const nextElement = (): string => `mock-${idCounter++}`;

function seed(): void {
  const inhalt = neuerInhalt(nextElement, {
    sitzungsleitung: [
      { login: 'vera.vorstand@stamm-phoenix.de', name: 'Vera Vorstand' },
      { login: '', name: 'Volker Vorstand' },
    ],
    protokollant: [{ login: 'paula.protokoll@stamm-phoenix.de', name: 'Paula Protokoll' }],
    beginn: '19:30',
    ende: '21:10',
    teilnehmende: [
      { login: 'lea.leiterin@stamm-phoenix.de', name: 'Lea Leiterin', status: 'anwesend' },
      { login: 'max.muster@stamm-phoenix.de', name: 'Max Muster', status: 'anwesend' },
      { login: 'tom.test@stamm-phoenix.de', name: 'Tom Test', status: 'entschuldigt' },
    ],
  });
  inhalt.punkte[0].unterpunkte[0].text =
    'Gruppenstunde zum Thema Erste Hilfe, **12 Kinder** da.\n- Neue Halstücher bestellt\n- Ausflug in den Wildpark geplant';
  inhalt.punkte[1].text = 'Der Stammestag war gut besucht. Nächstes Mal früher aufbauen.';
  inhalt.punkte[2].titel = 'Pfingstlager';
  inhalt.punkte[2].aktion = {
    id: 'evt_pfingsten',
    titel: 'Pfingstlager',
    start: dayFromToday(220),
    ende: dayFromToday(223),
  };
  inhalt.punkte[2].text = 'Zeltplatz ist reserviert, die Anzahlung steht noch aus.';
  inhalt.punkte[2].aufgaben = [
    {
      id: nextElement(),
      titel: 'Anzahlung für den Zeltplatz überweisen',
      zustaendig: [{ login: '', name: 'Vera Vorstand' }],
      faellig: dayFromToday(7),
    },
  ];
  inhalt.punkte[2].termine = [
    {
      id: nextElement(),
      titel: 'Vortreffen Pfingstlager',
      datum: dayFromToday(21),
      uhrzeit: '18:00',
      ort: 'Stammesheim',
      zustaendig: [{ login: 'lea.leiterin@stamm-phoenix.de', name: 'Lea Leiterin' }],
    },
  ];
  inhalt.naechsteSitzung = { datum: dayFromToday(14), uhrzeit: '19:30', ort: 'Stammesheim' };
  const id = nextId++;
  protokolle.set(id, {
    id,
    version: 1,
    title: 'Leitendenrunde',
    date: dayFromToday(-14),
    inhalt,
    createdAt: isoFromNow(-14),
    createdBy: 'paula.protokoll@stamm-phoenix.de',
    updatedAt: isoFromNow(-14),
    updatedBy: 'paula.protokoll@stamm-phoenix.de',
    sperre: null,
    revisions: [],
    ...NO_REVIEW,
  });

  // Minutes of someone else waiting for the review, so the mock user can approve them
  const review = neuerInhalt(nextElement, {
    sitzungsleitung: [{ login: 'vera.vorstand@stamm-phoenix.de', name: 'Vera Vorstand' }],
    protokollant: [{ login: 'paula.protokoll@stamm-phoenix.de', name: 'Paula Protokoll' }],
    beginn: '20:00',
    ende: '21:00',
  });
  review.punkte[1].text = 'Kurzer Rückblick auf das Sommerlager.\n- Alles gut gelaufen';
  const reviewId = nextId++;
  protokolle.set(reviewId, {
    id: reviewId,
    version: 1,
    title: 'Stavo-Sitzung',
    date: dayFromToday(-7),
    inhalt: review,
    createdAt: isoFromNow(-7),
    createdBy: 'paula.protokoll@stamm-phoenix.de',
    updatedAt: isoFromNow(-6),
    updatedBy: 'paula.protokoll@stamm-phoenix.de',
    sperre: null,
    revisions: [],
    ...NO_REVIEW,
    status: 'review',
    submittedBy: 'paula.protokoll@stamm-phoenix.de',
    submittedAt: isoFromNow(-6),
  });
}
seed();

const etagOf = (p: MockEditorProtokoll): string => `"mock-protokoll-${p.id}-${p.version}"`;

function toSperre(sperre: MockSperre, token: string | null): ProtokollSperre {
  return {
    login: sperre.login,
    name: sperre.name,
    since: new Date(sperre.since).toISOString(),
    until: new Date(sperre.until).toISOString(),
    aktiverPunkt: sperre.aktiverPunkt,
    mine: token !== null && sperre.token === token,
    expired: sperre.until <= Date.now(),
  };
}

function toDetail(p: MockEditorProtokoll, token: string | null): ProtokollEditorDetail {
  return {
    id: p.id,
    title: p.title,
    date: p.date,
    status: p.status,
    inhalt: structuredClone(p.inhalt),
    etag: etagOf(p),
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
    sperre: p.sperre ? toSperre(p.sperre, token) : null,
    canDelete: p.status === 'entwurf',
    submittedBy: p.submittedBy,
    submittedAt: p.submittedAt,
    reviewNote: p.reviewNote,
    approvedBy: p.approvedBy,
    approvedAt: p.approvedAt,
    ablage: p.ablage,
    versand: p.versand,
    sendingConfigured: true,
    aufgabenAngelegt: p.aufgabenAngelegt,
  };
}

function addRevision(p: MockEditorProtokoll, reason: ProtokollRevisionReason): void {
  p.revisions.unshift({
    id: nextRevision++,
    savedAt: new Date().toISOString(),
    savedBy: LOGIN,
    reason,
    title: p.title,
    date: p.date,
    inhalt: structuredClone(p.inhalt),
  });
}

export function editorOverview(): ProtokollEditorOverview {
  return {
    protokolle: [...protokolle.values()]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((p) => ({
        id: p.id,
        title: p.title,
        date: p.date,
        status: p.status,
        createdBy: p.createdBy,
        updatedAt: p.updatedAt,
        writer: p.sperre && p.sperre.until > Date.now() ? p.sperre.name : null,
      })),
    today: dayFromToday(0),
    defaultTitle: 'Leitendenrunde',
  };
}

export function editorDetail(id: string, token: string | null): ProtokollEditorDetail | null {
  const p = protokolle.get(Number(id));
  return p ? toDetail(p, token) : null;
}

export function editorLive(
  id: string,
  etag: string,
  token: string | null
): ProtokollLiveResponse | null {
  const p = protokolle.get(Number(id));
  if (!p) return null;
  return {
    etag: etagOf(p),
    sperre: p.sperre ? toSperre(p.sperre, token) : null,
    protokoll: etag === etagOf(p) ? null : toDetail(p, token),
  };
}

export function createEditorProtokoll(
  title: string,
  date: string,
  beginn = '',
  offen: OffeneAufgabeQuelle[] = []
): number {
  const id = nextId++;
  const now = new Date().toISOString();
  const inhalt = neuerInhalt(nextElement, {
    sitzungsleitung: [
      { login: 'vera.vorstand@stamm-phoenix.de', name: 'Vera Vorstand' },
      { login: '', name: 'Volker Vorstand' },
    ],
    protokollant: [{ login: LOGIN, name: NAME }],
    beginn,
  });
  const offenePunkt = offeneAufgabenPunkt(nextElement(), offen);
  if (offenePunkt) inhalt.punkte.unshift(offenePunkt);
  protokolle.set(id, {
    id,
    version: 1,
    title,
    date,
    inhalt,
    createdAt: now,
    createdBy: LOGIN,
    updatedAt: now,
    updatedBy: LOGIN,
    sperre: null,
    revisions: [],
    ...NO_REVIEW,
  });
  return id;
}

export type SperreResult =
  { ok: ProtokollSaveResponse } | { locked: ProtokollSperre } | { notEditable: true } | null;

function claim(
  p: MockEditorProtokoll,
  token: string,
  uebernehmen: boolean,
  aktiverPunkt: string | null
): { locked: ProtokollSperre } | MockSperre {
  const now = Date.now();
  const current = p.sperre;
  const foreign = current !== null && current.token !== token;
  if (foreign && !uebernehmen && current.until > now) return { locked: toSperre(current, token) };
  if (foreign) addRevision(p, 'uebernahme');
  p.sperre = {
    login: LOGIN,
    name: NAME,
    token,
    since: foreign || !current ? now : current.since,
    until: now + SPERRE_SECONDS * 1000,
    aktiverPunkt,
  };
  return p.sperre;
}

export function takeEditorSperre(
  id: string,
  token: string,
  uebernehmen: boolean,
  aktiverPunkt: string | null
): SperreResult {
  const p = protokolle.get(Number(id));
  if (!p) return null;
  if (p.status !== 'entwurf') return { notEditable: true };
  const result = claim(p, token, uebernehmen, aktiverPunkt);
  if ('locked' in result) return result;
  return { ok: { etag: etagOf(p), updatedAt: p.updatedAt, sperre: toSperre(result, token) } };
}

export function releaseEditorSperre(id: string, token: string): void {
  const p = protokolle.get(Number(id));
  if (p?.sperre?.token === token) p.sperre = null;
}

export type SaveResult =
  | { ok: ProtokollSaveResponse }
  | { locked: ProtokollSperre }
  | { conflict: true }
  | { notEditable: true }
  | null;

export function saveEditorProtokoll(
  id: string,
  body: {
    token: string;
    etag: string;
    title: string;
    date: string;
    inhalt: ProtokollInhalt;
    aktiverPunkt: string | null;
    sicherung: 'ueberschreiben' | 'wiederherstellen' | null;
  }
): SaveResult {
  const p = protokolle.get(Number(id));
  if (!p) return null;
  if (p.status !== 'entwurf') return { notEditable: true };
  const result = claim(p, body.token, false, body.aktiverPunkt);
  if ('locked' in result) return result;
  if (body.etag !== etagOf(p)) return { conflict: true };
  if (body.sicherung) addRevision(p, body.sicherung);
  p.title = body.title;
  p.date = body.date;
  p.inhalt = structuredClone(body.inhalt);
  p.version++;
  p.updatedAt = new Date().toISOString();
  p.updatedBy = LOGIN;
  const last = p.revisions.find((r) => r.reason === 'speichern');
  if (!last || Date.now() - Date.parse(last.savedAt) >= 5 * 60_000) addRevision(p, 'speichern');
  return { ok: { etag: etagOf(p), updatedAt: p.updatedAt, sperre: toSperre(result, body.token) } };
}

export function editorRevisions(id: string): ProtokollRevisionListItem[] | null {
  const p = protokolle.get(Number(id));
  return p
    ? p.revisions.map(({ id: revisionId, savedAt, savedBy, reason }) => ({
        id: revisionId,
        savedAt,
        savedBy,
        reason,
      }))
    : null;
}

export function editorRevision(id: string, revisionId: string): ProtokollRevision | null {
  return protokolle.get(Number(id))?.revisions.find((r) => r.id === Number(revisionId)) ?? null;
}

export function deleteEditorProtokoll(id: string): boolean {
  return protokolle.delete(Number(id));
}

/** Outcome of a step of the review or the mailing in the mock API. */
export type ReviewResult =
  | { ok: Record<string, unknown> }
  | { invalid: string; field?: string }
  | { locked: ProtokollSperre }
  | { conflict: true }
  | null;

/** File name in the folder of the minutes, as on the server. */
export function editorPdfName(id: string): string | null {
  const p = protokolle.get(Number(id));
  return p ? (p.ablage?.fileName ?? `${p.date} ${p.title}.pdf`) : null;
}

/** Review, approval and sending back, as on the server (`protokoll-editor-review.ts`). */
export function reviewEditorProtokoll(
  id: string,
  body: {
    action: string;
    etag: string;
    token: string | null;
    note: string;
    ownConfirmed: boolean;
  }
): ReviewResult {
  const p = protokolle.get(Number(id));
  if (!p) return null;
  if (body.etag !== etagOf(p)) return { conflict: true };
  const now = new Date().toISOString();
  switch (body.action) {
    case 'review':
      if (p.status !== 'entwurf')
        return { invalid: 'Nur Entwürfe können zum Review gegeben werden.' };
      if (p.sperre && p.sperre.token !== body.token && p.sperre.until > Date.now()) {
        return { locked: toSperre(p.sperre, body.token) };
      }
      Object.assign(p, { status: 'review', submittedBy: LOGIN, submittedAt: now, reviewNote: '' });
      p.sperre = null;
      break;
    case 'approve':
      if (p.status !== 'entwurf' && p.status !== 'review')
        return { invalid: 'Nur Entwürfe und Protokolle im Review können freigegeben werden.' };
      if (p.createdBy === LOGIN && !body.ownConfirmed)
        return {
          invalid: 'Bestätige bitte, dass du dein eigenes Protokoll ohne zweite Person freigibst.',
        };
      if (
        p.status === 'entwurf' &&
        p.sperre &&
        p.sperre.token !== body.token &&
        p.sperre.until > Date.now()
      ) {
        return { locked: toSperre(p.sperre, body.token) };
      }
      p.sperre = null;
      Object.assign(p, {
        status: 'freigegeben',
        reviewNote: '',
        approvedBy: LOGIN,
        approvedAt: now,
        ablage: { fileName: `${p.date} ${p.title}.pdf`, webUrl: 'https://example.test/sharepoint' },
      });
      p.version++;
      p.aufgabenAngelegt = mockAufgabenHooks.create(p.id, protokollEintraege(p.inhalt));
      return { ok: { fileName: p.ablage?.fileName, aufgaben: p.aufgabenAngelegt } };
    case 'reject':
      if (p.status !== 'review') return { invalid: 'Nur Protokolle im Review können zurückgehen.' };
      if (!body.note.trim())
        return { invalid: 'Bitte kurz schreiben, was noch fehlt.', field: 'note' };
      Object.assign(p, { status: 'entwurf', reviewNote: body.note.trim() });
      p.version++;
      return { ok: { mailSent: true } };
    default:
      return { invalid: 'Unbekannte Aktion.' };
  }
  p.version++;
  return { ok: {} };
}

const MOCK_FIRST_NAMES = [
  'Lea',
  'Max',
  'Mia',
  'Ben',
  'Emma',
  'Paul',
  'Lina',
  'Jonas',
  'Ida',
  'Tom',
  'Nele',
];
const MOCK_LAST_NAMES = ['Muster', 'Beispiel', 'Probe', 'Test'];

/** Invented recipients like the CampFlow list: 21 leaders, one with the label, two only with it. */
export const MOCK_VERSAND_LIST = [
  ...Array.from({ length: 21 }, (_, i) => {
    const first = MOCK_FIRST_NAMES[i % MOCK_FIRST_NAMES.length];
    const last = MOCK_LAST_NAMES[i % MOCK_LAST_NAMES.length];
    return {
      email: `${first}.${last}${i}@example.test`.toLowerCase(),
      name: `${first} ${last}`,
      reasons:
        i === 0 ? ['Gruppe 🐦‍🔥 Leiter*in', 'Label Protokollempfang'] : ['Gruppe 🐦‍🔥 Leiter*in'],
    };
  }),
  {
    email: 'elternbeirat@example.test',
    name: 'Erika Elternbeirat',
    reasons: ['Label Protokollempfang'],
  },
  { email: 'kurat@example.test', name: 'Karl Kurat', reasons: ['Label Protokollempfang'] },
].sort((a, b) => a.email.localeCompare(b.email));

/** Number of addresses after taking out and adding, like `protokollDeliveryAddresses`. */
export function mockVersandCount(excluded: string[], extra: string[]): number {
  const addresses = new Set(
    MOCK_VERSAND_LIST.map((r) => r.email).filter((address) => !excluded.includes(address))
  );
  for (const address of extra) addresses.add(address.trim().toLowerCase());
  return addresses.size;
}

export function versandEditorProtokoll(
  id: string,
  body: {
    action: string;
    etag: string;
    version: string;
    retry: boolean;
    excluded: string[];
    extra: string[];
  }
): ReviewResult {
  const p = protokolle.get(Number(id));
  if (!p) return null;
  if (p.status !== 'freigegeben') {
    return { invalid: 'Nur freigegebene Protokolle können verschickt werden.' };
  }
  if (body.action === 'preview') {
    return {
      ok: { recipients: MOCK_VERSAND_LIST.length, version: 'mock-v1', list: MOCK_VERSAND_LIST },
    };
  }
  if (body.etag !== etagOf(p)) return { conflict: true };
  if (body.version !== 'mock-v1')
    return { invalid: 'Bitte prüf die Liste und bestätige sie erneut.' };
  const recipients = mockVersandCount(body.excluded, body.extra);
  if (recipients === 0) return { invalid: 'Es ist niemand ausgewählt.' };
  p.status = 'verschickt';
  p.versand = {
    state: 'sent',
    recipients,
    at: new Date().toISOString(),
    by: LOGIN,
  };
  p.version++;
  return { ok: { recipients } };
}
