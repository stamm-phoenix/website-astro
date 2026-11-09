/** Validation of the requests of the module „E-Mail“ (`docs/postfaecher.md`). */
import { z } from 'zod';
import { ANHANG_ID, KONVERSATION_ID, NACHRICHT_ID, type PostfachStatus } from '../postfach-model';
import { lenientObject, parseWith } from './zod';

const RELOAD = 'Bitte lade die Seite neu und versuche es noch einmal.';

const konversationId = z
  .string({ error: `Die Konversation ist ungültig. ${RELOAD}` })
  .regex(KONVERSATION_ID, { error: `Die Konversation ist ungültig. ${RELOAD}` });

const nachrichtId = z
  .string({ error: `Die Nachricht ist ungültig. ${RELOAD}` })
  .regex(NACHRICHT_ID, { error: `Die Nachricht ist ungültig. ${RELOAD}` });

const login = z
  .string({ error: `Die Person ist ungültig. ${RELOAD}` })
  .trim()
  .toLowerCase()
  .min(3, { error: `Die Person ist ungültig. ${RELOAD}` })
  .max(254, { error: `Die Person ist ungültig. ${RELOAD}` })
  .regex(/^[^\s@]+@[^\s@]+$/, { error: `Die Person ist ungültig. ${RELOAD}` });

/** The name of the responsible person the page showed; null when nobody was. */
const vorherName = z
  .string({ error: `Die Zuständigkeit ist ungültig. ${RELOAD}` })
  .trim()
  .max(200, { error: `Die Zuständigkeit ist ungültig. ${RELOAD}` })
  .nullable();

const zustaendigSchema = lenientObject({
  konversation: konversationId,
  /** The person to make responsible; null removes the responsibility. */
  login: login.nullable(),
  vorher: vorherName.optional().default(null),
});

export interface ZustaendigEingabe {
  konversation: string;
  login: string | null;
  vorher: string | null;
}

/** Conversations changed at once from the list; a page shows at most 100. */
const MAX_AUSWAHL = 100;

const mehrereSchema = lenientObject({
  login: login.nullable(),
  konversationen: z
    .array(lenientObject({ konversation: konversationId, vorher: vorherName.default(null) }), {
      error: `Die Auswahl ist ungültig. ${RELOAD}`,
    })
    .min(1, { error: `Es ist keine E-Mail ausgewählt. ${RELOAD}` })
    .max(MAX_AUSWAHL, { error: `Zu viele E-Mails auf einmal. ${RELOAD}` }),
});

export interface ZustaendigMehrereEingabe {
  login: string | null;
  konversationen: { konversation: string; vorher: string | null }[];
}

/** `PUT …/zustaendig-mehrere`: one person (or nobody) for several conversations. */
export function validateZustaendigMehrere(value: unknown): ZustaendigMehrereEingabe {
  const eingabe = parseWith(mehrereSchema, value);
  // The same conversation twice would only conflict with itself
  const gesehen = new Set<string>();
  return {
    login: eingabe.login,
    konversationen: eingabe.konversationen.filter(({ konversation }) =>
      gesehen.has(konversation) ? false : (gesehen.add(konversation), true)
    ),
  };
}

/** `PUT …/zustaendig`. */
export function validateZustaendig(value: unknown): ZustaendigEingabe {
  return parseWith(zustaendigSchema, value);
}

const STATUS = ['neu', 'handlungsbedarf', 'erledigt'] as const;
const statusSchema = z.enum(STATUS, { error: `Der Stand ist ungültig. ${RELOAD}` });

/** `PUT …/status`: the new status and the one the page showed. */
export function validateStatus(value: unknown): {
  konversation: string;
  status: PostfachStatus;
  vorher: PostfachStatus;
  /** Received time of the newest message the page showed. */
  bis: string;
} {
  return parseWith(
    lenientObject({
      konversation: konversationId,
      status: statusSchema,
      vorher: statusSchema,
      bis: z.iso.datetime({ offset: true, error: `Der Stand ist ungültig. ${RELOAD}` }),
    }),
    value
  );
}

/** The conversation ID of a query string. */
export function validateKonversationId(value: string | null): string {
  return parseWith(lenientObject({ konversation: konversationId }), { konversation: value })
    .konversation;
}

/** `GET …/anhang?nachricht=&anhang=`. */
export function validateAnhang(
  nachricht: string | null,
  anhang: string | null
): {
  nachricht: string;
  anhang: string;
} {
  return parseWith(
    lenientObject({
      nachricht: nachrichtId,
      anhang: z
        .string({ error: `Der Anhang ist ungültig. ${RELOAD}` })
        .regex(ANHANG_ID, { error: `Der Anhang ist ungültig. ${RELOAD}` }),
    }),
    { nachricht, anhang }
  );
}
