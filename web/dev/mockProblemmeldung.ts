/** Problemmeldungen: „Problem melden“ and its review in the Leitendenbereich. */
import {
  PROBLEM_LABELS,
  PROBLEM_MAX_LENGTH,
  isProblemOpen,
  validateProblemReport,
} from '../src/lib/problemMelden';
import type { StaffProblemMeldung } from '../src/lib/problemMelden';
import { newEtag } from './mock-data/util';
import { error, json, notFound, route, str } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { CAPTCHA_FAILED } from './mockKontakt';
import { PRINCIPAL } from './mockAuth';

// ---------------------------------------------------------------------------------------------
// Problem melden

function mockMeldung(id: number, values: Partial<StaffProblemMeldung>): StaffProblemMeldung {
  return {
    id: String(id),
    etag: newEtag(`problem-${id}`),
    createdAt: new Date(Date.now() - id * 3_600_000).toISOString(),
    entry: 'footer',
    environment: 'vorschau',
    description: '',
    steps: '',
    expected: '',
    contact: '',
    context: {
      page: '',
      module: '',
      errorCode: '',
      httpStatus: null,
      action: '',
      correlationId: '',
      appVersion: 'abc1234',
      browser: 'Firefox 133 · Linux',
      viewport: '390x844',
    },
    status: 'neu',
    ai: { status: 'offen', verdict: null, reason: '', error: '', at: null },
    draft: { title: '', body: '', label: 'bug' },
    reviewedBy: '',
    reviewedAt: null,
    discardReason: '',
    github: { number: null, url: '', at: null, pending: false },
    ...values,
  };
}

const problemmeldungen: StaffProblemMeldung[] = [
  mockMeldung(3, {
    entry: 'fehler',
    description: 'Beim Einreichen eines Belegs kommt eine Fehlermeldung. (Testdaten)',
    steps: '1. Belege öffnen\n2. Foto auswählen\n3. „Beleg einreichen“ tippen',
    contact: 'erika@example.test',
    context: {
      page: '/leitendenbereich/belege',
      module: 'Belege',
      errorCode: 'INTERNAL',
      httpStatus: 500,
      action: '/api/intern/pflege/belege',
      correlationId: '8a1b2c3d4e5f6789-FRA',
      appVersion: 'abc1234',
      browser: 'Firefox 133 · Linux',
      viewport: '390x844',
    },
    ai: {
      status: 'fertig',
      verdict: 'plausibel',
      reason: 'Konkrete Schritte und ein Fehlercode liegen vor.',
      error: '',
      at: new Date().toISOString(),
    },
    draft: {
      title: 'Belege: Einreichen endet mit einem Serverfehler',
      body: '## Zusammenfassung\n\nBeim Einreichen eines Belegs erscheint eine Fehlermeldung.\n\n## Schritte zur Reproduktion\n\n1. Belege öffnen\n2. Foto auswählen\n3. „Beleg einreichen“ tippen\n\n## Erwartetes Verhalten\n\nUnbekannt.\n\n## Tatsächliches Verhalten\n\nFehlermeldung (HTTP 500).',
      label: 'bug',
    },
  }),
  mockMeldung(2, {
    description: 'Auf dem Handy ist die Startseite abgeschnitten. (Testdaten)',
    ai: {
      status: 'fehler',
      verdict: null,
      reason: '',
      error: 'Azure OpenAI request timed out',
      at: null,
    },
  }),
  mockMeldung(1, {
    description: 'Günstige Uhren kaufen!!! (Testdaten)',
    ai: {
      status: 'fertig',
      verdict: 'spam',
      reason: 'Werbung ohne Bezug zur Website.',
      error: '',
      at: new Date().toISOString(),
    },
    draft: { title: 'Werbung', body: '## Zusammenfassung\n\nWerbetext.', label: 'bug' },
  }),
];

