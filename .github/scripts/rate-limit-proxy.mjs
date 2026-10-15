// Forwards the requests of the Codex review to Azure OpenAI and waits out the rate limit.
//
// Azure answers 429 as soon as the tokens per minute of the deployment are used up; a single
// review of a large PR gets there. Codex itself gives up after a few retries within seconds,
// and the codex action does not allow changing that. This proxy sits between the action's own
// proxy (which adds the key) and Azure: on a 429 it waits as long as Azure says and sends the
// request again, so Codex only sees a slower answer. Everything else, including the streamed
// response, passes through unchanged.
//
// Usage: node rate-limit-proxy.mjs <port> <upstream URL> <log file>
// Codex runs without network access and cannot reach the proxy. The key only passes through in
// the Authorization header of each request and is never logged.

import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [port, upstream, logFile] = process.argv.slice(2);
const upstreamUrl = new URL(upstream);
const client = upstreamUrl.protocol === 'https:' ? https : http;

// Total waiting time per request. Codex aborts a request after 5 minutes without an answer.
const MAX_WAIT_MS = 4 * 60 * 1000;
// Fallback when Azure sends no Retry-After header
const DEFAULT_WAIT_MS = 10 * 1000;
const MAX_SINGLE_WAIT_MS = 60 * 1000;

// Headers that belong to a single connection and are not forwarded
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const log = (message) => {
  appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
};

const forwardHeaders = (headers) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waiting time from the headers of a 429: Azure sends retry-after-ms and retry-after (seconds)
const retryDelay = (headers) => {
  const ms = Number(headers['retry-after-ms']);
  const seconds = Number(headers['retry-after']);
  const wait = Number.isFinite(ms) && ms > 0 ? ms : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_WAIT_MS;
  // A little more than asked, so that the window has really moved on
  return Math.min(wait + 500 + Math.random() * 1000, MAX_SINGLE_WAIT_MS);
};

const send = (method, headers, body) =>
  new Promise((resolve, reject) => {
    const request = client.request(
      upstreamUrl,
      { method, headers: { ...headers, 'content-length': body.length } },
      resolve,
    );
    request.on('error', reject);
    request.end(body);
  });

const server = http.createServer(async (req, res) => {
  const headers = forwardHeaders(req.headers);
  const started = Date.now();
  // Codex (or the action's proxy) closed the connection while the proxy was waiting
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    for (let attempt = 1; ; attempt += 1) {
      const upstreamRes = await send(req.method, headers, body);
      const wait = upstreamRes.statusCode === 429 ? retryDelay(upstreamRes.headers) : 0;
      if (upstreamRes.statusCode !== 429 || Date.now() - started + wait > MAX_WAIT_MS) {
        if (upstreamRes.statusCode === 429) log(`429, giving up after ${attempt} attempts`);
        res.writeHead(upstreamRes.statusCode, forwardHeaders(upstreamRes.headers));
        // A connection to Azure that breaks off mid-stream must not end the whole proxy: cut off
        // this answer, so Codex sees the abort and retries
        upstreamRes.on('error', (error) => {
          log(`upstream stream error: ${error.message}`);
          res.destroy(error);
        });
        upstreamRes.pipe(res);
        res.on('close', () => upstreamRes.destroy());
        return;
      }
      upstreamRes.on('error', () => {});
      upstreamRes.resume();
      log(`429, waiting ${Math.round(wait / 1000)} s (attempt ${attempt})`);
      await sleep(wait);
      if (clientGone) return;
    }
  } catch (error) {
    log(`request error: ${error.message}`);
    if (clientGone) return;
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('rate limit proxy: upstream error');
  }
});

// Whatever goes wrong with a single request must not end the proxy, because the workflow does not
// restart it and every later request of the review would fail
process.on('uncaughtException', (error) => log(`uncaught: ${error.stack ?? error}`));
process.on('unhandledRejection', (error) => log(`unhandled: ${error?.stack ?? error}`));

server.requestTimeout = 0;
server.listen(Number(port), '127.0.0.1', () => log(`listening on 127.0.0.1:${port}, forwarding to ${upstreamUrl.origin}`));
