import type { MockRequest, MockResult } from './mockApi';
import { findPostfach, postfachOutlookUrl } from '../../api/lib/postfach-liste';
import {
  fuerMich,
  istGelesen,
  istMirZugewiesen,
  konversationenAus,
  type InboxNachricht,
  type KonversationDetail,
  type MailNachricht,
  type PostfachPerson,
  type Zustaendigkeit,
} from '../../api/lib/postfach-model';
import { validateGelesen, validateZustaendig } from '../../api/lib/validation/postfach';

/** Demo mails of the module „E-Mail“ (`docs/postfaecher.md`), in memory. */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);

const POSTFACH = 'kontakt';
const ADRESSE = 'kontakt@stamm-phoenix.de';

const PERSONEN: PostfachPerson[] = [
  { login: 'leitung@example.test', name: 'Demo Leitung' },
  { login: 'lea.leitung@example.test', name: 'Lea Leitung' },
  { login: 'tom.test@example.test', name: 'Tom Test' },
];

const vor = (stunden: number): string => new Date(Date.now() - stunden * 3_600_000).toISOString();

interface DemoMail extends InboxNachricht {
  html: string | null;
  text: string | null;
  gesendet?: boolean;
  anhaenge?: MailNachricht['anhaenge'];
}

const erika = { name: 'Erika Muster', adresse: 'erika.muster@example.invalid' };
const MAILS: DemoMail[] = [
  {
    id: 'AAkALgDemo0001',
    konversation: 'AAQkADemoKonv01',
    betreff: 'Schnupperstunde für Mia',
    von: erika,
    am: vor(2),
    vorschau: 'Hallo zusammen, meine Tochter Mia (8) würde gern einmal vorbeischauen …',
    hatAnhang: false,
    wichtig: false,
    html: '<p>Hallo zusammen,</p><p>meine Tochter Mia (8) würde gern einmal bei den Wölflingen vorbeischauen. Passt der kommende Freitag?</p><p>Viele Grüße<br>Erika Muster</p><p><img src="https://example.invalid/pixel.gif" width="1" height="1" alt=""></p>',
    text: null,
  },
  {
    id: 'AAkALgDemo0002',
    konversation: 'AAQkADemoKonv02',
    betreff: 'Rechnung Zeltplatz Sommerlager',
    von: { name: 'Zeltplatz am See', adresse: 'buchung@example.invalid' },
    am: vor(26),
    vorschau: 'Anbei die Rechnung für den Aufenthalt vom 1. bis 8. August.',
    hatAnhang: true,
    wichtig: true,
    html: '<p>Guten Tag,</p><p>anbei die Rechnung für den Aufenthalt vom 1. bis 8. August.</p><p>Mit freundlichen Grüßen</p>',
    text: null,
    anhaenge: [
      {
        id: 'AAMkDemoAnhang1',
        name: 'Rechnung-2026-117.pdf',
        groesse: 182_000,
        typ: 'application/pdf',
      },
    ],
  },
  {
    id: 'AAkALgDemo0003',
    konversation: 'AAQkADemoKonv03',
    betreff: 'Frage zum Nikolausdienst',
    von: { name: 'Familie Beispiel', adresse: 'beispiel@example.invalid' },
    am: vor(80),
    vorschau: 'Kann der Nikolaus auch schon am 4. Dezember kommen?',
    hatAnhang: false,
    wichtig: false,
    html: null,
    text: 'Hallo,\n\nkann der Nikolaus auch schon am 4. Dezember kommen?\n\nDanke und Gruß',
  },
  {
    id: 'AAkALgDemo0004',
    konversation: 'AAQkADemoKonv03',
    betreff: 'AW: Frage zum Nikolausdienst',
    von: { name: 'Kontakt Stamm Phoenix', adresse: ADRESSE },
    am: vor(60),
    vorschau: 'Hallo Familie Beispiel, das klären wir gerade …',
    hatAnhang: false,
    wichtig: false,
    html: '<p>Hallo Familie Beispiel,</p><p>das klären wir gerade und melden uns.</p>',
    text: null,
    gesendet: true,
  },
  {
    id: 'AAkALgDemo0005',
    konversation: 'AAQkADemoKonv04',
    betreff: 'Newsletter Diözesanverband',
    von: { name: 'DPSG Diözese', adresse: 'newsletter@example.invalid' },
    am: vor(24 * 20),
    vorschau: 'Die Termine für das nächste Halbjahr stehen fest.',
    hatAnhang: false,
    wichtig: false,
    html: '<h2>Termine</h2><p>Die Termine für das nächste Halbjahr stehen fest.</p>',
    text: null,
  },
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

function stand() {
  return { marken, gelesenBis };
}

function zeilen() {
  return konversationenAus(
    POSTFACH,
    MAILS.filter((mail) => !mail.gesendet),
    stand(),
    zustaendig
  );
}

function info() {
  return {
    id: POSTFACH,
    name: findPostfach(POSTFACH)?.name ?? 'Kontakt-Postfach',
    address: ADRESSE,
    outlookUrl: postfachOutlookUrl(ADRESSE),
  };
}

export function registerPostfachRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult,
    instant?: boolean
  ) => void,
  login: () => string
): void {
  const unbekannt = (req: MockRequest): MockResult | null =>
    req.params.postfach === POSTFACH
      ? null
      : error(404, 'NOT_FOUND', 'Dieses Postfach gibt es nicht.');

  route('GET', '/api/intern/postfach', () => {
    const alle = zeilen();
    return json({
      ich: login(),
      postfaecher: [
        {
          ...info(),
          ungelesen: alle.filter((zeile) => zeile.ungelesen > 0).length,
          mirZugewiesen: alle.filter((zeile) => istMirZugewiesen(zeile, login())).length,
          fehler: false,
        },
      ],
      fuerMich: fuerMich(alle, login()),
    });
  });

  route(
    'GET',
    '/api/intern/postfach/:postfach',
    (req) => unbekannt(req) ?? json({ postfach: info(), konversationen: zeilen(), ich: login() })
  );

  route('GET', '/api/intern/postfach/:postfach/konversation', (req) => {
    const id = req.query.get('id');
    const mails = MAILS.filter((mail) => mail.konversation === id);
    if (unbekannt(req)) return unbekannt(req)!;
    if (!mails.length) return error(404, 'NOT_FOUND', 'Diese E-Mail ist nicht mehr im Postfach.');
    const eingegangen = mails.filter((mail) => !mail.gesendet);
    const [konversation] = konversationenAus(POSTFACH, eingegangen, stand(), zustaendig);
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
        gelesen: (mail.gesendet ?? false) || istGelesen(mail, stand()),
      })),
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

  route('PUT', '/api/intern/postfach/:postfach/zustaendig', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateZustaendig(req.json);
    const aktuell = zustaendig.get(eingabe.konversation) ?? null;
    if ((aktuell?.login ?? null) !== eingabe.vorher)
      return error(
        409,
        'CONFLICT',
        'Jemand hat die Zuständigkeit inzwischen geändert. Nichts wurde gespeichert.'
      );
    if (!eingabe.login) {
      zustaendig.delete(eingabe.konversation);
      return json({ zustaendig: null, benachrichtigt: false });
    }
    const person = PERSONEN.find((entry) => entry.login === eingabe.login);
    if (!person)
      return error(
        400,
        'INVALID',
        'Diese Person hat keinen Zugriff auf das Postfach. Wähle jemanden aus der Liste.'
      );
    const ich = PERSONEN.find((entry) => entry.login === login()) ?? PERSONEN[0];
    const neu: Zustaendigkeit = {
      login: person.login,
      name: person.name,
      vonLogin: ich.login,
      vonName: ich.name,
      am: new Date().toISOString(),
    };
    zustaendig.set(eingabe.konversation, neu);
    return json({ zustaendig: neu, benachrichtigt: person.login !== login() });
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
