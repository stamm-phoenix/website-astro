import type { MockRequest, MockResult } from './mockApi';
import {
  findPostfach,
  POSTFAECHER,
  postfachOutlookUrl,
  postfachRoles,
  type PostfachEintrag,
} from '../../api/lib/postfach-liste';
import {
  fuerMich,
  istGelesen,
  istMirZugewiesen,
  konversationenAus,
  type KonversationDetail,
  type PostfachPerson,
  type Erledigung,
  type Zustaendigkeit,
  statusVon,
} from '../../api/lib/postfach-model';
import {
  validateGelesen,
  validateStatus,
  validateZustaendig,
  validateZustaendigMehrere,
} from '../../api/lib/validation/postfach';

import { ADRESSE, MAILS, vor } from './mockPostfachMails';

/** Demo mails of the module „E-Mail“ (`docs/postfaecher.md`), in memory. */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);

const POSTFACH = 'kontakt';

const PERSONEN: PostfachPerson[] = [
  { login: 'leitung@example.test', name: 'Demo Leitung' },
  { login: 'lea.leitung@example.test', name: 'Lea Leitung' },
  { login: 'tom.test@example.test', name: 'Tom Test' },
];

const marken = new Map<string, boolean>();
let gelesenBis: string = vor(24 * 14);
const zustaendig = new Map<string, Zustaendigkeit>([
  [
    'AAQkADemoKonv03',
    {
      login: 'leitung@example.test',
      name: 'Demo Leitung',
      vonLogin: 'lea.leitung@example.test',
      vonName: 'Lea Leitung',
      am: vor(70),
    },
  ],
]);

const erledigungen = new Map<string, Erledigung>([
  [
    'AAQkADemoKonv05',
    {
      status: 'kein_handlungsbedarf',
      login: 'lea.leitung@example.test',
      name: 'Lea Leitung',
      am: vor(24 * 4),
      bis: vor(24 * 5),
    },
  ],
]);

function stand() {
  return { marken, gelesenBis };
}

/** Only the Kontakt-Postfach has demo mails; the others start empty. */
function zeilen(id: string = POSTFACH) {
  if (id !== POSTFACH) return [];
  return konversationenAus(
    POSTFACH,
    MAILS.filter((mail) => !mail.gesendet),
    stand(),
    zustaendig,
    erledigungen
  );
}

function info(postfach: PostfachEintrag = findPostfach(POSTFACH)!) {
  return {
    id: postfach.id,
    name: postfach.name,
    address: postfach.address,
    outlookUrl: postfachOutlookUrl(postfach.address),
  };
}

