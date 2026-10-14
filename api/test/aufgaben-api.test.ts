import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AufgabeItemEndpoint,
  AufgabenChecklistEndpoint,
  AufgabenCollectionEndpoint,
  AufgabenUsersEndpoint,
  AufgabenAssignmentEndpoint,
  AufgabenDecisionEndpoint,
  AufgabenProjectEndpoint,
  AufgabenRecognizeEndpoint,
  AufgabenTemplateEndpoint,
} from '../endpoints/intern-pflege-aufgaben';
import * as tasks from '../lib/aufgaben';
import * as extraction from '../lib/protokoll-aufgaben';
import * as graph from '../lib/sharepoint-data-access';
import * as sharepointRest from '../lib/task-directory';
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

test.beforeEach((t) => {
  if ('mock' in t) t.mock.method(tasks, 'getTaskProjects', async () => []);
});

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
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  for (const handler of [
    AufgabeItemEndpoint,
    AufgabenChecklistEndpoint,
    AufgabenCollectionEndpoint,
    AufgabenUsersEndpoint,
    AufgabenAssignmentEndpoint,
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
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  assert.equal(
    (await AufgabenRecognizeEndpoint(request('POST', {}, { principal: AUTHOR }), context)).status,
    403
  );
  assert.equal(
    (await AufgabenDecisionEndpoint(request('POST', {}, { principal: AUTHOR }), context)).status,
    403
  );
  assert.equal(
    (await AufgabenAssignmentEndpoint(request('POST', {}, { principal: AUTHOR }), context)).status,
    403
  );
});
test('existing proposals resolve @tags without modifying tasks or loading the source document', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  const tagged = {
    ...proposal,
    assignee: 'Mara Bertram',
    quote: '@Mara Bertram erstellt die Flyer.',
  };
  t.mock.method(tasks, 'getTask', async () => tagged);
  const users = t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => [
    { name: 'Mara Bertram', givenName: 'Mara', login: 'mara@example.test' },
  ]);
  const response = await AufgabenAssignmentEndpoint(
    request('POST', { etag: tagged.etag }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { assignee: 'mara@example.test', unavailable: false });
  assert.equal(tagged.assignee, 'Mara Bertram');
  const stale = await AufgabenAssignmentEndpoint(
    request('POST', { etag: 'old' }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(stale.status, 409);
  assert.equal(users.mock.callCount(), 1);
});
test('unavailable tag resolution leaves review and rejection usable', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  t.mock.method(tasks, 'getTask', async () => ({
    ...proposal,
    assignee: 'Mara Bertram',
    quote: '@Mara Bertram erstellt die Flyer.',
  }));
  t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => {
    throw new Error('Unavailable');
  });
  const response = await AufgabenAssignmentEndpoint(
    request('POST', { etag: proposal.etag }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { assignee: null, unavailable: true });
  const decide = t.mock.method(tasks, 'decideTaskSuggestion', async () => undefined);
  const reject = await AufgabenDecisionEndpoint(
    request('POST', { action: 'ablehnen', etag: proposal.etag }, { id: '1', principal: REVIEWER }),
    context
  );
  assert.equal(reject.status, 204);
  assert.equal(decide.mock.callCount(), 1);
});
test('the tasks response exposes reviewer permission independently of protocol loading', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  t.mock.method(tasks, 'getTasks', async () => [proposal]);
  if ('mock' in t) t.mock.method(tasks, 'getTaskProjects', async () => []);
  t.mock.method(tasks, 'getTaskTemplates', async () => []);
  const graphRead = t.mock.method(graph, 'getSharePointDriveItem', async () => {
    throw new Error('SharePoint unavailable');
  });
  for (const principal of [AUTHOR, REVIEWER]) {
    const response = await AufgabenCollectionEndpoint(
      request('GET', undefined, { principal }),
      context
    );
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
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
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
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  t.mock.method(tasks, 'getTask', async () => proposal);
  const docx = makeDocx('<w:p><w:r><w:t>Neuer Inhalt</w:t></w:r></w:p>');
  const version = docxContentVersion(docx);
  t.mock.method(graph, 'getSharePointDriveItem', async () =>
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
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  const docx = makeDocx('<w:p><w:r><w:t>Alex prüft die Zelte.</w:t></w:r></w:p>');
  const version = docxContentVersion(docx);
  let item = driveItem({ Status: 'Archiv' }, { contentVersion: version });
  t.mock.method(graph, 'getSharePointDriveItem', async () => item);
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

for (const unavailable of [false, true]) {
  test(`recognition stores ${unavailable ? 'the original name when identities are unavailable' : 'a uniquely tagged staff login'}`, async (t) => {
    const context = setupLegacyProtokolle(t);
    t.mock.method(tasks, 'hasTaskRecognition', async () => false);
    const docx = makeDocx('<w:p><w:r><w:t>@Mara Bertram erstellt die Flyer.</w:t></w:r></w:p>');
    const version = docxContentVersion(docx);
    t.mock.method(graph, 'getSharePointDriveItem', async () =>
      driveItem({ Status: 'Archiv' }, { contentVersion: version })
    );
    t.mock.method(graph, 'getSharePointDriveFileContent', async () => docx);
    t.mock.method(
      extraction,
      'detectProtokollTasks',
      async (...args: Parameters<typeof extraction.detectProtokollTasks>) =>
        extraction.parseTaskSuggestions(
          {
            tasks: [
              {
                ...input,
                assignee: 'Mara Bertram',
                assigneeId: 1,
                quote: '@Mara Bertram erstellt die Flyer.',
              },
            ],
          },
          '@Mara Bertram erstellt die Flyer.',
          args[3]
        )
    );
    t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => {
      if (unavailable) throw new Error('Unavailable');
      return [{ name: 'Mara Bertram', givenName: 'Mara', login: 'mara@example.test' }];
    });
    const store = t.mock.method(tasks, 'storeTaskSuggestions', async () => 1);
    const response = await AufgabenRecognizeEndpoint(
      request('POST', { etag: ETAG }, { id: 'P1', principal: REVIEWER }),
      context
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, { count: 1, assignmentUnavailable: unavailable });
    assert.equal(store.mock.callCount(), 1);
    assert.equal(
      store.mock.calls[0]?.arguments[2]?.[0]?.assignees?.[0]?.login,
      unavailable ? '' : 'mara@example.test'
    );
  });
}

test('recognition discards past deadlines using the current Berlin day, not the session date', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => []);
  // UTC still says October 11, while Germany has already reached October 12.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-11T22:30:00Z') });
  const docx = makeDocx('<w:p><w:r><w:t>Die Zelte prüfen.</w:t></w:r></w:p>');
  const version = docxContentVersion(docx);
  t.mock.method(graph, 'getSharePointDriveItem', async () =>
    driveItem({ Status: 'Archiv' }, { contentVersion: version })
  );
  t.mock.method(graph, 'getSharePointDriveFileContent', async () => docx);
  t.mock.method(extraction, 'detectProtokollTasks', async () =>
    ['2026-09-13', '2026-10-11', '2026-10-12', '2026-10-13', null].map((dueDate) => ({
      ...input,
      dueDate,
      quote: 'Die Zelte prüfen.',
    }))
  );
  const store = t.mock.method(
    tasks,
    'storeTaskSuggestions',
    async (...args: Parameters<typeof tasks.storeTaskSuggestions>) => args[2].length
  );
  const response = await AufgabenRecognizeEndpoint(
    request('POST', { etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { count: 3, assignmentUnavailable: false });
  assert.deepEqual(
    store.mock.calls[0]?.arguments[2]?.map((item) => item.dueDate),
    ['2026-10-12', '2026-10-13', null]
  );
});

test('ordinary staff receive sorted, unique autocomplete identities without reviewer permission', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  const hugo = { name: 'Hugo Beispiel', login: 'hugo.beispiel@stamm-phoenix.de' };
  const alex = { name: 'Alex Beispiel', login: 'alex.beispiel@stamm-phoenix.de' };
  t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => [hugo, alex, hugo]);
  const result = await AufgabenUsersEndpoint(
    request('GET', undefined, { principal: AUTHOR }),
    context
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.jsonBody, { users: [alex, hugo], unavailable: false });
});
test('autocomplete failure offers manual entry without exposing provider errors', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => {
    throw new Error('Internal provider details');
  });
  const result = await AufgabenUsersEndpoint(
    request('GET', undefined, { principal: AUTHOR }),
    context
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.jsonBody, { users: [], unavailable: true });
});

