/**
 * One instance of the demo API in a worker thread of `scripts/serve-built.ts`. A worker has its
 * own module graph, so each instance starts with the initial demo data of `dev/mockApi.ts` and
 * keeps its writes to itself. It listens on a free local port and posts that port to its parent.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// The mock API announces itself on creation; one line per test would only fill the CI log
console.info = (): void => undefined;

const { mockApiMiddleware } = await import('../dev/mockApi');
const mockApi = mockApiMiddleware();
const server = createServer((request, response) =>
  mockApi(request, response, () => response.writeHead(404).end())
);
server.listen(0, '127.0.0.1', () => postMessage((server.address() as AddressInfo).port));
