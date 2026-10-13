import { CONFIG } from '../lib/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as token from '../lib/token';
import * as openai from '../lib/azure-openai';
import {
  readTaskDirectory,
  createTaskDirectoryCache,
  TaskDirectoryConfigurationError,
} from '../lib/task-directory';
import {
  taskCandidates,
  checkedTaskAssignee,
  matchTaskAssignee,
} from '../lib/task-directory-matching';
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
  ['Sabine', 2, 'Sabine Anders (Pfarrei) bucht den Saal.', undefined],
  ['Sabine', 2, 'Sabine Beispiel bucht den Saal.', sabine],
  ['Sabine', 2, 'Sabine von Anders bucht den Saal.', undefined],
  ['Sabine', 2, 'Sabine hilft. Sabine Anders bucht den Saal.', undefined],
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
  assert.equal(result.assignmentResolution, 'matched');
  assert.equal(
    parseTaskSuggestions({ tasks: [{ ...raw, assigneeId: null }] }, quote, users)[0]
      .assignmentResolution,
    'declined'
  );
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
        header: (name: string, value: string) => {
          assert.equal(name, 'ConsistencyLevel');
          assert.equal(value, 'eventual');
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
                      '@odata.nextLink': `https://graph.microsoft.com/v1.0/groups/${CONFIG.taskDirectory.groupId}/transitiveMembers/microsoft.graph.user?$skiptoken=next`,
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
      };
    },
  }));
  assert.deepEqual(await readTaskDirectory(), users);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /accountEnabled,userType/);
  assert.match(paths[0], /\$count=true/);
  assert.ok(
    paths[0].startsWith(
      `/groups/${CONFIG.taskDirectory.groupId}/transitiveMembers/microsoft.graph.user?`
    )
  );
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

test('partial hyphenated and apostrophe names are never assigned with or without a model index', () => {
  const anna = { name: 'Anna Schmidt', givenName: 'Anna', login: 'anna.schmidt@stamm-phoenix.de' };
  const directory = [
    anna,
    { name: 'Anna-Lena Meier', givenName: 'Anna-Lena', login: 'anna-lena.meier@stamm-phoenix.de' },
  ];
  for (const quote of [
    'Anna-Lena erstellt die Flyer.',
    'D’Anna erstellt die Flyer.',
    "D'Anna erstellt die Flyer.",
  ]) {
    assert.equal(checkedTaskAssignee(1, 'Anna', quote, directory), undefined);
    assert.equal(matchTaskAssignee('Anna', quote, directory), undefined);
  }
  assert.equal(
    matchTaskAssignee('Sabine', 'Sabine Anders (Pfarrei) bucht den Saal.', users),
    undefined
  );
});
for (const nextLink of [
  false,
  42,
  'https://example.test/users',
  'https://graph.microsoft.com/v1.0/users',
]) {
  test(`directory rejects invalid continuation ${String(nextLink)}`, async (t) => {
    let calls = 0;
    t.mock.method(token, 'getClient', () => ({
      api: () => ({
        header: (name: string, value: string) => {
          assert.equal(name, 'ConsistencyLevel');
          assert.equal(value, 'eventual');
          return {
            option: () => ({
              get: async () => {
                calls++;
                return { value: [], '@odata.nextLink': nextLink };
              },
            }),
          };
        },
      }),
    }));
    await assert.rejects(readTaskDirectory(), /continuation/);
    assert.equal(calls, 1);
  });
}
test('directory timeout rejects even when Graph middleware never resolves', async (t) => {
  const controller = new AbortController();
  t.mock.method(token, 'getClient', () => ({
    api: () => ({ header: () => ({ option: () => ({ get: () => new Promise(() => {}) }) }) }),
  }));
  const result = readTaskDirectory(controller.signal);
  controller.abort();
  await assert.rejects(result, /timed out/);
});
test('cache coalesces callers, returns defensive copies and has a bounded outage grace period', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  let fail = false;
  const get = createTaskDirectoryCache(async () => {
    calls++;
    if (fail) throw new Error('Graph unavailable');
    return users;
  });
  const [first, second] = await Promise.all([get(), get()]);
  assert.equal(calls, 1);
  first[0].name = 'changed';
  assert.equal(second[0].name, katharina.name);
  now = 299_000;
  await get();
  assert.equal(calls, 1);
  now = 301_000;
  fail = true;
  assert.deepEqual(await get(), users);
  assert.equal(calls, 2);
  now = 310_000;
  await get();
  assert.equal(calls, 2);
  now = 601_000;
  await assert.rejects(get(), /unavailable/);
});

for (const value of [
  [],
  [{ id: 'only-id', displayName: null }],
  [
    {
      displayName: 'Test Person',
      userPrincipalName: 'test.person@stamm-phoenix.de',
      givenName: 'Test',
      surname: 'Person',
      userType: 'Member',
    },
  ],
]) {
  test('empty or permission-limited directory fails as a configuration error', async (t) => {
    t.mock.method(token, 'getClient', () => ({
      api: () => ({ header: () => ({ option: () => ({ get: async () => ({ value }) }) }) }),
    }));
    await assert.rejects(readTaskDirectory(), TaskDirectoryConfigurationError);
  });
}
test('configuration failures do not serve a previous directory snapshot', async (t) => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const cached = createTaskDirectoryCache(async () => {
    if (now) throw new TaskDirectoryConfigurationError();
    return users;
  });
  await cached();
  now = 301000;
  await assert.rejects(cached(), TaskDirectoryConfigurationError);
});

test('one incomplete member does not hide the usable directory', async (t) => {
  t.mock.method(token, 'getClient', () => ({
    api: () => ({
      header() {
        return this;
      },
      option() {
        return this;
      },
      async get() {
        return {
          value: [
            { id: 'missing', displayName: null },
            {
              displayName: 'Alex Beispiel',
              givenName: 'Alex',
              surname: 'Beispiel',
              userPrincipalName: 'alex.beispiel@stamm-phoenix.de',
              accountEnabled: true,
              userType: 'Member',
            },
          ],
        };
      },
    }),
  }));
  assert.deepEqual(await readTaskDirectory(), [
    { name: 'Alex Beispiel', givenName: 'Alex', login: 'alex.beispiel@stamm-phoenix.de' },
  ]);
});
