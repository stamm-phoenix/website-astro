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
  istMirZugewiesen,
  kategorieFuer,
  konversationenAus,
  sekunde,
  ZUSTAENDIG_PRAEFIX,
  type InboxNachricht,
  type KonversationDetail,
  type KonversationZeile,
  type OutlookFlag,
  type PostfachPerson,
} from '../../api/lib/postfach-model';
import { aenderungen, nachAenderung } from '../../api/lib/postfach-aenderung';
import {
  validateStatus,
  validateZustaendig,
  validateZustaendigMehrere,
} from '../../api/lib/validation/postfach';

import { ADRESSE, MAILS, vor, type DemoMail } from './mockPostfachMails';

/**
 * Demo mails of the module „E-Mail“ (`docs/postfaecher.md`), in memory. Flags and categories are
 * kept per message as Outlook does, and changed with the same rules as the API.
 */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);

const POSTFACH = 'kontakt';

const PERSONEN: PostfachPerson[] = [
  { login: 'leitung@example.test', name: 'Demo Leitung' },
  { login: 'lea.leitung@example.test', name: 'Lea Leitung' },
  { login: 'tom.test@example.test', name: 'Tom Test' },
];

/** Flag, done time and categories of each message, as Outlook keeps them. */
const outlook = new Map<string, Pick<InboxNachricht, 'flag' | 'erledigtAm' | 'kategorien'>>();

function setzeStart(konversation: string, flag: OutlookFlag, kategorien: string[] = []): void {
  for (const mail of MAILS.filter(
    (entry) => entry.konversation === konversation && !entry.gesendet
  ))
    outlook.set(mail.id, {
      flag,
      erledigtAm: flag === 'complete' ? vor(24 * 4) : null,
      kategorien,
    });
}
setzeStart('AAQkADemoKonv03', 'flagged', [
  kategorieFuer({ login: 'leitung@example.test', name: 'Demo Leitung' }),
]);
setzeStart('AAQkADemoKonv05', 'complete');

function mitStand(mail: DemoMail): InboxNachricht {
  return {
    ...mail,
    ...(outlook.get(mail.id) ?? { flag: 'notFlagged', erledigtAm: null, kategorien: [] }),
  };
}

/** The received messages of a conversation. */
function eingegangen(konversation: string): InboxNachricht[] {
  return MAILS.filter((mail) => mail.konversation === konversation && !mail.gesendet).map(mitStand);
}

