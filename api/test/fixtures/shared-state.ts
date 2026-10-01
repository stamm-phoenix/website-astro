import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as sharePoint from '../../lib/sharepoint-data-access';
import * as environment from '../../lib/environment';

export interface SharedStateRow {
  id: string;
  eTag: string;
  fields: Record<string, unknown>;
}

export interface SharedStateFixture {
  rows: Map<string, SharedStateRow>;
  writes: { creates: number; updates: number; deletes: number };
  seed: (key: string, data: unknown) => SharedStateRow;
}

export function setupSharedState(t: TestContext): SharedStateFixture {
  const rows = new Map<string, SharedStateRow>();
  const writes = { creates: 0, updates: 0, deletes: 0 };
  let sequence = 0;
  t.mock.method(environment, 'getEnvironment', (variable: environment.EnvironmentVariable) =>
    variable === environment.EnvironmentVariable.NIKOLAUS_MAIL_SENDER
      ? 'sender@example.test'
      : 'simulated-state-list'
  );
  t.mock.method(
    sharePoint,
    'getSharePointListItems',
    async (_list: string, options?: { filter?: string }) => {
      const key = options?.filter?.match(/OperationKey eq '([^']+)'/)?.[1];
      return structuredClone(
        [...rows.values()].filter((row) => !key || row.fields.OperationKey === key)
      );
    }
  );
  t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (_list: string, fields: Record<string, unknown>) => {
      if ([...rows.values()].some((row) => row.fields.OperationKey === fields.OperationKey))
        throw Object.assign(new Error('Duplicate unique OperationKey'), { statusCode: 400 });
      const id = String(++sequence);
      rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
      writes.creates++;
      return id;
    }
  );
  t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (_list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const row = rows.get(id);
      if (!row) throw Object.assign(new Error('Missing state'), { statusCode: 404 });
      assert.ok(etag, 'Every write carries If-Match');
      if (row.eTag !== etag) throw Object.assign(new Error('Stale state'), { statusCode: 412 });
      row.fields = { ...row.fields, ...structuredClone(fields) };
      row.eTag = `"${id},${++sequence}"`;
      writes.updates++;
    }
  );
  t.mock.method(
    sharePoint,
    'deleteSharePointListItem',
    async (_list: string, id: string, etag?: string) => {
      const row = rows.get(id);
      if (!row) throw Object.assign(new Error('Missing state'), { statusCode: 404 });
      if (row.eTag !== etag) throw Object.assign(new Error('Stale state'), { statusCode: 412 });
      rows.delete(id);
      writes.deletes++;
    }
  );
  return {
    rows,
    writes,
    seed: (key, data) => {
      const id = String(++sequence);
      const row = {
        id,
        eTag: `"${id},1"`,
        fields: { OperationKey: key, State: JSON.stringify(data) },
      };
      rows.set(id, row);
      return row;
    },
  };
}
