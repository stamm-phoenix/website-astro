import { describe, expect, test } from 'bun:test';
import { decideMainDeployed, skipsCi, type MainCommit } from '../scripts/main-deployed';

const sha = (n: number): string => String(n).padStart(40, 'a');
const commit = (n: number, message = 'feat: x'): MainCommit => ({ sha: sha(n), message });
// newest first: 3 is the head of main
const history = [commit(3), commit(2), commit(1)];

describe('skipsCi', () => {
  test('detects the marker in any case', () => {
    expect(skipsCi('flake.lock: Update [skip ci]')).toBe(true);
    expect(skipsCi('chore [CI SKIP]')).toBe(true);
    expect(skipsCi('feat: skip ci handling')).toBe(false);
  });
});

describe('decideMainDeployed', () => {
  test('ok when the head is deployed', () => {
    expect(
      decideMainDeployed({ deployed: sha(3), commits: history, pushRunActive: false }).status
    ).toBe('ok');
  });

  test('ok when only [skip ci] commits are newer than the deployed one', () => {
    const commits = [commit(5, 'lock [skip ci]'), commit(4, 'lock [skip ci]'), ...history];
    expect(decideMainDeployed({ deployed: sha(3), commits, pushRunActive: false }).status).toBe(
      'ok'
    );
  });

  test('alarm when a deployable commit is missing and no run is active', () => {
    const outcome = decideMainDeployed({
      deployed: sha(2),
      commits: [commit(4, 'lock [skip ci]'), ...history],
      pushRunActive: false,
    });
    expect(outcome.status).toBe('not-deployed');
    expect(outcome.reason).toContain(sha(2).slice(0, 8));
    expect(outcome.reason).toContain(sha(3).slice(0, 8));
  });

  test('alarm when the deployed commit is older than the list', () => {
    expect(
      decideMainDeployed({ deployed: sha(99), commits: history, pushRunActive: false }).status
    ).toBe('not-deployed');
  });

  test('pending while a push run is queued or running', () => {
    expect(
      decideMainDeployed({ deployed: sha(2), commits: history, pushRunActive: true }).status
    ).toBe('pending');
  });

  test('no false alarm when inputs cannot be read', () => {
    expect(
      decideMainDeployed({ deployed: sha(2), commits: null, pushRunActive: false }).status
    ).toBe('unknown');
    expect(
      decideMainDeployed({ deployed: sha(2), commits: history, pushRunActive: null }).status
    ).toBe('unknown');
    expect(
      decideMainDeployed({ deployed: '', commits: history, pushRunActive: false }).status
    ).toBe('unknown');
  });

  test('unknown when every recent commit skips CI', () => {
    expect(
      decideMainDeployed({
        deployed: sha(1),
        commits: [commit(2, '[skip ci]')],
        pushRunActive: false,
      }).status
    ).toBe('unknown');
  });
});
