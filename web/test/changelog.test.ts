import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staffPage } from '../src/lib/staffModules';
import { changelogProblems, newestEntryId, unseenEntries } from '../src/lib/changelog';
import type { ChangelogEntry } from '../src/lib/changelog';
import { CHANGELOG } from '../src/lib/changelogEntries';

function entry(id: string): ChangelogEntry {
  return { id, date: id.slice(0, 10), title: id, changes: ['Etwas ist neu.'] };
}

const ENTRIES = [entry('2026-10-20-01-c'), entry('2026-10-19-01-b'), entry('2026-10-18-01-a')];

/** Today in Berlin as `YYYY-MM-DD`. */
function berlinToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

test('the written changelog has valid, unique IDs, newest first, no empty text and no future date', () => {
  assert.deepEqual(changelogProblems(CHANGELOG, berlinToday()), []);
});

test('several entries of one day are ordered by their number', () => {
  const sameDay = [entry('2026-10-20-02-b'), entry('2026-10-20-01-a')];
  assert.deepEqual(changelogProblems(sameDay), []);
  assert.deepEqual(changelogProblems([...sameDay].reverse()), [
    '2026-10-20-02-b: nicht absteigend sortiert',
  ]);
});

test('an entry dated after today is reported', () => {
  assert.deepEqual(changelogProblems([entry('2026-10-21-01-a')], '2026-10-20'), [
    '2026-10-21-01-a: Datum liegt nach heute',
  ]);
});

test('an entry that is not newer than the one before it is reported', () => {
  const problems = changelogProblems([entry('2026-10-18-01-a'), entry('2026-10-19-01-b')]);
  assert.deepEqual(problems, ['2026-10-19-01-b: nicht absteigend sortiert']);
});

test('a new person sees every entry as unseen', () => {
  assert.equal(unseenEntries(ENTRIES, null).length, 3);
});

test('only entries newer than the last seen one are unseen', () => {
  assert.deepEqual(
    unseenEntries(ENTRIES, '2026-10-19-01-b').map((e) => e.id),
    ['2026-10-20-01-c']
  );
  assert.deepEqual(unseenEntries(ENTRIES, '2026-10-20-01-c'), []);
});

test('an entry added later with an older ID than the last seen one is not counted', () => {
  // Merged out of order: it is dated before what the person has read
  assert.deepEqual(unseenEntries(ENTRIES, '2026-10-21-01-z'), []);
});

test('the newest ID is found without relying on the order', () => {
  assert.equal(newestEntryId([...ENTRIES].reverse()), '2026-10-20-01-c');
  assert.equal(newestEntryId([]), null);
});

test('every link of the changelog leads to a registered page of the Leitendenbereich', () => {
  const hrefs = CHANGELOG.flatMap((e) =>
    e.changes.flatMap((change) => (typeof change === 'string' ? [] : [change.href]))
  );
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) assert.doesNotThrow(() => staffPage(href), href);
});
