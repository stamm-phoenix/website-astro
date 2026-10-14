import { SPERRE_SECONDS, neuerInhalt } from '../../../api/lib/protokoll-editor-model';
import type {
  ProtokollEditorDetail,
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
}

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
    status: 'entwurf',
    inhalt: structuredClone(p.inhalt),
    etag: etagOf(p),
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
    sperre: p.sperre ? toSperre(p.sperre, token) : null,
    canDelete: true,
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
        status: 'entwurf',
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

export function createEditorProtokoll(title: string, date: string): number {
  const id = nextId++;
  const now = new Date().toISOString();
  protokolle.set(id, {
    id,
    version: 1,
    title,
    date,
    inhalt: neuerInhalt(nextElement, {
      sitzungsleitung: [
        { login: 'vera.vorstand@stamm-phoenix.de', name: 'Vera Vorstand' },
        { login: '', name: 'Volker Vorstand' },
      ],
      protokollant: [{ login: LOGIN, name: NAME }],
    }),
    createdAt: now,
    createdBy: LOGIN,
    updatedAt: now,
    updatedBy: LOGIN,
    sperre: null,
    revisions: [],
  });
  return id;
}

export type SperreResult = { ok: ProtokollSaveResponse } | { locked: ProtokollSperre } | null;

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
  const result = claim(p, token, uebernehmen, aktiverPunkt);
  if ('locked' in result) return result;
  return { ok: { etag: etagOf(p), updatedAt: p.updatedAt, sperre: toSperre(result, token) } };
}

export function releaseEditorSperre(id: string, token: string): void {
  const p = protokolle.get(Number(id));
  if (p?.sperre?.token === token) p.sperre = null;
}

export type SaveResult =
  { ok: ProtokollSaveResponse } | { locked: ProtokollSperre } | { conflict: true } | null;

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
