import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeocodingCoordinator } from '../../lib/geocoding-coordination';

interface SentRequest {
  worker: string;
  at: number;
}

const worker = process.argv[2] ?? 'A';
const pausePoint = process.argv[3] ?? 'request_start';
const directory = process.argv[4] ?? mkdtempSync(join(tmpdir(), 'geocoding-pause-'));
const statePath = join(directory, 'state.json');
const clockPath = join(directory, 'clock.json');
const sentPath = join(directory, 'sent.json');
if (worker === 'A') {
  writeFileSync(statePath, 'null');
  writeFileSync(clockPath, '1000000');
  writeFileSync(sentPath, '[]');
}
const readState = (): unknown => JSON.parse(readFileSync(statePath, 'utf8')) ?? undefined;
const now = (): number => Number(readFileSync(clockPath, 'utf8'));
const sentRequests = (): SentRequest[] => JSON.parse(readFileSync(sentPath, 'utf8'));
let competingResult: unknown;
const coordinator = createGeocodingCoordinator({
  read: async () => readState(),
  now,
  sleep: async (milliseconds) => {
    writeFileSync(clockPath, String(now() + milliseconds));
  },
  mutate: async (parse, change) => {
    // A is suspended while B runs, so no mutations overlap; each observes the latest state.
    const next = change(parse(readState()));
    if (next) writeFileSync(statePath, JSON.stringify(next));
    return next;
  },
  log: (event) => {
    if (worker !== 'A' || event.event !== pausePoint) return;
    // Simulate a pause longer than the old lease plus recovery grace without waiting a minute.
    writeFileSync(clockPath, String(now() + 60_000));
    competingResult = JSON.parse(
      execFileSync(process.execPath, [__filename, 'B', pausePoint, directory], {
        encoding: 'utf8',
      })
    );
  },
});

void coordinator
  .lookup('same-address', (request) =>
    request(async () => {
      const sent = sentRequests();
      sent.push({ worker, at: now() });
      writeFileSync(sentPath, JSON.stringify(sent));
      return { found: true, precision: 'address', lat: 47.9, lon: 11.8 };
    })
  )
  .then((result) => {
    console.log(
      JSON.stringify(
        worker === 'A'
          ? { result, competingResult, requests: sentRequests(), state: readState() }
          : result
      )
    );
  })
  .finally(() => {
    if (worker === 'A') rmSync(directory, { recursive: true, force: true });
  });
