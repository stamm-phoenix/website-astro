import { createGeocodingCoordinator, type GeocodingState } from '../../lib/geocoding-coordination';

interface Reply {
  id: number;
  value?: unknown;
}

let nextId = 0;
const pending = new Map<number, (value: unknown) => void>();
process.on('message', (message: Reply) => {
  pending.get(message.id)?.(message.value);
  pending.delete(message.id);
});

function rpc(operation: string, value?: unknown): Promise<unknown> {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    process.send?.({ id, operation, value });
  });
}

const coordinator = createGeocodingCoordinator({
  now: () => Date.now() + Number(process.argv[3] ?? 0),
  read: async () => {
    const reply = (await rpc('read')) as { state?: unknown };
    return reply.state;
  },
  mutate: async (parse, change): Promise<GeocodingState | undefined> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const loaded = (await rpc('read')) as { version: number; state?: unknown };
      const changed = change(parse(loaded.state));
      if (changed === undefined) return undefined;
      if (await rpc('cas', { version: loaded.version, state: changed })) return changed;
    }
    throw new Error('CAS retries exhausted');
  },
  log: (event) => process.send?.({ operation: 'log', value: event }),
});

void coordinator
  .lookup(process.argv[2] ?? 'same-address', (request) =>
    request(async () => {
      await rpc('request');
      return { found: true, precision: 'address', lat: 47.9, lon: 11.8 };
    })
  )
  .then((result) => {
    process.send?.({ operation: 'done', value: result }, () => process.disconnect?.());
  });
