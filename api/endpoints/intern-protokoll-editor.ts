import { app } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND } from '../lib/pflege-api';
import { getProtokollEditorAufgaben } from '../lib/protokoll-editor-aufgaben';
import {
  getEditorLive,
  getEditorOverview,
  getEditorProtokoll,
  getRevision,
  listRevisions,
} from '../lib/protokoll-editor';
import type { ProtokollEditorPersonen } from '../lib/protokoll-editor-model';
import { NO_STORE_HEADERS } from '../lib/response-utils';
import { loadEditorPersonen } from '../lib/protokoll-editor-personen';
import { staffHandler } from '../lib/handler';
import { AREA, readToken } from '../lib/protokoll-editor-http';

/**
 * Protokoll-Editor (#277, `docs/protokoll-editor.md`): every logged-in leader may read all
 * minutes and write a draft while holding its lock. Logs name only IDs and actions, never
 * the text of the minutes; autosave and lock renewals are not logged at all.
 */

/** GET: all minutes of the editor, newest first, with who is writing. */
export const GetEditorOverview = staffHandler(AREA, async () => {
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await getEditorOverview() };
});

/** GET: one set of minutes. */
export const GetEditorProtokoll = staffHandler(AREA, async (request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const detail = await getEditorProtokoll(id, readToken(request));
  return detail ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: detail } : NOT_FOUND;
});

/**
 * GET `?etag=`: the live check of the readers, every few seconds. Sends the minutes only if
 * they changed since `etag`.
 */
export const GetEditorLive = staffHandler(AREA, async (request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  const live = await getEditorLive(id, request.query.get('etag') ?? '', readToken(request));
  return live ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: live } : NOT_FOUND;
});

/** GET: the kept versions of one set of minutes, newest first. */
export const GetEditorRevisions = staffHandler(AREA, async (request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await listRevisions(id) };
});

/** GET: one kept version with its content. */
export const GetEditorRevision = staffHandler(AREA, async (request) => {
  const id = parseId(request.params.id ?? '');
  const revisionId = parseId(request.params.revisionId ?? '');
  if (id === undefined || revisionId === undefined) return NOT_FOUND;
  const revision = await getRevision(id, revisionId);
  return revision ? { status: 200, headers: NO_STORE_HEADERS, jsonBody: revision } : NOT_FOUND;
});

/** GET: the people to pick in the minutes and to mention with `@` (`loadEditorPersonen`). */
export const GetEditorPersonen = staffHandler(AREA, async () => {
  const body: ProtokollEditorPersonen = await loadEditorPersonen();
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
});

/**
 * GET: the projects and open tasks of the module Aufgaben, to link projects to agenda items and
 * show their open tasks (#277, step 3).
 */
export const GetEditorAufgaben = staffHandler(AREA, async () => {
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await getProtokollEditorAufgaben() };
});

app.http('internProtokollEditor', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor',
  handler: GetEditorOverview,
});

app.http('internProtokollEditorPersonen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor-personen',
  handler: GetEditorPersonen,
});

app.http('internProtokollEditorAufgaben', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor-aufgaben',
  handler: GetEditorAufgaben,
});

app.http('internProtokollEditorItem', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}',
  handler: GetEditorProtokoll,
});

app.http('internProtokollEditorLive', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/live',
  handler: GetEditorLive,
});

app.http('internProtokollEditorVersionen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/versionen',
  handler: GetEditorRevisions,
});

app.http('internProtokollEditorVersion', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/versionen/{revisionId}',
  handler: GetEditorRevision,
});
