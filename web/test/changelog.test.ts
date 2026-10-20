import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changelogProblems, newestEntryId, unseenEntries } from '../src/lib/changelog';
import type { ChangelogEntry } from '../src/lib/changelog';
import { CHANGELOG } from '../src/lib/changelogEntries';

function entry(id: string): ChangelogEntry {
  return { id, date: id.slice(0, 10), title: id, changes: ['Etwas ist neu.'] };
}

const ENTRIES = [entry('2026-10-20-c'), entry('2026-10-19-b'), entry('2026-10-18-a')];

test('the written changelog has valid, unique IDs, newest first, and no empty text', () => {
  assert.deepEqual(changelogProblems(CHANGELOG), []);
});

test('an entry that is not newer than the one before it is reported', () => {
  const problems = changelogProblems([entry('2026-10-18-a'), entry('2026-10-19-b')]);
  assert.deepEqual(problems, ['2026-10-19-b: nicht absteigend sortiert']);
});

test('a new person sees every entry as unseen', () => {
  assert.equal(unseenEntries(ENTRIES, null).length, 3);
});

test('only entries newer than the last seen one are unseen', () => {
  assert.deepEqual(
    unseenEntries(ENTRIES, '2026-10-19-b').map((e) => e.id),
    ['2026-10-20-c']
  );
  assert.deepEqual(unseenEntries(ENTRIES, '2026-10-20-c'), []);
});

test('an entry added later with an older ID than the last seen one is not counted', () => {
  // Merged out of order: it is dated before what the person has read
  assert.deepEqual(unseenEntries(ENTRIES, '2026-10-21-z'), []);
});

test('the newest ID is found without relying on the order', () => {
  assert.equal(newestEntryId([...ENTRIES].reverse()), '2026-10-20-c');
  assert.equal(newestEntryId([]), null);
});
