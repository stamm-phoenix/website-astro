/** Protokolle: the list, files, preview, Termin and sending. */
import type { ProtokollTermin, StaffProtokoll } from '../src/lib/types';
import { mockMitEigenerAdresse } from './mock-data/personen';
import { minimalPdf } from './mock-data/content';
import { MOCK_VERSAND_LIST, mockVersandCount } from './mock-data/protokollEditor';
import { dayFromToday, isoFromNow, MOCK_NOW, newEtag, newId } from './mock-data/util';
import { PRINCIPAL } from './mockAuth';
import { error, json, noContent, notFound, route, str, strings } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Protokolle (Leitendenbereich → Protokolle)

function mockProtokoll(
  id: string,
  date: string,
  title: string,
  values: Partial<StaffProtokoll>
): StaffProtokoll {
  return {
    id,
    etag: newEtag(`protokoll-${id}`),
    fileName: `${date} ${title}.docx`,
    title,
    date,
    status: 'Entwurf',
    webUrl: `https://example.sharepoint.com/sites/leitende/Protokolle/${encodeURIComponent(`${date} ${title}.docx`)}`,
    createdBy: 'kim.beispiel@example.test',
    lastModifiedAt: isoFromNow(-2),
    lastModifiedBy: 'Kim Beispiel',
    reviewNote: '',
    approvedBy: '',
    approvedAt: '',
    changedSinceApproval: false,
    delivery: null,
    termin: null,
    terminStale: false,
    ...values,
  };
}

function mockTermin(values: Partial<ProtokollTermin>): ProtokollTermin {
  return {
    sourceVersion: 'mock-1',
    extraction: 'gefunden',
    suggestion: { date: null, time: null, place: null, quote: null },
    decision: 'offen',
    confirmed: null,
    decidedBy: '',
    decidedAt: '',
    extractedAt: isoFromNow(-2),
    ...values,
  };
}

/** Approved minutes in the demo, one per state of „Nächste Leitendenrunde“. */
function approvedProtokoll(
  id: string,
  daysAgo: number,
  title: string,
  values: Partial<StaffProtokoll>
): StaffProtokoll {
  return mockProtokoll(id, dayFromToday(-daysAgo), title, {
    status: 'Freigegeben',
    approvedBy: 'stavo@example.test',
    approvedAt: isoFromNow(-1),
    ...values,
  });
}

export const protokolle: StaffProtokoll[] = [
  mockProtokoll('prot-1', dayFromToday(-1), 'Leitendenrunde', { status: 'Review' }),
  mockProtokoll('prot-2', dayFromToday(-8), 'Stavo-Sitzung', {
    status: 'Entwurf',
    createdBy: PRINCIPAL.userDetails,
    reviewNote: 'Bitte noch die Termine für das Sommerlager ergänzen.',
  }),
  mockProtokoll('prot-3', dayFromToday(-29), 'Leitendenrunde', {
    status: 'Verschickt',
    approvedBy: 'stavo@example.test',
    approvedAt: isoFromNow(-27),
    delivery: { state: 'sent', recipients: 23, at: isoFromNow(-27), by: 'stavo@example.test' },
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(-1),
        time: '19:30',
        place: 'Pfarrheim',
        quote: 'Nächste LR am Dienstag um 19:30 im Pfarrheim.',
      },
      decision: 'bestaetigt',
      confirmed: { date: dayFromToday(-1), time: '19:30', place: 'Pfarrheim' },
      decidedBy: 'stavo@example.test',
      decidedAt: isoFromNow(-27),
    }),
  }),
  approvedProtokoll('prot-5', 2, 'Leitendenrunde', {
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(26),
        time: '19:30',
        place: 'Pfarrheim St. Georg',
        quote:
          'Die nächste Leitendenrunde findet am Dienstag in vier Wochen um 19:30 Uhr im Pfarrheim St. Georg statt.',
      },
    }),
  }),
  approvedProtokoll('prot-6', 3, 'Stavo-Sitzung', {
    termin: mockTermin({
      extraction: 'unklar',
      suggestion: {
        date: dayFromToday(30),
        time: null,
        place: null,
        quote: 'Nächstes Treffen voraussichtlich Anfang nächsten Monats, Termin folgt per Mail.',
      },
    }),
  }),
  approvedProtokoll('prot-7', 4, 'Leitendenrunde Sommerlager', {
    termin: mockTermin({ extraction: 'fehler' }),
  }),
  approvedProtokoll('prot-8', 5, 'Leitendenrunde', {
    status: 'Verschickt',
    delivery: { state: 'sent', recipients: 23, at: isoFromNow(-3), by: 'stavo@example.test' },
    termin: mockTermin({
      extraction: 'nicht gefunden',
      decision: 'abgelehnt',
      decidedBy: 'stavo@example.test',
      decidedAt: isoFromNow(-3),
    }),
  }),
  approvedProtokoll('prot-9', 6, 'Klausur', {
    changedSinceApproval: true,
    terminStale: true,
    termin: mockTermin({
      suggestion: {
        date: dayFromToday(12),
        time: '18:00',
        place: 'Zeltplatz',
        quote: 'Nächste LR: Freitag, 18 Uhr am Zeltplatz.',
      },
    }),
  }),
  approvedProtokoll('prot-10', 7, 'Leitendenrunde', {
    termin: mockTermin({ extraction: 'nicht gefunden' }),
  }),
  approvedProtokoll('prot-11', 9, 'Leitendenrunde', {
    termin: mockTermin({ extraction: 'nicht eingerichtet' }),
  }),
  mockProtokoll('prot-4', '2025-09-16', 'Protokoll LR', {
    status: 'Archiv',
    fileName: 'Protokoll LR 16.09.25.docx',
    createdBy: '',
    lastModifiedAt: '2025-09-17T19:30:00Z',
  }),
];
const initialProtokolle = structuredClone(protokolle);
/** Back to the demo minutes, for tests that need them as they were (e.g. not sent yet). */
route('POST', '/api/__mock/protokolle/reset', () => {
  protokolle.splice(0, protokolle.length, ...structuredClone(initialProtokolle));
  return noContent();
});

