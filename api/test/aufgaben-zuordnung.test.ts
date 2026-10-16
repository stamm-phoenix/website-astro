import assert from 'node:assert/strict';
import test from 'node:test';
import {
  taggedTaskAssignee,
  taskAssigneeLogin,
  taskAssignedToLogin,
  taskPeople,
  taskHasAssignee,
  taskAssigneeNames,
} from '../lib/aufgaben-zuordnung';

const users = [{ name: 'Mara Bertram', login: 'mara@example.test' }];

test('explicit tagged responsibility resolves to a real login, preserving ambiguous names', () => {
  const task = { assignee: 'Mara Bertram', quote: 'Öffis @Mara Bertram Flyer bis zum 18.09.2026' };
  assert.equal(taggedTaskAssignee(task, users), 'mara@example.test');
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: '@MARA  BERTRAM' }, users),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: 'mara@example.test' }, users),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee(task, [...users, { name: 'Mara Bertram', login: 'another@example.test' }]),
    undefined
  );
  assert.equal(taggedTaskAssignee(task, [...users, ...users]), 'mara@example.test');
});
test('tags alone, participants, nicknames and partial names never invent an owner', () => {
  const task = { assignee: 'Mara Bertram', quote: '@Mara Bertram erstellt Flyer.' };
  assert.equal(taggedTaskAssignee({ ...task, assignee: '' }, users), undefined);
  assert.equal(taggedTaskAssignee({ ...task, assignee: 'Mara' }, users), undefined);
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: 'Mara Bertram und Flo Feraud' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: 'Mara Bertram erstellt Flyer.' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: '@Mara Bertramm erstellt Flyer.' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: 'mail@Mara Bertram erstellt Flyer.' }, users),
    undefined
  );
});
test('explicit responsibility still matches when the quote mentions other participants', () => {
  const roster = [...users, { name: 'Flo Feraud', login: 'flo@example.test' }];
  assert.equal(
    taggedTaskAssignee(
      { assignee: 'Mara Bertram', quote: '@Mara Bertram erstellt Flyer, @Flo Feraud nimmt teil.' },
      roster
    ),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee(
      { assignee: '', quote: 'Abschlussgrillen: @Mara Bertram und @Flo Feraud nehmen teil.' },
      roster
    ),
    undefined
  );
});
test('full names use the agreed staff login convention and legacy assignments match the account', () => {
  assert.equal(taskAssigneeLogin(' Hugo   Berendi '), 'hugo.berendi@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('@Mara Bertram'), 'mara.bertram@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Markus Überla'), 'markus.ueberla@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Bea Groß'), 'bea.gross@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Nico'), 'Nico');
  assert.equal(taskAssigneeLogin('Hugo und Mara'), 'Hugo und Mara');
  assert.equal(taskAssigneeLogin('Hugo Berendi und Nico Welles'), 'Hugo Berendi und Nico Welles');
  assert.equal(taskAssigneeLogin('Person@Another.test'), 'person@another.test');
  assert.ok(taskAssignedToLogin('Hugo Berendi', 'hugo.berendi@stamm-phoenix.de'));
  assert.ok(taskAssignedToLogin('HUGO.BERENDI@STAMM-PHOENIX.DE', 'hugo.berendi@stamm-phoenix.de'));
  assert.equal(taskAssignedToLogin('Hugo', 'hugo.berendi@stamm-phoenix.de'), false);
  assert.equal(taskAssignedToLogin('Hugo Berendi', 'nico.welles@stamm-phoenix.de'), false);
  assert.equal(taskAssignedToLogin('', ''), false);
});

test('multiple people are deduplicated, displayed by name and matched by any assigned login', () => {
  const task = {
    assignee: 'alex@example.test',
    assignees: [
      { name: 'Alex Beispiel', login: 'alex@example.test' },
      { name: 'Bea Beispiel', login: 'BEA@example.test' },
      { name: 'Bea Beispiel', login: 'bea@example.test' },
    ],
  };
  assert.equal(taskPeople(task).length, 2);
  assert.ok(taskHasAssignee(task, 'bea@example.test'));
  assert.ok(taskHasAssignee(task, 'alex@example.test'));
  assert.equal(taskHasAssignee(task, 'someone@example.test'), false);
  assert.equal(taskAssigneeNames(task), 'Alex Beispiel, Bea Beispiel');
  assert.equal(taskAssigneeNames({ assignee: 'hugo.berendi@stamm-phoenix.de' }), 'Hugo Berendi');
  assert.equal(taskHasAssignee({ ...task, assignees: [] }, 'alex@example.test'), false);
});
