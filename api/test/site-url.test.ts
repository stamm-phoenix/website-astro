import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest } from '@azure/functions';
import { PRODUCTION_SITE_URL, getSiteUrl } from '../lib/site-url';

function request(url: string, headers: Record<string, string> = {}): HttpRequest {
  return new HttpRequest({ url, method: 'POST', headers });
}

test('uses the address the request was sent to for our own hosts', () => {
  assert.equal(
    getSiteUrl(request('https://stamm-phoenix.de/api/nikolaus/booking')),
    'https://stamm-phoenix.de'
  );
  const preview = 'zealous-water-04f606303-94.westeurope.6.azurestaticapps.net';
  assert.equal(
    getSiteUrl(
      request('http://internal-functions-host/api/sammelbestellungen', {
        'x-ms-original-url': `https://${preview}/api/sammelbestellungen`,
      })
    ),
    `https://${preview}`
  );
  assert.equal(
    getSiteUrl(request('http://internal/api/x', { 'x-forwarded-host': preview })),
    `https://${preview}`
  );
  assert.equal(getSiteUrl(request('http://localhost:4280/api/x')), 'http://localhost:4280');
});

test('ignores foreign hosts and falls back to production', () => {
  assert.equal(getSiteUrl(request('https://evil.example/api/x')), PRODUCTION_SITE_URL);
  assert.equal(
    getSiteUrl(
      request('https://evil.example/api/x', {
        'x-forwarded-host': 'stamm-phoenix.de.evil.example',
        'x-ms-original-url': 'https://other-app-04f606303.azurestaticapps.net/api/x',
      })
    ),
    PRODUCTION_SITE_URL
  );
  assert.equal(getSiteUrl(request('https://stamm-phoenix.de:8443/api/x')), PRODUCTION_SITE_URL);
});
