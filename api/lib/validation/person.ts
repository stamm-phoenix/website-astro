/** Validation of the persons of the module „Personen“ (#301, docs/personen.md). */
import { z } from 'zod';
import { CAMPFLOW_PERSON_ID } from '../personen-model';
import type { PersonInput } from '../personen-model';
import { MAX_TITEL } from '../protokoll-editor-model';
import { collapseText } from './text';
import { choice, isRecord, labeledText, parseWith } from './zod';

const LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRUPPEN = ['leitende', 'altleitende', 'weitere'] as const;

/** The login as e-mail address, in lower case; leaders need one. A wrong format beats the length. */
function loginField(leader: boolean) {
  const missing = 'Leitende brauchen die E-Mail-Adresse ihres Microsoft-Kontos.';
  const text = z
    .string({ error: 'Der Login ist ungültig.' })
    .refine((login) => !login || LOGIN.test(login), {
      error: 'Bitte den Login als E-Mail-Adresse angeben oder leer lassen.',
    })
    .max(254, { error: 'Der Login darf höchstens 254 Zeichen lang sein.' });
  return z.preprocess(
    (value) => {
      const login = collapseText(value);
      return typeof login === 'string' ? login.toLowerCase() : login;
    },
    leader ? text.min(1, { error: missing }) : text
  );
}

/** The ID of the linked CampFlow person; every deviation shows the same hint. */
const campflowPersonId = z.preprocess(
  collapseText,
  z
    .string({ error: 'Die CampFlow-Person ist ungültig.' })
    .refine((id) => !id || CAMPFLOW_PERSON_ID.test(id), {
      error: 'Bitte eine Person aus der CampFlow-Mitgliederliste wählen.',
    })
);

function personSchema(leader: boolean) {
  return z.object({
    name: labeledText('einen Namen', MAX_TITEL, true),
    login: loginField(leader),
    gruppe: choice('die Gruppe', GRUPPEN),
    campflowPersonId,
    aktiv: z.boolean({ error: 'Bitte angeben, ob die Person aktiv ist.' }),
  });
}

/**
 * A person of the module „Personen“: a leader's link to CampFlow, or Altleitende and others to
 * pick in the minutes.
 */
export function validatePerson(body: unknown): PersonInput {
  const record = isRecord(body) ? body : {};
  return parseWith(personSchema(record.gruppe === 'leitende'), record);
}
