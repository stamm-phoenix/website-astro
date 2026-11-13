import { app } from '@azure/functions';
import { getLeitende } from '../lib/leitende-list';
import { NOT_FOUND, NO_CONTENT, ok } from '../lib/pflege-api';
import {
  validateProtokollEditorCreate,
  validateProtokollEditorSave,
  validateProtokollSperre,
} from '../lib/validation/protokoll-editor';
import { getProtokollEditorAufgaben } from '../lib/protokoll-editor-aufgaben';
import {
  createEditorProtokoll,
  deleteEditorProtokoll,
  releaseSperre,
  saveEditorProtokoll,
  takeSperre,
} from '../lib/protokoll-editor';
import type { OffeneAufgabeQuelle, ProtokollPerson } from '../lib/protokoll-editor-model';
import type { Vorbelegung } from '../lib/protokoll-editor-inhalt';
import { MAX_SITZUNGSLEITUNG } from '../lib/protokoll-editor-inhalt';
import { vorbelegungFuer } from '../lib/protokoll-vorbelegung';
import { readJsonBody } from '../lib/response-utils';
import { getTaskDirectoryUsers } from '../lib/task-directory';
import { staffHandler } from '../lib/handler';
import { AREA, editorPerson, editorHandler } from '../lib/protokoll-editor-http';

/**
 * The Vorstand as preset Sitzungsleitung, with the login of the directory entry of the same
 * name; empty if the list cannot be read.
 */
async function vorstand(): Promise<ProtokollPerson[]> {
  try {
    const [leitende, users] = await Promise.all([
      getLeitende(),
      getTaskDirectoryUsers().catch(() => []),
    ]);
    const same = (a: string, b: string): boolean =>
      a.trim().localeCompare(b.trim(), 'de', { sensitivity: 'accent' }) === 0;
    return leitende
      .filter((person) => person.teams.includes('Vorstand'))
      .map((person) => ({
        login: users.find((user) => same(user.name, person.name))?.login ?? '',
        name: person.name,
      }))
      .slice(0, MAX_SITZUNGSLEITUNG);
  } catch {
    return [];
  }
}

/** The open tasks for new minutes; without them the minutes start without the item. */
async function offeneAufgaben(): Promise<OffeneAufgabeQuelle[]> {
  try {
    return (await getProtokollEditorAufgaben()).offen;
  } catch {
    return [];
  }
}

/** Data of other modules for new minutes; without it the texts start empty. */
async function vorbelegung(date: string): Promise<Vorbelegung> {
  try {
    return await vorbelegungFuer(date);
  } catch {
    return { texte: {}, naechsteSitzung: { uhrzeit: '', ort: '' } };
  }
}

/**
 * POST: new minutes with the standard agenda after the open tasks from earlier minutes, the
 * Vorstand and the writer preset, and the start of the meeting if the browser sent it.
 */
export const EditorCollection = staffHandler(AREA, async (request, _c, principal) => {
  const input = validateProtokollEditorCreate(await readJsonBody(request));
  const [person, sitzungsleitung, offen, vorlage] = await Promise.all([
    editorPerson(principal),
    vorstand(),
    offeneAufgaben(),
    vorbelegung(input.date),
  ]);
  const id = await createEditorProtokoll(
    input,
    {
      sitzungsleitung,
      protokollant: [{ login: person.login, name: person.name }],
      beginn: input.beginn,
    },
    principal.userDetails,
    offen,
    vorlage
  );
  return ok({ id }, 201);
});

/** PUT: autosave of the whole document. DELETE: a draft with its versions. */
export const EditorItem = editorHandler(async (id, request, context, principal) => {
  if (request.method === 'DELETE') {
    const deleted = await deleteEditorProtokoll(id);
    if (deleted) context.log(`[pflege] ${principal.userDetails} DELETE ${AREA} ${id}`);
    return deleted ? NO_CONTENT : NOT_FOUND;
  }
  const input = validateProtokollEditorSave(await readJsonBody(request));
  const saved = await saveEditorProtokoll(id, input, await editorPerson(principal));
  if (input.sicherung) {
    context.log(`[pflege] ${principal.userDetails} PUT ${AREA} ${id} (${input.sicherung})`);
  }
  return ok(saved);
}, true);

/**
 * POST: takes or renews the lock of the writing tab (every few seconds); `uebernehmen` takes
 * it from another tab. DELETE: gives it up when the page is left.
 */
export const EditorSperre = editorHandler(async (id, request, context, principal) => {
  const input = validateProtokollSperre(await readJsonBody(request));
  if (request.method === 'DELETE') {
    await releaseSperre(id, input.token);
    return NO_CONTENT;
  }
  const result = await takeSperre(id, input, await editorPerson(principal));
  if (input.uebernehmen)
    context.log(`[pflege] ${principal.userDetails} POST ${AREA} ${id} (übernommen)`);
  return ok(result);
}, true);

app.http('internPflegeProtokollEditor', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor',
  handler: EditorCollection,
});

app.http('internPflegeProtokollEditorItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}',
  handler: EditorItem,
});

app.http('internPflegeProtokollEditorSperre', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/sperre',
  handler: EditorSperre,
});