route(['GET', 'POST'], '/api/intern/pflege/protokolle', (req) => {
  if (req.method === 'GET') {
    return json({
      configured: true,
      defaultTitle: 'Leitendenrunde',
      sendingConfigured: true,
      terminConfigured: true,
      login: PRINCIPAL.userDetails,
      items: protokolle,
    });
  }
  const title = str(req.json?.title).trim();
  const date = str(req.json?.date);
  const fields: Record<string, string> = {};
  if (!title || /["*:<>?/\\|#%]/.test(title)) fields.title = 'Bitte einen gültigen Titel angeben.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte das Datum der Sitzung angeben.';
  if (Object.keys(fields).length > 0) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
  }
  if (protokolle.some((p) => p.fileName === `${date} ${title}.docx`)) {
    return error(409, 'EXISTS', 'Für diesen Tag gibt es schon ein Protokoll mit diesem Titel.');
  }
  const created = mockProtokoll(newId(), date, title, {
    createdBy: PRINCIPAL.userDetails,
    lastModifiedAt: new Date(MOCK_NOW).toISOString(),
    lastModifiedBy: 'Demo Leitung',
  });
  protokolle.unshift(created);
  return json({ id: created.id, webUrl: created.webUrl }, 201);
});

route(['POST', 'DELETE'], '/api/intern/pflege/protokolle/:id', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (req.method === 'DELETE') {
    if (protokoll.status === 'Verschickt' || protokoll.status === 'Archiv') {
      return error(400, 'INVALID', 'Verschickte und archivierte Protokolle bleiben erhalten.');
    }
    protokolle.splice(protokolle.indexOf(protokoll), 1);
    return noContent();
  }
  if (str(req.json?.etag) !== protokoll.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  const action = str(req.json?.action);
  const note = str(req.json?.note).trim();
  if (action === 'review' && protokoll.status === 'Entwurf') {
    Object.assign(protokoll, { status: 'Review', reviewNote: '' });
  } else if (
    action === 'approve' &&
    (protokoll.status === 'Entwurf' || protokoll.status === 'Review')
  ) {
    if (protokoll.createdBy === PRINCIPAL.userDetails && req.json?.ownConfirmed !== true) {
      return error(
        400,
        'INVALID',
        'Bestätige bitte, dass du dein eigenes Protokoll ohne zweite Person freigibst.'
      );
    }
    Object.assign(protokoll, {
      status: 'Freigegeben',
      reviewNote: '',
      approvedBy: PRINCIPAL.userDetails,
      approvedAt: new Date(MOCK_NOW).toISOString(),
      terminStale: false,
      termin: mockTermin({
        suggestion: {
          date: dayFromToday(27),
          time: '20:00',
          place: 'Pfarrheim',
          quote: 'Nächste Leitendenrunde: in vier Wochen, 20 Uhr, Pfarrheim.',
        },
      }),
    });
  } else if (action === 'reject' && protokoll.status === 'Review') {
    if (!note) {
      return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
        note: 'Bitte kurz schreiben, was noch fehlt.',
      });
    }
    Object.assign(protokoll, { status: 'Entwurf', reviewNote: note });
  } else if (action === 'reopen' && protokoll.status === 'Freigegeben') {
    Object.assign(protokoll, { status: 'Entwurf', approvedBy: '', approvedAt: '' });
  } else {
    return error(400, 'INVALID', 'Das geht in diesem Status nicht.');
  }
  protokoll.etag = newEtag(`protokoll-${protokoll.id}`);
  // The demo pretends the mail to the author was sent
  return json({ mailSent: action === 'reject' });
});

