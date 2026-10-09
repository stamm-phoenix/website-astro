import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '@microsoft/microsoft-graph-client';
import { getDownloadFiles } from '../lib/download-files-list';
import * as token from '../lib/token';

const NEXT_PAGE = 'https://graph.microsoft.com/v1.0/drives/downloads/root/children?$skiptoken=2';

function driveFile(id: string): Record<string, unknown> {
  return {
    id,
    name: `${id}.pdf`,
    size: 1,
    file: { mimeType: 'application/pdf' },
    '@microsoft.graph.downloadUrl': `https://files.example/${id}`,
    createdDateTime: '2026-10-01T00:00:00Z',
    lastModifiedDateTime: '2026-10-01T00:00:00Z',
  };
}

function graphClient(pages: Record<string, unknown>): Client {
  const request = (path: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      expand: () => self,
      get: async () => {
        const page = path.endsWith('/root/children') ? pages.first : pages[path];
        if (!page) throw new Error(`Unexpected Graph request: ${path}`);
        return page;
      },
    };
    return self;
  };
  return { api: request } as unknown as Client;
}

test('getDownloadFiles returns the files of every Graph result page', async (t) => {
  t.mock.method(token, 'getClient', () =>
    graphClient({
      first: { value: [driveFile('page-1')], '@odata.nextLink': NEXT_PAGE },
      [NEXT_PAGE]: { value: [driveFile('page-2')] },
    })
  );

  const files = await getDownloadFiles();

  assert.deepEqual(
    files.map((file) => [file.id, file.downloadUrl]),
    [
      ['page-1', 'https://files.example/page-1'],
      ['page-2', 'https://files.example/page-2'],
    ]
  );
});