export function registerPostfachRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult,
    instant?: boolean
  ) => void,
  login: () => string,
  roles: () => string[]
): void {
  const sichtbar = (): PostfachEintrag[] =>
    POSTFAECHER.filter((postfach) =>
      postfachRoles(postfach).some((role) => roles().includes(role))
    );
  const unbekannt = (req: MockRequest): MockResult | null =>
    sichtbar().some((postfach) => postfach.id === req.params.postfach)
      ? null
      : error(404, 'NOT_FOUND', 'Dieses Postfach gibt es nicht.');

  route('GET', '/api/intern/postfach', () =>
    json({
      ich: login(),
      postfaecher: sichtbar().map((postfach) => {
        const alle = zeilen(postfach.id);
        return {
          ...info(postfach),
          ungelesen: alle.filter((zeile) => zeile.ungelesen > 0).length,
          mirZugewiesen: alle.filter((zeile) => istMirZugewiesen(zeile, login())).length,
          fehler: false,
          gesperrt: false,
        };
      }),
      fuerMich: sichtbar().flatMap((postfach) => fuerMich(zeilen(postfach.id), login())),
    })
  );

  route(
    'GET',
    '/api/intern/postfach/:postfach',
    (req) =>
      unbekannt(req) ??
      json({
        postfach: info(findPostfach(req.params.postfach)),
        konversationen: zeilen(req.params.postfach),
        begrenzt: false,
        ich: login(),
      })
  );

  route('GET', '/api/intern/postfach/:postfach/konversation', (req) => {
    const id = req.query.get('id');
    const mails =
      req.params.postfach === POSTFACH ? MAILS.filter((mail) => mail.konversation === id) : [];
    if (unbekannt(req)) return unbekannt(req)!;
    if (!mails.length) return error(404, 'NOT_FOUND', 'Diese E-Mail ist nicht mehr im Postfach.');
    const eingegangen = mails.filter((mail) => !mail.gesendet);
    const [konversation] = konversationenAus(
      POSTFACH,
      eingegangen,
      stand(),
      zustaendig,
      erledigungen
    );
    const detail: KonversationDetail = {
      konversation,
      nachrichten: mails.map((mail) => ({
        id: mail.id,
        von: mail.von,
        an: [{ name: 'Kontakt Stamm Phoenix', adresse: ADRESSE }],
        cc: [],
        am: mail.am,
        betreff: mail.betreff,
        vorschau: mail.vorschau,
        html: mail.html,
        text: mail.text,
        anhaenge: mail.anhaenge ?? [],
        gesendet: mail.gesendet ?? false,
        imPosteingang: !(mail.gesendet ?? false),
        gelesen: (mail.gesendet ?? false) || istGelesen(mail, stand()),
      })),
      vollstaendig: true,
      outlookUrl: `${postfachOutlookUrl(ADRESSE)}inbox/id/${encodeURIComponent(mails[0].id)}`,
    };
    return json(detail);
  });

  route('POST', '/api/intern/postfach/:postfach/gelesen', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateGelesen(req.json);
    if ('alle' in eingabe) {
      marken.clear();
      gelesenBis = new Date().toISOString();
    } else {
      for (const id of eingabe.nachrichten) marken.set(id, eingabe.gelesen);
    }
    return { kind: 'empty', status: 204 };
  });

  route(
    'GET',
    '/api/intern/postfach/:postfach/personen',
    (req) => unbekannt(req) ?? json({ personen: PERSONEN })
  );

  route('PUT', '/api/intern/postfach/:postfach/status', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateStatus(req.json);
    const zeile = zeilen(req.params.postfach).find((entry) => entry.id === eingabe.konversation);
    if (!zeile) return error(404, 'NOT_FOUND', 'Diese E-Mail ist nicht mehr im Postfach.');
    if (statusVon(zeile) !== eingabe.vorher)
      return error(
        409,
        'CONFLICT',
        'Jemand hat den Stand inzwischen geändert. Nichts wurde gespeichert.'
      );
    // As in the API: already so, who marked it and when stay
    if (eingabe.status === eingabe.vorher) return json({ erledigung: zeile.erledigung ?? null });
    if (eingabe.status !== 'offen' && zeile.am > new Date(eingabe.bis).toISOString())
      return error(
        409,
        'NEUE_NACHRICHT',
        'Seit du die Unterhaltung geöffnet hast, ist eine neue Nachricht gekommen. Nichts wurde gespeichert.'
      );
    if (eingabe.status === 'offen') {
      erledigungen.delete(eingabe.konversation);
      return json({ erledigung: null });
    }
    const ich = PERSONEN.find((entry) => entry.login === login()) ?? PERSONEN[0];
    const neu: Erledigung = {
      status: eingabe.status,
      login: ich.login,
      name: ich.name,
      am: new Date().toISOString(),
      bis: new Date(eingabe.bis).toISOString(),
    };
    erledigungen.set(eingabe.konversation, neu);
    return json({ erledigung: neu });
  });

  /** One conversation to one person (null: nobody), as `setzeZustaendigkeit` in the API. */
  function weise(
    konversation: string,
    wer: string | null,
    vorher: string | null
  ): { zustaendig: Zustaendigkeit | null; fehler?: string } {
    const aktuell = zustaendig.get(konversation) ?? null;
    if ((aktuell?.login ?? null) !== vorher)
      return {
        zustaendig: aktuell,
        fehler: 'Jemand hat die Zuständigkeit inzwischen geändert. Nichts wurde gespeichert.',
      };
    const person = PERSONEN.find((entry) => entry.login === wer);
    if (!person) {
      zustaendig.delete(konversation);
      return { zustaendig: null };
    }
    const ich = PERSONEN.find((entry) => entry.login === login()) ?? PERSONEN[0];
    const neu: Zustaendigkeit = {
      login: person.login,
      name: person.name,
      vonLogin: ich.login,
      vonName: ich.name,
      am: new Date().toISOString(),
    };
    zustaendig.set(konversation, neu);
    return { zustaendig: neu };
  }

  const OHNE_ZUGRIFF =
    'Diese Person hat keinen Zugriff auf das Postfach. Wähle jemanden aus der Liste.';

  route('PUT', '/api/intern/postfach/:postfach/zustaendig', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateZustaendig(req.json);
    if (eingabe.login && !PERSONEN.some((entry) => entry.login === eingabe.login))
      return error(400, 'INVALID', OHNE_ZUGRIFF);
    const ergebnis = weise(eingabe.konversation, eingabe.login, eingabe.vorher);
    if (ergebnis.fehler) return error(409, 'CONFLICT', ergebnis.fehler);
    return json({
      zustaendig: ergebnis.zustaendig,
      benachrichtigt: !!eingabe.login && eingabe.login !== login(),
    });
  });

  route('PUT', '/api/intern/postfach/:postfach/zustaendig-mehrere', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateZustaendigMehrere(req.json);
    if (eingabe.login && !PERSONEN.some((entry) => entry.login === eingabe.login))
      return error(400, 'INVALID', OHNE_ZUGRIFF);
    const ergebnisse = eingabe.konversationen.map(({ konversation, vorher }) => {
      const ergebnis = weise(konversation, eingabe.login, vorher);
      return { konversation, ok: !ergebnis.fehler, ...ergebnis };
    });
    return json({
      ergebnisse,
      benachrichtigt:
        !!eingabe.login && eingabe.login !== login() && ergebnisse.some((entry) => entry.ok),
    });
  });

  route(
    'GET',
    '/api/intern/postfach/:postfach/anhang',
    () => ({
      kind: 'raw',
      status: 200,
      contentType: 'application/octet-stream',
      body: 'Demo-Anhang',
      headers: { 'Content-Disposition': 'attachment; filename="Rechnung-2026-117.pdf"' },
    }),
    true
  );
}