route(
  'GET',
  '/api/intern/pflege/protokolle/:id/pdf',
  (req) => {
    const protokoll = protokolle.find((p) => p.id === req.params.id);
    if (!protokoll) return notFound();
    const fileName = protokoll.fileName.replace(/\.docx$/, '.pdf');
    return {
      kind: 'raw',
      status: 200,
      contentType: 'application/pdf',
      body: minimalPdf(fileName),
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    };
  },
  true
);

route('GET', '/api/intern/pflege/protokolle/:id/vorschau', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  return json({ url: `/api/intern/pflege/protokolle/${protokoll.id}/vorschau-demo` });
});

route(
  'GET',
  '/api/intern/pflege/protokolle/:id/vorschau-demo',
  (req) => {
    const protokoll = protokolle.find((p) => p.id === req.params.id);
    if (!protokoll) return notFound();
    const title = protokoll.title.replace(/[<>&"]/g, '');
    return {
      kind: 'raw',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem;color:#14202c"><h1>${title}</h1><p>Im echten Betrieb zeigt SharePoint hier das Word-Dokument (nur lesen).</p></body>`,
    };
  },
  true
);

route('POST', '/api/intern/pflege/protokolle/:id/termin', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (!['Freigegeben', 'Verschickt', 'Archiv'].includes(protokoll.status)) {
    return error(400, 'INVALID', 'Nur freigegebene Protokolle haben einen nächsten Termin.');
  }
  if (str(req.json?.etag) !== protokoll.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  const action = str(req.json?.action);
  const now = new Date(MOCK_NOW).toISOString();
  if (protokoll.changedSinceApproval || (action !== 'erkennen' && protokoll.terminStale)) {
    return error(400, 'INVALID', 'Der Termin kann gerade nicht festgelegt werden.');
  }
  const termin =
    protokoll.termin ?? mockTermin({ extraction: 'nicht ausgefuehrt', extractedAt: '' });
  if (action === 'erkennen') {
    protokoll.terminStale = false;
    protokoll.termin = mockTermin({
      extractedAt: now,
      suggestion: {
        date: dayFromToday(21),
        time: '19:30',
        place: 'Pfarrheim',
        quote: 'Nächste Leitendenrunde in drei Wochen, 19:30 Uhr im Pfarrheim.',
      },
    });
  } else if (action === 'bestaetigen') {
    const date = str(req.json?.date);
    const time = str(req.json?.time);
    const place = str(req.json?.place).trim();
    const fields: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte ein Datum angeben.';
    if (time && !/^\d{2}:\d{2}$/.test(time)) fields.time = 'Bitte die Uhrzeit als HH:MM angeben.';
    if (place.length > 120) fields.place = 'Der Ort darf höchstens 120 Zeichen lang sein.';
    if (Object.keys(fields).length > 0) {
      return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
    }
    protokoll.termin = {
      ...termin,
      decision: 'bestaetigt',
      confirmed: { date, time: time || null, place: place || null },
      decidedBy: PRINCIPAL.userDetails,
      decidedAt: now,
    };
  } else if (action === 'ablehnen') {
    protokoll.termin = {
      ...termin,
      decision: 'abgelehnt',
      confirmed: null,
      decidedBy: PRINCIPAL.userDetails,
      decidedAt: now,
    };
  } else {
    return error(400, 'INVALID', 'Unbekannte Aktion.');
  }
  protokoll.etag = newEtag(`protokoll-${protokoll.id}`);
  return json({ termin: protokoll.termin });
});

route('POST', '/api/intern/pflege/protokolle/:id/versand', (req) => {
  const protokoll = protokolle.find((p) => p.id === req.params.id);
  if (!protokoll) return notFound();
  if (protokoll.status !== 'Freigegeben') {
    return error(400, 'INVALID', 'Nur freigegebene Protokolle können verschickt werden.');
  }
  if (str(req.json?.action) === 'preview') {
    return json({
      recipients: MOCK_VERSAND_LIST.length,
      version: 'mock',
      list: mockMitEigenerAdresse(MOCK_VERSAND_LIST),
    });
  }
  const recipients = mockVersandCount(strings(req.json?.excluded), strings(req.json?.extra));
  if (recipients === 0) return error(400, 'INVALID', 'Es ist niemand ausgewählt.');
  Object.assign(protokoll, {
    status: 'Verschickt',
    etag: newEtag(`protokoll-${protokoll.id}`),
    delivery: {
      state: 'sent',
      recipients,
      at: new Date(MOCK_NOW).toISOString(),
      by: PRINCIPAL.userDetails,
    },
  });
  return json({ recipients });
});