test('project deletion is staff-only, parses IDs and forwards the required If-Match', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  const remove = t.mock.method(tasks, 'deleteTaskProject', async () => undefined);
  assert.equal(
    (
      await AufgabenProjectEndpoint(
        request('DELETE', undefined, { id: '1', principal: null }),
        context
      )
    ).status,
    401
  );
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(
    (await AufgabenProjectEndpoint(request('DELETE', undefined, { id: 'invalid' }), context))
      .status,
    404
  );
  assert.equal(
    (await AufgabenProjectEndpoint(request('DELETE', undefined, { id: '12', etag: ETAG }), context))
      .status,
    204
  );
  assert.deepEqual(remove.mock.calls[0].arguments, [12, ETAG, AUTHOR.userDetails]);
});

test('creating a project during review needs a stored project idea and a nonempty explicit title', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(tasks, 'hasTaskRecognition', async () => false);
  t.mock.method(tasks, 'getTask', async () => proposal);
  const decide = t.mock.method(tasks, 'decideTaskSuggestion', async () => undefined);
  for (const newProjectTitle of ['', 'Neues Projekt']) {
    const result = await AufgabenDecisionEndpoint(
      request(
        'POST',
        { ...input, action: 'annehmen', etag: proposal.etag, newProjectTitle },
        { id: '1', principal: REVIEWER }
      ),
      context
    );
    assert.equal(result.status, 400);
  }
  assert.equal(decide.mock.callCount(), 0);
});