/** Only the Kontakt-Postfach has demo mails; the others start empty. */
function zeilen(id: string = POSTFACH): KonversationZeile[] {
  if (id !== POSTFACH) return [];
  return konversationenAus(
    POSTFACH,
    MAILS.filter((mail) => !mail.gesendet).map(mitStand),
    PERSONEN
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

/** Writes the changes into the demo „Outlook“ and answers with the new line. */
function schreibe(
  konversation: string,
  ziel: Parameters<typeof aenderungen>[1]
): KonversationZeile | null {
  const nachrichten = eingegangen(konversation);
  if (!nachrichten.length) return null;
  const danach = nachAenderung(nachrichten, aenderungen(nachrichten, ziel));
  for (const nachricht of danach)
    outlook.set(nachricht.id, {
      flag: nachricht.flag,
      erledigtAm: nachricht.erledigtAm,
      kategorien: nachricht.kategorien,
    });
  return konversationenAus(POSTFACH, danach, PERSONEN)[0];
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
          neu: alle.filter((zeile) => zeile.status === 'neu').length,
          mirZugewiesen: alle.filter(
            (zeile) => zeile.status !== 'erledigt' && istMirZugewiesen(zeile, login())
          ).length,
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
        nurLesen: false,
      })
  );

  route('GET', '/api/intern/postfach/:postfach/konversation', (req) => {
    const id = req.query.get('id') ?? '';
    const mails =
      req.params.postfach === POSTFACH ? MAILS.filter((mail) => mail.konversation === id) : [];
    if (unbekannt(req)) return unbekannt(req)!;
    if (!mails.length) return error(404, 'NOT_FOUND', 'Diese E-Mail ist nicht mehr im Postfach.');
    const [konversation] = konversationenAus(POSTFACH, eingegangen(id), PERSONEN);
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
      })),
      vollstaendig: true,
      outlookUrl: `${postfachOutlookUrl(ADRESSE)}inbox/id/${encodeURIComponent(mails[0].id)}`,
    };
    return json(detail);
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
    if (zeile.status !== eingabe.vorher)
      return error(
        409,
        'CONFLICT',
        'Jemand hat den Stand inzwischen geändert. Nichts wurde gespeichert.'
      );
    // As in the API: already so, nothing changes
    if (eingabe.status === eingabe.vorher)
      return json({ status: zeile.status, erledigtAm: zeile.erledigtAm });
    if (
      eingabe.status !== 'neu' &&
      sekunde(zeile.am) > sekunde(new Date(eingabe.bis).toISOString())
    )
      return error(
        409,
        'NEUE_NACHRICHT',
        'Seit du die Unterhaltung geöffnet hast, ist eine neue Nachricht gekommen. Nichts wurde gespeichert.'
      );
    const neu = schreibe(eingabe.konversation, { status: eingabe.status })!;
    return json({ status: neu.status, erledigtAm: neu.erledigtAm });
  });

  /** One conversation to one person (null: nobody), as `setzeZustaendig` in the API. */
  function weise(
    konversation: string,
    wer: string | null,
    vorher: string | null
  ): { zeile: KonversationZeile | null; fehler?: string; vorher?: string | null } {
    const aktuell = zeilen().find((entry) => entry.id === konversation) ?? null;
    if (!aktuell) return { zeile: null, fehler: 'Diese E-Mail ist nicht mehr im Postfach.' };
    if ((aktuell.zustaendig?.name.toLowerCase() ?? null) !== (vorher?.toLowerCase() ?? null))
      return {
        zeile: aktuell,
        fehler: 'Jemand hat die Zuständigkeit inzwischen geändert. Nichts wurde gespeichert.',
      };
    const person = PERSONEN.find((entry) => entry.login === wer);
    const zeile = schreibe(konversation, {
      kategorie: person ? kategorieFuer(person, PERSONEN) : null,
      status: person && aktuell.status === 'neu' ? 'handlungsbedarf' : undefined,
    });
    return { zeile, vorher: aktuell.zustaendig?.name ?? null };
  }

  const OHNE_ZUGRIFF =
    'Diese Person hat keinen Zugriff auf das Postfach. Wähle jemanden aus der Liste.';

  route('PUT', '/api/intern/postfach/:postfach/zustaendig', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateZustaendig(req.json);
    if (eingabe.login && !PERSONEN.some((entry) => entry.login === eingabe.login))
      return error(400, 'INVALID', OHNE_ZUGRIFF);
    const ergebnis = weise(eingabe.konversation, eingabe.login, eingabe.vorher);
    if (!ergebnis.zeile) return error(404, 'NOT_FOUND', ergebnis.fehler ?? '');
    if (ergebnis.fehler) return error(409, 'CONFLICT', ergebnis.fehler);
    return json({
      zustaendig: ergebnis.zeile.zustaendig,
      status: ergebnis.zeile.status,
      erledigtAm: ergebnis.zeile.erledigtAm,
      benachrichtigt: !!eingabe.login && eingabe.login !== login(),
    });
  });

  route('PUT', '/api/intern/postfach/:postfach/zustaendig-mehrere', (req) => {
    if (unbekannt(req)) return unbekannt(req)!;
    const eingabe = validateZustaendigMehrere(req.json);
    const person = PERSONEN.find((entry) => entry.login === eingabe.login);
    if (eingabe.login && !person) return error(400, 'INVALID', OHNE_ZUGRIFF);
    let neuFuerPerson = false;
    const ergebnisse = eingabe.konversationen.map(({ konversation, vorher }) => {
      const { zeile, fehler, vorher: alt } = weise(konversation, eingabe.login, vorher);
      if (
        !fehler &&
        person &&
        alt?.toLowerCase() !==
          kategorieFuer(person, PERSONEN).slice(ZUSTAENDIG_PRAEFIX.length).toLowerCase()
      )
        neuFuerPerson = true;
      return {
        konversation,
        ok: !fehler,
        zustaendig: zeile?.zustaendig ?? null,
        ...(!fehler && zeile && { status: zeile.status, erledigtAm: zeile.erledigtAm }),
        ...(fehler && { fehler }),
      };
    });
    // As in the API: null when no note was due
    const faellig = !!eingabe.login && eingabe.login !== login() && neuFuerPerson;
    return json({ ergebnisse, benachrichtigt: faellig ? true : null });
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
