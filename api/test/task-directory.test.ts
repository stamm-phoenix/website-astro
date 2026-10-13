import assert from 'node:assert/strict';
import test from 'node:test';
import * as token from '../lib/token';
import * as openai from '../lib/azure-openai';
import { getTaskDirectoryUsers } from '../lib/task-directory';
import { taskCandidates, checkedTaskAssignee } from '../lib/task-directory-matching';
import { detectProtokollTasks, parseTaskSuggestions } from '../lib/protokoll-aufgaben';
import { docx as makeDocx } from './fixtures/docx';
const katharina = {
  name: 'Katharina Muster',
  givenName: 'Katharina',
  login: 'katharina.muster@stamm-phoenix.de',
};
const sabine = {
  name: 'Sabine Beispiel',
  givenName: 'Sabine',
  login: 'sabine.beispiel@stamm-phoenix.de',
};
const users = [katharina, sabine];
for (const [name, id, quote, expected] of [
  ['Sabine', 2, 'Sabine erstellt die Flyer.', sabine],
  ['Kathi', 1, 'Kathi organisiert das Treffen.', katharina],
  ['PGR', 1, 'PGR organisiert das Treffen.', undefined],
  ['Sabine', 99, 'Sabine erstellt die Flyer.', undefined],
  ['Sabine', 1, 'Sabine erstellt die Flyer.', undefined],
  ['Sabine', 2, 'Katharina erstellt die Flyer.', undefined],
  ['Sabine', 2, 'Sabines Gruppe kommt.', undefined],
] as const) {
  test(`checked directory match: ${name}, ${id}, ${quote}`, () =>
    assert.deepEqual(checkedTaskAssignee(id, name, quote, users), expected));
}
test('ambiguous first names and short forms remain manual', () => {
  assert.equal(
    checkedTaskAssignee(2, 'Sabine', 'Sabine erstellt die Flyer.', [
      ...users,
      { ...sabine, name: 'Sabine Anders', login: 'sabine.anders@stamm-phoenix.de' },
    ]),
    undefined
  );
  assert.equal(
    checkedTaskAssignee(1, 'Kathi', 'Kathi hilft.', [
      ...users,
      { ...katharina, name: 'Katharina Anders', login: 'katharina.anders@stamm-phoenix.de' },
    ]),
    undefined
  );
});
test('candidate payload contains only ephemeral indexes and names', () => {
  assert.deepEqual(taskCandidates(users), [
    { id: 1, displayName: katharina.name, givenName: katharina.givenName },
    { id: 2, displayName: sabine.name, givenName: sabine.givenName },
  ]);
  assert.equal(JSON.stringify(taskCandidates(users)).includes('@'), false);
});
test('parsing preserves the quoted short name and never trusts model-provided login arrays', () => {
  const quote = 'Kathi organisiert das Treffen.';
  const raw = {
    title: 'Treffen',
    description: '',
    assignee: 'Kathi',
    assigneeId: 1,
    dueDate: null,
    quote,
    assignees: [{ name: 'Injected', login: 'injected@stamm-phoenix.de' }],
  };
  const result = parseTaskSuggestions({ tasks: [raw] }, quote, users)[0];
  assert.equal(result.assignee, 'Kathi');
  assert.deepEqual(result.assignees, [{ name: katharina.name, login: katharina.login }]);
  assert.deepEqual(
    parseTaskSuggestions({ tasks: [{ ...raw, assigneeId: 999 }] }, quote, users)[0].assignees,
    [{ name: 'Kathi', login: '' }]
  );
});
test('Graph follows pages and excludes guests, disabled accounts and mailbox identities', async (t) => {
  const paths: string[] = [];
  const raw = {
    displayName: katharina.name,
    givenName: katharina.givenName,
    surname: 'Muster',
    userPrincipalName: katharina.login,
    accountEnabled: true,
    userType: 'Member',
  };
  t.mock.method(token, 'getClient', () => ({
    api: (path: string) => {
      paths.push(path);
      return {
        option: () => ({
          get: async () =>
            paths.length === 1
              ? {
                  value: [
                    raw,
                    {
                      ...raw,
                      accountEnabled: false,
                      userPrincipalName: 'disabled@stamm-phoenix.de',
                    },
                    { ...raw, userType: 'Guest', userPrincipalName: 'guest@stamm-phoenix.de' },
                    { ...raw, givenName: '', userPrincipalName: 'kontakt@stamm-phoenix.de' },
                  ],
                  '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=next',
                }
              : {
                  value: [
                    {
                      ...raw,
                      displayName: sabine.name,
                      givenName: sabine.givenName,
                      userPrincipalName: sabine.login,
                    },
                  ],
                },
        }),
      };
    },
  }));
  assert.deepEqual(await getTaskDirectoryUsers(), users);
  assert.equal(paths.length, 2);
  assert.ok(paths[0].startsWith('/users?'));
});
test('model receives directory names without logins', async (t) => {
  t.mock.method(openai, 'isDeploymentConfigured', () => true);
  const request = t.mock.method(openai, 'requestStructuredOutput', async () => ({ tasks: [] }));
  await detectProtokollTasks(
    makeDocx('<w:p><w:r><w:t>Kathi organisiert das Treffen.</w:t></w:r></w:p>'),
    '2026-10-13',
    [],
    users
  );
  const sent = request.mock.calls[0].arguments[1];
  assert.ok(sent);
  const payload = JSON.parse(String(sent.messages[1].content));
  assert.deepEqual(payload.candidates, taskCandidates(users));
  assert.equal(JSON.stringify(payload.candidates).includes('@'), false);
});
