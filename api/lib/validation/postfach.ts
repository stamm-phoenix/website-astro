/** Validation of the requests of the module „E-Mail“ (`docs/postfaecher.md`). */
import { z } from 'zod';
import {
  ANHANG_ID,
  KONVERSATION_ID,
  KONVERSATION_MAX,
  NACHRICHT_ID,
  type PostfachStatus,
} from '../postfach-model';
import { lenientObject, parseWith } from './zod';

const RELOAD = 'Bitte lade die Seite neu und versuche es noch einmal.';

/** All messages of one conversation that the reading view reads can be marked at once. */
const MAX_NACHRICHTEN = KONVERSATION_MAX;

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

const gelesenSchema = z.union([
  lenientObject({
    alle: z.literal(true, { error: `Die Markierung ist ungültig. ${RELOAD}` }),
  }),
  lenientObject({
    nachrichten: z
      .array(nachrichtId, { error: `Die Nachrichten sind ungültig. ${RELOAD}` })
      .min(1, { error: `Es fehlen die Nachrichten. ${RELOAD}` })
      .max(MAX_NACHRICHTEN, { error: `Zu viele Nachrichten auf einmal. ${RELOAD}` })
      .transform((ids) => [...new Set(ids)]),
    gelesen: z.boolean({ error: `Die Markierung ist ungültig. ${RELOAD}` }),
  }),
]);

export type GelesenEingabe = { alle: true } | { nachrichten: string[]; gelesen: boolean };

/** `POST …/gelesen`: `{ alle: true }` or `{ nachrichten, gelesen }`. */
export function validateGelesen(value: unknown): GelesenEingabe {
  const parsed = gelesenSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // The issues of the second form name the field that is wrong
  return parseWith(gelesenSchema.options[1], value);
}

const zustaendigSchema = lenientObject({
  konversation: konversationId,
  /** The person to make responsible; null removes the responsibility. */
  login: login.nullable(),
  /** The responsible login the page showed; null when nobody was. */
  vorher: login.nullable().optional().default(null),
});

export interface ZustaendigEingabe {
  konversation: string;
  login: string | null;
  vorher: string | null;
}

/** `PUT …/zustaendig`. */
export function validateZustaendig(value: unknown): ZustaendigEingabe {
  return parseWith(zustaendigSchema, value);
}

const STATUS = ['offen', 'erledigt', 'kein_handlungsbedarf'] as const;
const statusSchema = z.enum(STATUS, { error: `Der Stand ist ungültig. ${RELOAD}` });

/** `PUT …/status`: the new status and the one the page showed. */
export function validateStatus(value: unknown): {
  konversation: string;
  status: PostfachStatus;
  vorher: PostfachStatus;
} {
  return parseWith(
    lenientObject({ konversation: konversationId, status: statusSchema, vorher: statusSchema }),
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
