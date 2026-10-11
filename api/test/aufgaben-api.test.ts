import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AufgabeItemEndpoint,
  AufgabenChecklistEndpoint,
  AufgabenCollectionEndpoint,
  AufgabenDecisionEndpoint,
  AufgabenProjectEndpoint,
  AufgabenRecognizeEndpoint,
  AufgabenTemplateEndpoint,
} from '../endpoints/intern-pflege-aufgaben';
import * as tasks from '../lib/aufgaben';
import * as extraction from '../lib/protokoll-aufgaben';
import * as graph from '../lib/sharepoint-data-access';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import {
  AUTHOR,
  REVIEWER,
  request,
  setupLegacyProtokolle,
  driveItem,
  ETAG,
} from './fixtures/protokolle';
import { docxContentVersion } from '../lib/protokoll-content-version';
import { docx as makeDocx } from './fixtures/docx';

const input = {
  title: 'Zelte prüfen',
  description: '',
  assignee: '',
  dueDate: null,
  projectId: null,
};
const proposal = {
  ...input,
  id: 1,
  etag: '"0000000000000001"',
  state: 'vorschlag' as const,
  sourceId: 'P1',
  sourceVersion: 'old-version',
  quote: 'Zelte prüfen.',
};

test('all task endpoints reject anonymous access before any data calls', async (t) => {
  const context = setupLegacyProtokolle(t);
  for (const handler of [
    AufgabeItemEndpoint,
    AufgabenChecklistEndpoint,
    AufgabenCollectionEndpoint,
    AufgabenDecisionEndpoint,
    AufgabenProjectEndpoint,
    AufgabenRecognizeEndpoint,
    AufgabenTemplateEndpoint,
  ]) {
    assert.equal((await handler(request('POST', {}, { principal: null }), context)).status, 401);
  }
});
test('ordinary staff cannot invoke or accept AI suggestions', async (t) => {
  const context = setupLegacyProtokolle(t);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  assert.equal(
    (await AufgabenRecognizeEndpoint(request('POST', {}, { principal: AUTHOR }), context)).status,
    403
  );
  assert.equal(
    (await AufgabenDecisionEndpoint(request('POST', {}, { principal: AUTHOR }), context)).status,
    403
  );
});
test('the tasks response exposes reviewer permission independently of protocol loading', async (t) => {
  const context = setupLegacyProtokolle(t);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  t.mock.method(tasks, 'getTasks', async () => [proposal]);
  t.mock.method(tasks, 'getTaskProjects', async () => []);
  t.mock.method(tasks, 'getTaskTemplates', async () => []);
  const graphRead = t.mock.method(graph, 'getSharePointDriveItemWithFields', async () => {
    throw new Error('SharePoint unavailable');
  });
  for (const principal of [AUTHOR, REVIEWER]) {
    const response = await AufgabenCollectionEndpoint(request('GET', undefined, { principal }), context);
    assert.equal(response.status, 200);
    assert.equal((response.jsonBody as { reviewer: boolean }).reviewer, principal === REVIEWER);
  }
  t.mock.method(tasks, 'getTask', async () => proposal);
  const decide = t.mock.method(tasks, 'decideTaskSuggestion', async () => undefined);
  const response = await AufgabenDecisionEndpoint(
    request('POST', { action: 'ablehnen', etag: proposal.etag }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 204);
  assert.equal(decide.mock.callCount(), 1);
  assert.equal(graphRead.mock.callCount(), 0);
});
test('disabled extraction never downloads a protocol', async (t) => {
  const context = setupLegacyProtokolle(t);
  overrideConfig(t, CONFIG.protokolle.aufgaben, { maxExtractionsPerDay: 0 });
  const download = t.mock.method(graph, 'getSharePointDriveFileContent', async () => {
    throw new Error('must not download');
  });
  assert.equal(
    (await AufgabenRecognizeEndpoint(request('POST', {}, { principal: REVIEWER }), context)).status,
    400
  );
  assert.equal(download.mock.callCount(), 0);
});
test('accepting a suggestion from an outdated source conflicts; rejecting it needs no source download', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'getTask', async () => proposal);
  const docx = makeDocx('<w:p><w:r><w:t>Neuer Inhalt</w:t></w:r></w:p>');
  const version = docxContentVersion(docx);
  t.mock.method(graph, 'getSharePointDriveItemWithFields', async () =>
    driveItem({ Status: 'Archiv' }, { contentVersion: version })
  );
  const decide = t.mock.method(tasks, 'decideTaskSuggestion', async () => undefined);
  const response = await AufgabenDecisionEndpoint(
    request(
      'POST',
      { ...input, action: 'annehmen', etag: proposal.etag },
      { id: '1', principal: REVIEWER }
    ),
    context
  );
  assert.equal(response.status, 409);
  assert.equal(decide.mock.callCount(), 0);
  const reject = await AufgabenDecisionEndpoint(
    request('POST', { action: 'ablehnen', etag: proposal.etag }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(reject.status, 204);
  assert.equal(decide.mock.callCount(), 1);
});
test('a document change during recognition prevents storing any suggestions', async (t) => {
  const context = setupLegacyProtokolle(t);
  const docx = makeDocx('<w:p><w:r><w:t>Alex prüft die Zelte.</w:t></w:r></w:p>');
  const version = docxContentVersion(docx);
  let item = driveItem({ Status: 'Archiv' }, { contentVersion: version });
  t.mock.method(graph, 'getSharePointDriveItemWithFields', async () => item);
  t.mock.method(graph, 'getSharePointDriveFileContent', async () => docx);
  t.mock.method(extraction, 'detectProtokollTasks', async () => {
    item = { ...item, contentVersion: 'changed-version' };
    return [{ ...input, quote: 'Alex prüft die Zelte.' }];
  });
  const store = t.mock.method(tasks, 'storeTaskSuggestions', async () => 1);
  const result = await AufgabenRecognizeEndpoint(
    request('POST', { etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(result.status, 409);
  assert.equal(store.mock.callCount(), 0);
});
