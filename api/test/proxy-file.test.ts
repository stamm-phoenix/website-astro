import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { InvocationContext } from '@azure/functions';
import { proxyFile } from '../lib/response-utils';

async function serve(
  handler: (response: ServerResponse) => void
): Promise<{ url: string; server: Server }> {
  const server = createServer((_request, response) => handler(response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/file`, server };
}

function context(): InvocationContext {
  return new InvocationContext({ functionName: 'proxy-file-test', logHandler: () => {} });
}

test('times out when the headers arrive at once but the body stalls', async (t) => {
  const { url, server } = await serve((response) => {
    response.writeHead(200, { 'Content-Type': 'application/pdf' });
    response.write('first bytes');
    // Never ends the body.
  });
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());

  const started = Date.now();
  const result = await proxyFile(url, context(), { timeout: 200 });

  assert.equal(result.status, 504);
  assert.ok(Date.now() - started < 5000);
});

test('returns the whole file within the timeout', async (t) => {
  const { url, server } = await serve((response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('hello ');
    setTimeout(() => response.end('world'), 20);
  });
  t.after(() => server.close());

  const result = await proxyFile(url, context(), { timeout: 2000 });

  assert.equal(result.status, 200);
  assert.equal(Buffer.from(result.body as Uint8Array).toString(), 'hello world');
  assert.deepEqual(result.headers, { 'Content-Type': 'text/plain' });
});

test('rejects files whose Content-Length exceeds the limit', async (t) => {
  const { url, server } = await serve((response) => {
    response.writeHead(200, { 'Content-Length': '11' });
    response.end('hello world');
  });
  t.after(() => server.close());

  const result = await proxyFile(url, context(), { maxBytes: 10 });

  assert.equal(result.status, 502);
});

test('rejects streamed files without Content-Length that exceed the limit', async (t) => {
  const { url, server } = await serve((response) => {
    response.writeHead(200);
    response.write('hello ');
    response.end('world');
  });
  t.after(() => server.close());

  const result = await proxyFile(url, context(), { maxBytes: 10 });

  assert.equal(result.status, 502);
});
