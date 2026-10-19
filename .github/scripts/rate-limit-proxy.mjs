// Forwards the requests of the Codex review to Azure OpenAI and waits out the rate limit.
//
// Azure refuses requests as soon as the tokens per minute of the deployment are used up; a single
// review of a large PR gets there. Codex itself gives up after a few retries within seconds, and
// the codex action does not allow changing that. This proxy sits between the action's own proxy
// (which adds the key) and Azure: when Azure reports the rate limit, it waits as long as Azure
// says and sends the request again, so Codex only sees a slower answer. Everything else,
// including the streamed response, passes through unchanged.
//
// Azure reports the limit in two ways: as HTTP 429, or as HTTP 200 whose stream starts with a
// failed response (Codex then shows "Reconnecting..."). For the second, the proxy holds back the
// events of a stream until the first one that is more than a status and checks it.
//
// Usage: node rate-limit-proxy.mjs <port> <upstream URL> <log file>
// Codex runs without network access and cannot reach the proxy. The key only passes through in
// the Authorization header of each request and is never logged.

import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';

const [port, upstream, logFile] = process.argv.slice(2);
const upstreamUrl = new URL(upstream);
const client = upstreamUrl.protocol === 'https:' ? https : http;

// Total waiting time per request. Codex aborts a request after 5 minutes without an answer.
const MAX_WAIT_MS = 4 * 60 * 1000;
// Fallback when Azure names no waiting time
const DEFAULT_WAIT_MS = 10 * 1000;
const MAX_SINGLE_WAIT_MS = 60 * 1000;
// Stream events that only report the state of the response; the proxy looks past them
const STATUS_EVENTS = new Set(['response.created', 'response.queued', 'response.in_progress']);
// A stream that has sent this much without a decisive event is passed on as it is
const MAX_HELD_BYTES = 1024 * 1024;

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

// A little more than asked, so that the window has really moved on
const withMargin = (wait) => Math.min(wait + 500 + Math.random() * 1000, MAX_SINGLE_WAIT_MS);

// Waiting time from the headers of a 429: Azure sends retry-after-ms and retry-after (seconds)
const headerDelay = (headers) => {
  const ms = Number(headers['retry-after-ms']);
  const seconds = Number(headers['retry-after']);
  if (Number.isFinite(ms) && ms > 0) return withMargin(ms);
  if (Number.isFinite(seconds) && seconds > 0) return withMargin(seconds * 1000);
  return withMargin(DEFAULT_WAIT_MS);
};

// Waiting time from the text of a rate limit error ("try again in 1.5s", "retry after 6 seconds")
const messageDelay = (message) => {
  const tryAgain = /try again in (\d+(?:\.\d+)?)\s*(ms|s)/i.exec(message);
  if (tryAgain) return withMargin(Number(tryAgain[1]) * (tryAgain[2].toLowerCase() === 'ms' ? 1 : 1000));
  const retryAfter = /retry after (\d+(?:\.\d+)?)\s*seconds?/i.exec(message);
  if (retryAfter) return withMargin(Number(retryAfter[1]) * 1000);
  return withMargin(DEFAULT_WAIT_MS);
};

// One server-sent event: its type (from the data or the event line) and its data
const parseEvent = (block) => {
  let name = '';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  let json = null;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    // not JSON, e.g. [DONE]
  }
  return { type: json?.type ?? name, json };
};

// The error of a failed response or error event, if it is the rate limit
const rateLimitError = (event) => {
  if (event.type !== 'response.failed' && event.type !== 'error') return null;
  const error = event.json?.response?.error ?? event.json?.error ?? event.json;
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');
  if (code === 'rate_limit_exceeded' || code === '429' || /rate limit/i.test(message)) return { code, message };
  return null;
};

