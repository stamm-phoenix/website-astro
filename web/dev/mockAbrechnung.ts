/** CampFlow in the Leitendenbereich: Aktionen, Beiträge, Kostenstellen and Abrechnung. */
import { emptySession, parseSession } from '../../api/lib/abrechnung-session';
import type { AbrechnungEingabe } from '../../api/lib/abrechnung-session';
import {
  abrechnungFor,
  belegBildFor,
  belegVorschauFor,
  kjrListeFor,
  kostenstellen,
} from './mock-data/abrechnung';
import { beitraegeFor, offeneBeitraegeFor } from './mock-data/beitraege';
import { kostenstellenFor } from './mock-data/kostenstellen';
import { aktionBeitraegeFor, campflowDetail, campflowEvents } from './mock-data/campflow';
import { mitgliederData } from './mock-data/mitglieder';
import { namiAbgleichData } from './mock-data/namiAbgleich';
import { mockIch, mockEigeneAnmeldungen } from './mock-data/personen';
import { MOCK_NOW } from './mock-data/util';
import { error, json, notFound, route } from './mockCore';
import { PRINCIPAL } from './mockAuth';

// ---------------------------------------------------------------------------------------------
// CampFlow (Leitendenbereich → Aktionen)

route('GET', '/api/intern/aktionen', () => json(campflowEvents));
route('GET', '/api/intern/aktionen/:id', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const detail = campflowDetail(req.params.id);
  return detail
    ? json({ ...detail, ich: mockEigeneAnmeldungen(detail.persons) })
    : notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
});

route('GET', '/api/intern/mitglieder', () => json(mitgliederData()));
route('GET', '/api/intern/nami-abgleich', () => {
  if (!['team_admin', 'team_vorstand'].some((role) => PRINCIPAL.userRoles.includes(role))) {
    return error(403, 'NOT_IN_TEAM', 'Den Nami-Abgleich sehen nur die Teams Admin und Vorstand.');
  }
  return json(namiAbgleichData());
});

route('GET', '/api/intern/aktionen/:id/beitraege', (req) => {
  const beitraege = aktionBeitraegeFor(req.params.id, req.query.get('refresh') === 'true');
  return beitraege ? json(beitraege) : notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
});

/** The KJR choice per event, kept while it is marked as no Aktion (like the database). */
const zuschussGewaehlt = new Map<string, boolean>();

route('PUT', '/api/intern/pflege/aktionen-zuschuss/:id', (req) => {
  const event = campflowEvents.find((e) => e.id === req.params.id);
  if (!event) return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  const zuschussfaehig = req.json?.zuschussfaehig;
  if (typeof zuschussfaehig !== 'boolean') {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.');
  }
  zuschussGewaehlt.set(event.id, zuschussfaehig);
  event.zuschussfaehig = zuschussfaehig && !event.keineAktion;
  return json({ zuschussfaehig: event.zuschussfaehig });
});

route('PUT', '/api/intern/pflege/aktionen-art/:id', (req) => {
  const event = campflowEvents.find((e) => e.id === req.params.id);
  if (!event) return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  const keineAktion = req.json?.keineAktion;
  if (typeof keineAktion !== 'boolean') {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.');
  }
  event.keineAktion = keineAktion;
  event.zuschussfaehig = !keineAktion && (zuschussGewaehlt.get(event.id) ?? true);
  return json({ keineAktion, zuschussfaehig: event.zuschussfaehig });
});

// Beiträge: read from CampFlow by the Playwright API in production
route('GET', '/api/intern/beitraege', (req) =>
  json(beitraegeFor(req.query.get('refresh') === 'true'))
);
route('GET', '/api/intern/beitraege/meine', () =>
  json(offeneBeitraegeFor(mockIch(PRINCIPAL.userDetails).campflow?.id ?? null))
);

// Kostenstellen: sums of CampFlow's report, exported by the Playwright API in production
route('GET', '/api/intern/kostenstellen/summen', (req) => {
  if (!['team_kasse', 'team_vorstand'].some((role) => PRINCIPAL.userRoles.includes(role))) {
    return error(403, 'NOT_IN_TEAM', 'Die Kostenstellen sehen nur die Kasse und der Vorstand.');
  }
  return json(kostenstellenFor(req.query.get('refresh') === 'true'));
});