route('POST', '/api/problemmeldung', (req) => {
  const { report, errors } = validateProblemReport(req.json ?? {});
  if (!report)
    return error(
      400,
      'VALIDATION_FAILED',
      'Bitte prüf deine Angaben.',
      errors as Record<string, string>
    );
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  const id = problemmeldungen.length + 1;
  problemmeldungen.unshift(
    mockMeldung(id, {
      entry: report.entry,
      description: report.description,
      steps: report.steps,
      expected: report.expected,
      contact: report.contact,
      context: report.context,
      createdAt: new Date().toISOString(),
    })
  );
  return json({ status: 'sent', id: `PM-${id}` });
});

route('GET', '/api/intern/pflege/problemmeldungen', () =>
  json({
    items: problemmeldungen,
    labels: PROBLEM_LABELS,
    github: { repository: 'stamm-phoenix/website-astro', unavailable: null },
    maxLength: { title: PROBLEM_MAX_LENGTH.title, body: PROBLEM_MAX_LENGTH.body },
  })
);

function openMeldung(req: MockRequest): StaffProblemMeldung | MockResult {
  const meldung = problemmeldungen.find((item) => item.id === req.params.id);
  if (!meldung) return notFound();
  if (!isProblemOpen(meldung.status) || req.json?.etag !== meldung.etag)
    return error(
      409,
      'STATE',
      'Die Meldung wurde inzwischen von jemand anderem geändert. Bitte lade sie neu.'
    );
  return meldung;
}

route('PATCH', '/api/intern/pflege/problemmeldungen/:id', (req) => {
  const meldung = openMeldung(req);
  if (!('id' in meldung)) return meldung;
  Object.assign(meldung, {
    status: 'in_pruefung',
    reviewedBy: PRINCIPAL.userDetails,
    reviewedAt: new Date().toISOString(),
    draft: {
      title: str(req.json?.title),
      body: str(req.json?.body),
      label: str(req.json?.label, 'bug'),
    },
    etag: newEtag(`problem-${meldung.id}`),
  });
  return json(meldung);
});

route('POST', '/api/intern/pflege/problemmeldungen/:id/verwerfen', (req) => {
  const meldung = openMeldung(req);
  if (!('id' in meldung)) return meldung;
  Object.assign(meldung, {
    status: 'verworfen',
    contact: '',
    discardReason: str(req.json?.reason),
    reviewedBy: PRINCIPAL.userDetails,
    reviewedAt: new Date().toISOString(),
    etag: newEtag(`problem-${meldung.id}`),
  });
  return json(meldung);
});

route('POST', '/api/intern/pflege/problemmeldungen/:id/github', (req) => {
  const meldung = openMeldung(req);
  if (!('id' in meldung)) return meldung;
  const number = 300 + Number(meldung.id);
  Object.assign(meldung, {
    status: 'uebermittelt',
    contact: '',
    reviewedBy: PRINCIPAL.userDetails,
    github: {
      number,
      url: `https://github.com/stamm-phoenix/website-astro/issues/${number}`,
      at: new Date().toISOString(),
      pending: false,
    },
    etag: newEtag(`problem-${meldung.id}`),
  });
  return json({ meldung, found: false });
});

route('POST', '/api/intern/pflege/problemmeldungen/:id/bewerten', (req) => {
  const meldung = problemmeldungen.find((item) => item.id === req.params.id);
  if (!meldung) return notFound();
  Object.assign(meldung, {
    ai: {
      status: 'fertig',
      verdict: 'plausibel',
      reason: 'Nachvollziehbar und konkret (Demo).',
      error: '',
      at: new Date().toISOString(),
    },
    draft: meldung.draft.title
      ? meldung.draft
      : {
          title: 'Startseite auf dem Handy abgeschnitten',
          body: '## Zusammenfassung\n\nDie Startseite ist auf dem Handy abgeschnitten.',
          label: 'bug',
        },
  });
  return json(meldung);
});
