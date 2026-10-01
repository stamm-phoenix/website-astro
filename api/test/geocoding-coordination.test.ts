import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import {
  createGeocodingCoordinator,
  parseGeocodingState,
  type GeocodingState,
} from '../lib/geocoding-coordination';

interface WorkerMessage {
  id?: number;
  operation: string;
  value?: unknown;
}

async function independentWorkers(
  keys: string[],
  clockOffsets: number[] = []
): Promise<{ starts: number[]; results: unknown[]; state: unknown }> {
  let state: unknown;
  let version = 0;
  const starts: number[] = [];
  const children = keys.map((key, index) =>
    fork(join(__dirname, 'fixtures/geocoding-worker.js'), [key, String(clockOffsets[index] ?? 0)], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
  );
  try {
    const results = await Promise.all(
      children.map(
        (child) =>
          new Promise<unknown>((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code !== 0) reject(new Error(`Worker exited ${code}`));
            });
            child.on('message', (message: WorkerMessage) => {
              let value: unknown;
              switch (message.operation) {
                case 'read':
                  value = { version, state };
                  break;
                case 'cas': {
                  const changed = message.value as { version: number; state: unknown };
                  value = changed.version === version;
                  if (value) {
                    state = changed.state;
                    version++;
                  }
                  break;
                }
                case 'request':
                  starts.push(Date.now());
                  value = true;
                  break;
                case 'done':
                  resolve(message.value);
                  return;
                default:
                  return;
              }
              child.send({ id: message.id, value });
            });
          })
      )
    );
    return { starts, results, state };
  } finally {
    for (const child of children) child.kill();
  }
}

test(
  'separate Node processes coalesce simultaneous identical addresses into one request',
  { timeout: 10_000 },
  async () => {
    const { starts, results } = await independentWorkers([
      'same-address',
      'same-address',
      'same-address',
    ]);
    assert.equal(starts.length, 1);
    assert.deepEqual(
      results,
      Array.from({ length: 3 }, () => ({
        found: true,
        precision: 'address',
        lat: 47.9,
        lon: 11.8,
      }))
    );
  }
);

test(
  'separate Node processes respect the aggregate request interval',
  { timeout: 10_000 },
  async () => {
    const { starts } = await independentWorkers([
      'first-address',
      'second-address',
      'third-address',
    ]);
    assert.equal(starts.length, 3);
    const sorted = [...starts].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index++) {
      assert.ok(sorted[index] - sorted[index - 1] >= 1_100);
    }
  }
);

test(
  'small clock differences between separate workers do not shorten the real provider interval',
  { timeout: 10_000 },
  async () => {
    const { starts } = await independentWorkers(
      ['first-address', 'second-address'],
      [-1_000, 1_000]
    );
    assert.equal(starts.length, 2);
    assert.ok(Math.abs(starts[1] - starts[0]) >= 1_100);
  }
);

test('state-store outage fails closed without sending a provider request', async () => {
  let sent = false;
  const coordinator = createGeocodingCoordinator({
    read: async () => {
      throw new Error('Store unavailable');
    },
    mutate: async () => {
      throw new Error('Must not mutate');
    },
  });
  const result = await coordinator.lookup('address-hmac', (request) =>
    request(async () => {
      sent = true;
      return { found: false };
    })
  );
  assert.deepEqual(result, { found: false, unavailable: true });
  assert.equal(sent, false);
});

test('crashed owner is reclaimed only after its lease and last possible request finish', async () => {
  let at = 1_000;
  let state: GeocodingState = {
    version: 1,
    nextRequestAt: 0,
    cache: [],
    lease: { owner: 'crashed', key: 'other-address', expires: 1_200 },
  };
  let started = 0;
  const coordinator = createGeocodingCoordinator({
    now: () => at,
    sleep: async (ms) => {
      at += ms;
    },
    read: async () => state,
    mutate: async (parse, change) => {
      const changed = change(parse(state));
      if (changed) state = changed;
      return changed;
    },
  });
  const result = await coordinator.lookup('address-hmac', (request) =>
    request(async () => {
      started = at;
      return { found: false };
    })
  );
  assert.deepEqual(result, { found: false });
  assert.ok(started >= 1_200 + 5_000 + 1_100);
  assert.equal(state.lease, undefined);
});

test('malformed shared state cannot reset a lock or rate limit', () => {
  assert.throws(() => parseGeocodingState({ version: 1, nextRequestAt: 'bad', cache: [] }));
  assert.throws(() => parseGeocodingState({ version: 1, nextRequestAt: 1, cache: [], lease: {} }));
});

test('lost lease prevents another request and metrics never contain lookup keys', async () => {
  let state: GeocodingState | undefined;
  let sent = 0;
  const logs: unknown[] = [];
  const coordinator = createGeocodingCoordinator({
    read: async () => state,
    mutate: async (parse, change) => {
      const changed = change(parse(state));
      if (changed) state = changed;
      return changed;
    },
    log: (event) => logs.push(event),
  });
  const result = await coordinator.lookup('sensitive-address-hmac', async (request) => {
    await request(async () => {
      sent++;
      return true;
    });
    state = {
      version: 1,
      nextRequestAt: 0,
      cache: [],
      lease: {
        owner: 'other-process',
        key: 'other',
        expires: Date.now() + 50_000,
      },
    };
    await request(async () => {
      sent++;
      return true;
    });
    return { found: false };
  });
  assert.deepEqual(result, { found: false, unavailable: true });
  assert.equal(sent, 1);
  assert.equal(JSON.stringify(logs).includes('sensitive'), false);
});
