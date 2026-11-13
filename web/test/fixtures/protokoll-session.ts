/** A Protokoll editor session against a stubbed API, for the unit tests of saving and the lock. */
import { neuerInhalt } from '../../../api/lib/protokoll-editor-model';
import type {
  ProtokollEditorDetail,
  ProtokollSperre,
} from '../../../api/lib/protokoll-editor-model';
import { ApiError } from '../../src/lib/apiError';
import {
  ProtokollEditorSession,
  type NoticeKind,
} from '../../src/lib/protokollEditorSession.svelte';
import { FakeClock, memoryStorage, settle } from './fake-clock';
import { json, stubFetch, type StubAnswer, type StubbedCall } from './fetch-stub';

export const LOGIN = 'lea@example.org';
export const ID = 7;

export function sperre(mine: boolean, aktiverPunkt: string | null = null): ProtokollSperre {
  return {
    login: mine ? LOGIN : 'anna@example.org',
    name: mine ? 'Lea' : 'Anna',
    since: '2026-11-13T09:00:00Z',
    until: '2026-11-13T09:01:00Z',
    aktiverPunkt,
    mine,
    expired: false,
  };
}

export function detail(
  etag: string,
  overrides: Partial<ProtokollEditorDetail> = {}
): ProtokollEditorDetail {
  let next = 0;
  return {
    id: ID,
    title: 'Leiterrunde',
    date: '2026-11-13',
    status: 'entwurf',
    inhalt: neuerInhalt(() => `p${next++}`),
    etag,
    createdAt: '2026-11-13T08:00:00Z',
    createdBy: LOGIN,
    updatedAt: '2026-11-13T08:30:00Z',
    updatedBy: LOGIN,
    sperre: null,
    canDelete: true,
    submittedBy: '',
    submittedAt: '',
    reviewNote: '',
    approvedBy: '',
    approvedAt: '',
    ablage: null,
    ...overrides,
  } as ProtokollEditorDetail;
}

/** An error answer of the API as `sendApi` turns it into an `ApiError`. */
export function failure(status: number, message = 'Fehler', code?: string): Response {
  return json({ message, ...(code ? { code } : {}) }, status);
}

export interface Server {
  /** The minutes as the server has them. */
  stored: ProtokollEditorDetail;
  /** Answer to a save; by default it is accepted with a new version. */
  save: (call: StubbedCall) => StubAnswer;
  /** Answer to taking or renewing the lock. */
  lock: (call: StubbedCall) => StubAnswer;
  live: (call: StubbedCall) => StubAnswer;
}

export interface Harness {
  session: ProtokollEditorSession;
  clock: FakeClock;
  server: Server;
  calls: StubbedCall[];
  notices: { text: string; kind: NoticeKind }[];
  followed: string[];
  /** Saves sent to the server, with their body. */
  saves(): Record<string, unknown>[];
  /** Changes the document as the editor would and reports the change like its effect. */
  edit(change: (stand: NonNullable<ProtokollEditorSession['stand']>) => void): void;
  close(): void;
}

export function harness(): Harness {
  const local = memoryStorage();
  const tab = memoryStorage();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.localStorage = local;
  globals.sessionStorage = tab;
  const clock = new FakeClock();
  let version = 1;
  const server: Server = {
    stored: detail('v1'),
    save: () => {
      version++;
      server.stored = { ...server.stored, etag: `v${version}` };
      return json({
        etag: server.stored.etag,
        updatedAt: '2026-11-13T09:00:00Z',
        sperre: sperre(true),
      });
    },
    lock: () =>
      json({ etag: server.stored.etag, updatedAt: server.stored.updatedAt, sperre: sperre(true) }),
    live: () => json({ etag: server.stored.etag, sperre: server.stored.sperre, protokoll: null }),
  };
  const stub = stubFetch((call) => {
    const base = `/intern/pflege/protokoll-editor/${ID}`;
    if (call.method === 'GET' && call.path === `/intern/protokoll-editor/${ID}`) {
      return json(server.stored);
    }
    if (call.method === 'GET' && call.path.startsWith(`/intern/protokoll-editor/${ID}/live`)) {
      return server.live(call);
    }
    if (call.method === 'PUT' && call.path === base) return server.save(call);
    if (call.method === 'POST' && call.path === `${base}/sperre`) return server.lock(call);
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    throw new ApiError(500, `Unerwartet: ${call.method} ${call.path}`);
  });
  const notices: Harness['notices'] = [];
  const followed: string[] = [];
  const session = new ProtokollEditorSession({
    notify: (text, kind = 'success') => notices.push({ text, kind }),
    settle: () => Promise.resolve(),
    beforeStart: () => Promise.resolve(),
    follow: async (punktId) => void followed.push(punktId),
    login: () => LOGIN,
    loadLogin: () => Promise.resolve(),
    visible: () => true,
    clock,
  });
  return {
    session,
    clock,
    server,
    calls: stub.calls,
    notices,
    followed,
    saves: () =>
      stub.calls
        .filter((call) => call.method === 'PUT')
        .map((call) => call.body as Record<string, unknown>),
    edit: (change) => {
      if (!session.stand) throw new Error('Not writing');
      change(session.stand);
      const snapshot = session.snapshot();
      if (snapshot) session.speicherung.edited(snapshot);
    },
    close: () => {
      session.close();
      stub.restore();
      delete globals.localStorage;
      delete globals.sessionStorage;
    },
  };
}

/** Opens the minutes and waits until the editor is open or reading. */
export async function opened(h: Harness, wantsToWrite = true): Promise<void> {
  h.session.open(ID, wantsToWrite);
  await settle();
}
