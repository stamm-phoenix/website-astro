import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { hasTeam, isStaffError, requireStaff } from '../lib/staff-auth';
import { overrideConfig } from './fixtures/config';

function request(
  login: string,
  userRoles = ['anonymous', 'authenticated', 'team_leitende']
): HttpRequest {
  const principal = { identityProvider: 'aad', userId: 'user-1', userDetails: login, userRoles };
  return new HttpRequest({
    url: 'http://localhost/api/intern/test',
    method: 'GET',
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
    },
  });
}

function onPreview(t: TestContext): void {
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
}

test('requireStaff lets leaders in on production', () => {
  const result = requireStaff(request('anna@stamm-phoenix.de'));
  assert.equal(isStaffError(result), false);
});

test('requireStaff refuses accounts outside the team „Leitende“', () => {
  const result = requireStaff(request('gast@stamm-phoenix.de', ['anonymous', 'authenticated']));
  assert.equal(isStaffError(result), true);
  assert.equal(isStaffError(result) && result.status, 403);
  assert.equal(isStaffError(result) && (result.jsonBody as { error: string }).error, 'NOT_IN_TEAM');
});

test('hasTeam checks the role of the team', () => {
  const principal = {
    identityProvider: 'aad',
    userId: 'user-1',
    userDetails: 'kasse@stamm-phoenix.de',
    userRoles: ['authenticated', 'team_leitende', 'team_kasse'],
  };
  assert.equal(hasTeam(principal, 'kasse'), true);
  assert.equal(
    hasTeam({ ...principal, userRoles: ['authenticated', 'team_leitende'] }, 'kasse'),
    false
  );
});

test('requireStaff refuses preview-only test accounts outside PR previews', (t) => {
  overrideConfig(t, CONFIG.staff, { previewOnlyLogins: ['claude-preview@stamm-phoenix.de'] });

  const result = requireStaff(request('Claude-Preview@stamm-phoenix.de'));
  assert.equal(isStaffError(result), true);
  assert.equal(isStaffError(result) && result.status, 403);
});

test('requireStaff lets preview-only test accounts in on PR previews', (t) => {
  overrideConfig(t, CONFIG.staff, { previewOnlyLogins: ['claude-preview@stamm-phoenix.de'] });
  onPreview(t);

  const result = requireStaff(request('claude-preview@stamm-phoenix.de'));
  assert.equal(isStaffError(result), false);
});