// Reads a stream up to its first decisive event. Returns the chunks read so far (to be passed on
// unchanged) and the rate limit error, if that is what the event is.
const inspectStream = (upstreamRes) =>
  new Promise((resolve, reject) => {
    const held = [];
    const decoder = new StringDecoder('utf8');
    let text = '';
    let size = 0;
    const finish = (result) => {
      upstreamRes.off('data', onData);
      upstreamRes.off('end', onEnd);
      upstreamRes.off('close', onClose);
      upstreamRes.off('error', reject);
      upstreamRes.pause();
      resolve({ held, ...result });
    };
    const onData = (chunk) => {
      held.push(chunk);
      size += chunk.length;
      text = (text + decoder.write(chunk)).replace(/\r\n/g, '\n');
      for (let end = text.indexOf('\n\n'); end !== -1; end = text.indexOf('\n\n')) {
        const event = parseEvent(text.slice(0, end));
        text = text.slice(end + 2);
        // Comments (": keepalive") and other blocks without a type decide nothing either
        if (!event.type || STATUS_EVENTS.has(event.type)) continue;
        if (event.type === 'response.failed' || event.type === 'error') {
          log(`stream starts with ${event.type}: ${JSON.stringify(event.json?.response?.error ?? event.json?.error ?? event.json)}`);
        }
        finish({ rateLimit: rateLimitError(event), ended: false });
        return;
      }
      if (size > MAX_HELD_BYTES) finish({ rateLimit: null, ended: false });
    };
    const onEnd = () => finish({ rateLimit: null, ended: true });
    // Closed without an end: Azure broke off, or the proxy stopped it because Codex went away
    const onClose = () => finish({ rateLimit: null, ended: true, aborted: true });
    upstreamRes.on('data', onData);
    upstreamRes.on('end', onEnd);
    upstreamRes.on('close', onClose);
    upstreamRes.on('error', reject);
  });

// onRequest gets the request to Azure right away, so it can be stopped before Azure answers
const send = (method, headers, body, onRequest) =>
  new Promise((resolve, reject) => {
    const request = client.request(
      upstreamUrl,
      { method, headers: { ...headers, 'content-length': body.length } },
      resolve,
    );
    request.on('error', reject);
    onRequest(request);
    request.end(body);
  });

const server = http.createServer(async (req, res) => {
  const headers = forwardHeaders(req.headers);
  const started = Date.now();
  // Codex (or the action's proxy) closed the connection: stop the request to Azure that is under
  // way, so it uses no more tokens, and send no further attempts
  let clientGone = false;
  let current = null;
  res.on('close', () => {
    clientGone = true;
    current?.destroy();
  });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    for (let attempt = 1; ; attempt += 1) {
      if (clientGone) return;
      const upstreamRes = await send(req.method, headers, body, (request) => {
        current = request;
      });
      current = upstreamRes;
      if (clientGone) {
        upstreamRes.destroy();
        return;
      }
      const isStream = String(upstreamRes.headers['content-type'] ?? '').includes('text/event-stream');
      let held = [];
      let ended = false;
      let wait = 0;
      let reason = '';
      if (upstreamRes.statusCode === 429) {
        wait = headerDelay(upstreamRes.headers);
        reason = '429';
      } else if (upstreamRes.statusCode === 200 && isStream) {
        const inspected = await inspectStream(upstreamRes);
        if (clientGone) return;
        if (inspected.aborted) {
          // Cut off the answer, so Codex sees the abort and retries
          log('upstream stream closed before its first event');
          res.destroy();
          return;
        }
        ({ held, ended } = inspected);
        if (inspected.rateLimit) {
          wait = messageDelay(inspected.rateLimit.message);
          reason = `rate limit in the stream (${inspected.rateLimit.code || 'no code'})`;
        }
      }

      if (!wait || Date.now() - started + wait > MAX_WAIT_MS) {
        if (wait) log(`${reason}, giving up after ${attempt} attempts`);
        // Azure broke off after the inspection gave up its listeners: piping a destroyed stream
        // would leave the answer open, so cut it off for Codex to retry
        if (!ended && upstreamRes.destroyed) {
          log('upstream stream closed before forwarding');
          res.destroy();
          return;
        }
        res.writeHead(upstreamRes.statusCode, forwardHeaders(upstreamRes.headers));
        for (const chunk of held) res.write(chunk);
        if (ended) {
          res.end();
          return;
        }
        // A connection to Azure that breaks off mid-stream must not end the whole proxy: cut off
        // this answer, so Codex sees the abort and retries
        upstreamRes.on('error', (error) => {
          log(`upstream stream error: ${error.message}`);
          res.destroy(error);
        });
        upstreamRes.pipe(res);
        return;
      }
      upstreamRes.on('error', () => {});
      upstreamRes.destroy();
      log(`${reason}, waiting ${Math.round(wait / 1000)} s (attempt ${attempt})`);
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