// Abrechnung: Einzelnachweise come from the Playwright API in production
const abrechnungDrafts = new Map<string, AbrechnungEingabe>();
route('GET', '/api/intern/abrechnung/:id/eingaben', (req) =>
  json(
    abrechnungDrafts.get(req.params.id) ?? {
      session: emptySession(),
      etag: null,
      savedAt: null,
      deleteAfter: null,
    }
  )
);
route('PUT', '/api/intern/abrechnung/:id/eingaben', (req) => {
  const body = req.json as { session: unknown; etag: string | null };
  const previous = abrechnungDrafts.get(req.params.id);
  if ((previous?.etag ?? null) !== body.etag)
    return json(
      { code: 'CONFLICT', message: 'Die Eingaben wurden auf einem anderen Gerät geändert.' },
      409
    );
  const saved: AbrechnungEingabe = {
    session: parseSession(body.session),
    etag: String(Number(previous?.etag ?? 0) + 1),
    savedAt: new Date().toISOString(),
    deleteAfter: '2026-12-11',
  };
  abrechnungDrafts.set(req.params.id, saved);
  return json(saved);
});
// Zeitplan of the Kurzbeschreibung, read by the model of the receipt check in production
route('POST', '/api/intern/abrechnung/:id/zeitplan', (req) => {
  const event = campflowDetail(req.params.id)?.event;
  if (!event) return notFound('Diese Aktion gibt es nicht mehr.');
  const body = req.json as { bilder?: unknown; tabelle?: unknown; freitext?: unknown } | null;
  if (!body || (!Array.isArray(body.bilder) && !body.tabelle && typeof body.freitext !== 'string'))
    return error(400, 'INVALID', 'Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.');
  const start = (event.start_date ?? new Date(MOCK_NOW).toISOString()).slice(0, 10);
  const day = (offset: number): string => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return json({
    available: true,
    zeitplan: {
      einleitung: 'Mit der Aktion wollen wir die Gemeinschaft im Stamm stärken.',
      tage: [
        {
          datum: day(0),
          bloecke: [
            { von: '10:00', bis: '12:00', text: 'Anreise und Aufbau' },
            { von: '12:30', bis: '13:30', text: 'Mittagessen' },
            { von: '14:00', bis: '17:00', text: 'Geländespiel' },
            { von: '18:00', bis: '19:00', text: 'Abendessen' },
            { von: '20:00', bis: '', text: 'Lagerfeuer' },
          ],
        },
        {
          datum: day(1),
          bloecke: [
            { von: '08:00', bis: '09:00', text: 'Frühstück' },
            { von: '09:30', bis: '12:00', text: 'Abbau' },
            { von: '12:00', bis: '', text: 'Abreise' },
          ],
        },
      ],
    },
  });
});
route('GET', '/api/intern/kostenstellen', () => json(kostenstellen));
route(
  'GET',
  '/api/intern/abrechnung/belege/:nummer/bild',
  (req) => {
    const page = Number(req.query.get('page') ?? '1');
    if (!Number.isInteger(page) || page < 1) return error(400, 'INVALID_PAGE', 'Ungültige Seite.');
    const result = belegBildFor(req.params.nummer, page);
    if (result === 'NOT_FOUND') {
      return error(
        404,
        'BELEG_NOT_FOUND',
        `Den Beleg ${req.params.nummer} gibt es in CampFlow nicht.`
      );
    }
    return {
      kind: 'raw',
      status: 200,
      contentType: 'image/png',
      body: result.png,
      headers: { 'x-campflow-pages': String(result.pages) },
    };
  },
  true
);
route(
  'GET',
  '/api/intern/abrechnung/belege/:nummer/vorschau',
  (req) => {
    const png = belegVorschauFor(req.params.nummer);
    if (png === 'NOT_FOUND') {
      return error(
        404,
        'BELEG_NOT_FOUND',
        `Den Beleg ${req.params.nummer} gibt es in CampFlow nicht.`
      );
    }
    return { kind: 'raw', status: 200, contentType: 'image/png', body: png };
  },
  true
);
route('POST', '/api/intern/abrechnung/:id/kjr-liste', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const result = kjrListeFor(req.params.id, req.json);
  if (result === 'NOT_FOUND') return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  if (result === 'OHNE_ZUSCHUSS') {
    return error(
      409,
      'OHNE_ZUSCHUSS',
      'Für diese Aktion wird kein KJR-Zuschuss beantragt, deshalb gibt es keine Teilnahmeliste für den KJR.'
    );
  }
  if ('error' in result) {
    return error(
      result.status,
      result.status === 422 ? 'TOO_MANY_PERSONS' : 'INVALID_INPUT',
      result.error
    );
  }
  return {
    kind: 'raw',
    status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: result.file,
    headers: {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    },
  };
});
route('GET', '/api/intern/abrechnung/:id', (req) => {
  if (!/^evt_[A-Za-z0-9]+$/.test(req.params.id))
    return error(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  const requested = req.query.get('kostenstelle') ?? '';
  const result = abrechnungFor(
    req.params.id,
    requested.trim(),
    req.query.get('refresh') === 'true'
  );
  if (result === 'NOT_FOUND') return notFound('Diese Aktion gibt es in CampFlow nicht (mehr).');
  if (result === 'KOSTENSTELLE_NOT_FOUND') {
    const name = requested.trim() || campflowDetail(req.params.id)?.event.title;
    return error(
      404,
      'KOSTENSTELLE_NOT_FOUND',
      `Die Kostenstelle „${name}“ gibt es in CampFlow nicht.`
    );
  }
  return json({
    ...result,
    ich: mockEigeneAnmeldungen(campflowDetail(req.params.id)?.persons ?? []),
  });
});
