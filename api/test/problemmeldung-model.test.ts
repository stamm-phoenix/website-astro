import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIssueBody,
  cleanApiRoute,
  cleanPath,
  cleanProblemContext,
  containsIssueMarker,
  describeBrowser,
  redactForForwarding,
  redactSensitive,
  validateProblemReport,
} from '../lib/problemmeldung-model';
import type { StaffProblemMeldung } from '../lib/problemmeldung-model';
import { parseProblemAssessment, problemModelInput } from '../lib/problemmeldung-ki';

const SOURCE = {
  id: 12,
  createdAt: '2026-10-28T10:00:00.000Z',
  entry: 'fehler' as const,
  environment: 'produktion' as const,
  context: cleanProblemContext({
    page: '/leitendenbereich/belege?token=geheim#x',
    module: 'Belege',
    errorCode: 'INTERNAL',
    httpStatus: 500,
    action: '/api/intern/pflege/belege?x=1',
    appVersion: 'ABC1234',
    browser: 'Firefox 133 · Linux',
    viewport: '390x844',
  }),
};

test('paths lose query, fragment and origin and mask link secrets', () => {
  assert.equal(
    cleanPath('https://stamm-phoenix.de/nikolaus/verwalten?token=abc#frag'),
    '/nikolaus/verwalten'
  );
  assert.equal(cleanPath('/abstimmung/AbCdEfGhIjKlMnOpQrStUvWx'), '/abstimmung/:id');
  assert.equal(cleanPath('/leitendenbereich/aufgaben'), '/leitendenbereich/aufgaben');
  assert.equal(cleanPath('javascript:alert(1)'), '');
  assert.equal(cleanPath('/a b'), '');
  assert.equal(cleanPath(42), '');
  assert.equal(cleanApiRoute('/api/intern/x?y=1'), '/api/intern/x');
  assert.equal(cleanApiRoute('/leitendenbereich'), '');
});

test('the context keeps only the allowed shapes', () => {
  assert.deepEqual(SOURCE.context, {
    page: '/leitendenbereich/belege',
    module: 'Belege',
    errorCode: 'INTERNAL',
    httpStatus: 500,
    action: '/api/intern/pflege/belege',
    correlationId: '',
    appVersion: 'abc1234',
    browser: 'Firefox 133 · Linux',
    viewport: '390x844',
  });
  const hostile = cleanProblemContext({
    errorCode: 'a b',
    httpStatus: 99,
    correlationId: 'x',
    appVersion: 'zzz',
    browser: '<script>',
    viewport: '10x',
    module: '<b>Belege</b>',
  });
  assert.equal(hostile.errorCode, '');
  assert.equal(hostile.httpStatus, null);
  assert.equal(hostile.correlationId, '');
  assert.equal(hostile.appVersion, '');
  assert.equal(hostile.browser, '');
  assert.equal(hostile.viewport, '');
  assert.equal(hostile.module, 'bBelegeb');
});