test('completed recognition returns before downloading Word or invoking the model', async (t) => {
  const context = setupLegacyProtokolle(t);
  const docx = makeDocx('<w:p><w:r><w:t>Keine Aufgaben.</w:t></w:r></w:p>');
  t.mock.method(graph, 'getSharePointDriveItem', async () =>
    driveItem({ Status: 'Archiv' }, { contentVersion: docxContentVersion(docx) })
  );
  t.mock.method(tasks, 'hasTaskRecognition', async () => true);
  const download = t.mock.method(graph, 'getSharePointDriveFileContent', async () => docx);
  const detect = t.mock.method(extraction, 'detectProtokollTasks', async () => []);
  const result = await AufgabenRecognizeEndpoint(
    request('POST', { etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.jsonBody, { count: 0, assignmentUnavailable: false });
  assert.equal(download.mock.callCount(), 0);
  assert.equal(detect.mock.callCount(), 0);
});

for (const resolution of ['declined', 'matched'] as const) {
  test(`stored ${resolution} assignment never re-runs directory matching`, async (t) => {
    const context = setupLegacyProtokolle(t);
    t.mock.method(tasks, 'getTask', async () => ({
      ...proposal,
      assignee: 'Kathi',
      assignmentResolution: resolution,
      assignees: [
        {
          name: 'Katharina Muster',
          login: resolution === 'matched' ? 'katharina@example.test' : '',
        },
      ],
    }));
    const directory = t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => {
      throw new Error('Must not match again');
    });
    const response = await AufgabenAssignmentEndpoint(
      request('POST', { etag: proposal.etag }, { id: '1', principal: REVIEWER }),
      context
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, {
      assignee: resolution === 'matched' ? 'katharina@example.test' : null,
      unavailable: false,
    });
    assert.equal(directory.mock.callCount(), 0);
  });
}

test('permission-limited directory reports configuration failure to the picker', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(sharepointRest, 'getTaskDirectoryUsers', async () => {
    throw new sharepointRest.TaskDirectoryConfigurationError();
  });
  const response = await AufgabenUsersEndpoint(
    request('GET', undefined, { principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { users: [], unavailable: true, configurationError: true });
});
