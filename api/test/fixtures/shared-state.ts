import type { TestContext } from 'node:test';
import { getDb } from '../../lib/db';
import { CONFIG } from '../../lib/config';
import { readNikolausState } from '../../lib/nikolaus-state';
import { overrideConfig } from './config';

export interface SharedStateFixture {
  /** Stores a state document as it is, without validation. */
  seed: (key: string, data: unknown) => Promise<void>;
  read: (key: string) => Promise<unknown>;
}

/** Enables Nikolaus writes and a test sender for one test; use inside `dbTest`. */
export function setupSharedState(t: TestContext): SharedStateFixture {
  const previousWritesEnabled = process.env.NIKOLAUS_WRITES_ENABLED;
  process.env.NIKOLAUS_WRITES_ENABLED = 'true';
  t.after(() => {
    if (previousWritesEnabled === undefined) delete process.env.NIKOLAUS_WRITES_ENABLED;
    else process.env.NIKOLAUS_WRITES_ENABLED = previousWritesEnabled;
  });
  overrideConfig(t, CONFIG.mail, { nikolausSender: 'sender@example.test' });
  return {
    seed: async (key, data) => {
      await getDb()
        .insertInto('nikolaus.state')
        .values({ state_key: key, value: JSON.stringify(data) })
        .execute();
    },
    read: async (key) => (await readNikolausState(key))?.data,
  };
}