test('secrets are removed from free text before it is stored or forwarded', () => {
  const text =
    'Seite https://x.de/a?token=123#y, Bearer abc.def, password: hunter2, eyJhbGciOi.eyJzdWIi.sig, ' +
    'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789, mail erika@example.test';
  const redacted = redactSensitive(text);
  assert.match(redacted, /^Seite https:\/\/x\.de\/a /);
  for (const secret of [
    'token=123',
    'abc.def',
    'hunter2',
    'eyJhbGciOi',
    'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  ])
    assert.ok(!redacted.includes(secret), secret);
  assert.ok(redacted.includes('erika@example.test'));
  assert.ok(!redactForForwarding(text).includes('erika@example.test'));
});

test('a report needs a description and a plausible contact address', () => {
  const rejected = validateProblemReport({ description: 'kurz', contact: 'keine-adresse' });
  assert.equal(rejected.report, null);
  assert.deepEqual(Object.keys(rejected.errors).sort(), ['contact', 'description']);
  assert.equal(validateProblemReport({}).errors.description, 'Bitte beschreib das Problem.');
  assert.ok(validateProblemReport({ description: 'x'.repeat(4001) }).errors.description);

  const accepted = validateProblemReport({
    description: '  Der Knopf tut nichts.  ',
    entry: 'fehler',
    contact: ' erika@example.test ',
    context: { page: '/kontakt?a=b' },
    extra: 'ignored',
  });
  assert.equal(accepted.report?.description, 'Der Knopf tut nichts.');
  assert.equal(accepted.report?.entry, 'fehler');
  assert.equal(accepted.report?.contact, 'erika@example.test');
  assert.equal(accepted.report?.context.page, '/kontakt');
  assert.equal(
    validateProblemReport({ description: 'Der Knopf tut nichts.' }).report?.entry,
    'footer'
  );
});

test('a stored description never keeps a token', () => {
  const { report } = validateProblemReport({
    description:
      'Fehler bei https://stamm-phoenix.de/nikolaus/verwalten?token=geheim123 beim Öffnen',
  });
  assert.ok(report && !report.description.includes('geheim123'));
});

test('browsers are reduced to name, major version and system', () => {
  assert.equal(
    describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'),
    'Firefox 133 · Linux'
  );
  assert.equal(
    describeBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
    ),
    'Safari 18 · iOS 18'
  );
  assert.equal(
    describeBrowser(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
    ),
    'Chrome 130 · Android 14'
  );
  assert.equal(describeBrowser('curl/8'), '');
});

test('the issue holds the draft, the technical details and the marker, but no contact', () => {
  const body = buildIssueBody(
    '## Zusammenfassung\n\nKnopf tut nichts. Mail erika@example.test',
    SOURCE
  );
  assert.ok(body.startsWith('## Zusammenfassung'));
  assert.ok(!body.includes('erika@example.test'));
  assert.match(body, /\| Seite \| \/leitendenbereich\/belege \|/);
  assert.match(body, /\| HTTP-Status \| 500 \|/);
  assert.match(body, /\| Umgebung \| Produktion \|/);
  assert.ok(!body.includes('Korrelation'));
  assert.ok(containsIssueMarker(body, 12));
  assert.ok(!containsIssueMarker(body, 1));
});

const MELDUNG: StaffProblemMeldung = {
  id: '12',
  etag: '"0000000000000001"',
  createdAt: SOURCE.createdAt,
  entry: 'footer',
  environment: 'produktion',
  description: 'Es geht nicht, melde dich bei erika@example.test',
  steps: '',
  expected: '',
  contact: 'erika@example.test',
  context: SOURCE.context,
  status: 'neu',
  ai: { status: 'offen', verdict: null, reason: '', error: '', at: null },
  draft: { title: '', body: '', label: 'bug' },
  reviewedBy: '',
  reviewedAt: null,
  discardReason: '',
  github: { number: null, url: '', at: null, pending: false },
};

test('the model gets the report without the contact address and without e-mail addresses', () => {
  const input = problemModelInput(MELDUNG);
  assert.ok(!input.includes('erika@example.test'));
  assert.match(input, /Es geht nicht/);
  assert.match(input, /\/leitendenbereich\/belege/);
});

test('an answer of the model is checked against the schema', () => {
  const answer = {
    verdict: 'plausibel',
    reason: 'Konkret.',
    title: 'Beleg-Upload schlägt fehl',
    summary: 'Das Hochladen schlägt fehl.',
    steps: 'Unbekannt.',
    expected: 'Unbekannt.',
    actual: 'Fehlermeldung.',
    label: 'bug',
  };
  const assessment = parseProblemAssessment(answer);
  assert.equal(assessment.verdict, 'plausibel');
  assert.match(assessment.body, /^## Zusammenfassung\n\nDas Hochladen schlägt fehl\./);
  assert.match(assessment.body, /## Schritte zur Reproduktion\n\nUnbekannt\./);
  for (const broken of [
    { ...answer, verdict: 'veroeffentlichen' },
    { ...answer, label: 'urgent' },
    { ...answer, title: '' },
    { ...answer, steps: 5 },
    null,
  ]) {
    assert.throws(() => parseProblemAssessment(broken), /schema/);
  }
});

test('relative and bare-domain URLs lose their query and fragment', () => {
  const redacted = redactSensitive(
    'Nach /anmelden?code=123456#weiter und x.de?token=abc und stamm-phoenix.de/a/b?x=1 geht nichts.'
  );
  assert.equal(redacted, 'Nach /anmelden und x.de und stamm-phoenix.de/a/b geht nichts.');
  assert.equal(redactSensitive('Warum geht das nicht?'), 'Warum geht das nicht?');
});

test('a query with further paths and parameters is removed completely', () => {
  assert.equal(
    redactSensitive('Seite /anmelden?code=123456&return=/start?x=1#weiter war leer'),
    'Seite /anmelden war leer'
  );
  assert.equal(redactSensitive('https://x.de/a?next=https://y.de/b?code=9'), 'https://x.de/a');
  assert.ok(!redactForForwarding('/anmelden?code=123456&return=/start#weiter').includes('123456'));
});

test('domains in brackets or quotation marks lose their query too', () => {
  for (const open of ['(', '„', '"', "'", '[', '«'.replace('«', '»')]) {
    const text = `Bei ${open}stamm-phoenix.de?code=123456&return=/start#weiter) erscheint ein Fehler.`;
    assert.ok(!redactSensitive(text).includes('123456'), open);
    assert.ok(!redactForForwarding(text).includes('123456'), open);
  }
});

test('every accepted address and the contact itself stay out of forwarded text', () => {
  const contact = 'erika@bücher.de';
  assert.equal(
    validateProblemReport({ description: 'Es geht nicht.', contact }).errors.contact,
    undefined
  );
  const text = `Schreib an erika@bücher.de oder ERIKA@BÜCHER.DE, ${contact}.`;
  assert.ok(!redactForForwarding(text).includes('bücher'));
  assert.ok(!redactForForwarding(text, contact).includes('bücher'));
  const body = buildIssueBody(text, { ...SOURCE, contact });
  assert.ok(!body.includes('bücher'));
});
