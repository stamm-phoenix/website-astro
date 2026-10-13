import * as metadata from '../../lib/protokoll-metadata';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { CONFIG } from '../../lib/config';
import { overrideConfig } from './config';
import type { ProtokollDriveItem, ProtokollFields } from '../../lib/protokolle';
import * as sharePoint from '../../lib/sharepoint-data-access';
import * as contentVersion from '../../lib/protokoll-content-version';

export const realContentResolver = contentVersion.withProtokollContentVersion;

export const AUTHOR = {
  identityProvider: 'aad',
  userId: 'author',
  userDetails: 'autorin@example.test',
  userRoles: ['authenticated'],
};
export const REVIEWER = { ...AUTHOR, userId: 'reviewer', userDetails: 'stavo@example.test' };
export const ETAG = '"item,4"';

interface ProtokollTestItem extends ProtokollDriveItem {
  listItem: { eTag?: string; fields?: ProtokollFields };
}

export function driveItem(
  fields: ProtokollFields,
  overrides: Partial<ProtokollDriveItem> = {}
): ProtokollTestItem {
  return {
    id: 'P1',
    name: '2026-10-07 Leitendenrunde.docx',
    webUrl: 'https://sharepoint.example/doc.aspx',
    cTag: '"c:{P1},3"',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    parentReference: { path: '/drives/drive-1/root:/Protokolle/Leitendenrunde' },
    lastModifiedDateTime: '2026-10-07T20:00:00Z',
    lastModifiedBy: { user: { displayName: 'Alex' } },
    listItem: { eTag: ETAG, fields },
    ...overrides,
  };
}

export const LEADER = {
  id: 'prs_1',
  primary_email: 'Leiterin@Example.test',
  cc_emails: ['eltern@example.test'],
  group_names: ['🐦‍🔥 Leiter*in'],
};

export function setupLegacyProtokolle(t: TestContext): InvocationContext {
  overrideConfig(t, CONFIG.protokolle, {
    library: 'Unterlagen',
    folderPath: 'Protokolle/Leitendenrunde',
    templateUrl: 'https://sharepoint.example/:w:/s/leitende/vorlage',
    reviewers: [],
    sender: 'protokolle@example.test',
    campflowGroups: ['Leiter*in'],
    // No model unless a test sets one, so nothing reaches Azure OpenAI by accident
    termin: { endpoint: '', deployment: '', maxExtractionsPerDay: 1000 },
  });
  // Endpoint tests use an in-memory workflow adapter. SQL persistence is tested separately.
  t.mock.method(metadata, 'assertProtokollImport', async () => {});
  t.mock.method(
    metadata,
    'withProtokollMetadata',
    async (_drive: string, item: ProtokollDriveItem) => item
  );
  t.mock.method(
    metadata,
    'createProtokollMetadata',
    async (drive: string, id: string, fields: ProtokollFields) =>
      sharePoint.updateSharePointDriveItemFields(drive, id, { ...fields })
  );
  t.mock.method(
    metadata,
    'updateProtokollMetadata',
    async (drive: string, id: string, fields: ProtokollFields, etag: string) => {
      await sharePoint.updateSharePointDriveItemFields(drive, id, { ...fields }, etag);
      return etag;
    }
  );
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  // Existing cases exercise legacy cTag records; fingerprint cases restore the real resolver.
  t.mock.method(
    contentVersion,
    'withProtokollContentVersion',
    async (_drive: string, item: ProtokollDriveItem) => item
  );
  const context = new InvocationContext({ functionName: 'protokolle-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'warn', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

export function request(
  method: string,
  body?: unknown,
  options: { id?: string; principal?: unknown; path?: string; etag?: string } = {}
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.etag) headers['if-match'] = options.etag;
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? AUTHOR)
    ).toString('base64');
  }
  return new HttpRequest({
    url: `http://localhost/api/intern/pflege/protokolle${options.path ?? ''}`,
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}
