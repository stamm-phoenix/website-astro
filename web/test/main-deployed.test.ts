import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideMainDeployed, skipsCi, type MainCommit } from '../scripts/main-deployed';

const sha = (n: number): string => String(n).padStart(40, 'a');
const commit = (n: number, message = 'feat: x'): MainCommit => ({ sha: sha(n), message });
// newest first: 3 is the head of main
const history = [commit(3), commit(2), commit(1)];

test('skipsCi detects the marker in any case', () => {
  assert.equal(skipsCi('flake.lock: Update [skip ci]'), true);
  assert.equal(skipsCi('chore [CI SKIP]'), true);
  assert.equal(skipsCi('feat: skip ci handling'), false);
});

test('ok when the head is deployed', () => {
  const outcome = decideMainDeployed({ deployed: sha(3), commits: history, pushRunActive: false });
  assert.equal(outcome.status, 'ok');
});

test('ok when only [skip ci] commits are newer than the deployed one', () => {
  const commits = [commit(5, 'lock [skip ci]'), commit(4, 'lock [skip ci]'), ...history];
  assert.equal(
    decideMainDeployed({ deployed: sha(3), commits, pushRunActive: false }).status,
    'ok'
  );
});

test('alarm when a deployable commit is missing and no run is active', () => {
  const outcome = decideMainDeployed({
    deployed: sha(2),
    commits: [commit(4, 'lock [skip ci]'), ...history],
    pushRunActive: false,
  });
  assert.equal(outcome.status, 'not-deployed');
  assert.ok(outcome.reason.includes(sha(2).slice(0, 8)));
  assert.ok(outcome.reason.includes(sha(3).slice(0, 8)));
});

test('alarm when the deployed commit is older than the list', () => {
  const outcome = decideMainDeployed({ deployed: sha(99), commits: history, pushRunActive: false });
  assert.equal(outcome.status, 'not-deployed');
});

test('pending while a push run is queued or running', () => {
  const outcome = decideMainDeployed({ deployed: sha(2), commits: history, pushRunActive: true });
  assert.equal(outcome.status, 'pending');
});

test('no false alarm when inputs cannot be read', () => {
  assert.equal(
    decideMainDeployed({ deployed: sha(2), commits: null, pushRunActive: false }).status,
    'unknown'
  );
  assert.equal(
    decideMainDeployed({ deployed: sha(2), commits: history, pushRunActive: null }).status,
    'unknown'
  );
  assert.equal(
    decideMainDeployed({ deployed: '', commits: history, pushRunActive: false }).status,
    'unknown'
  );
});

test('unknown when every recent commit skips CI', () => {
  const outcome = decideMainDeployed({
    deployed: sha(1),
    commits: [commit(2, '[skip ci]')],
    pushRunActive: false,
  });
  assert.equal(outcome.status, 'unknown');
});
