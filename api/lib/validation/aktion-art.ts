/** Validation of the flags the Leitende set on CampFlow Aktionen. */
import { z } from 'zod';
import { lenientObject, parseWith } from './zod';

const grantSchema = lenientObject({
  zuschussfaehig: z.boolean({
    error: 'Gib an, ob für die Aktion ein KJR-Zuschuss beantragt wird.',
  }),
});

const keineAktionSchema = lenientObject({
  keineAktion: z.boolean({
    error: 'Gib an, ob das Event eine Aktion ist oder nur eine Bestellung oder Anmeldung.',
  }),
});

/** Whether the KJR grant is applied for a CampFlow Aktion (`{ zuschussfaehig }`). */
export function validateAktionZuschuss(body: unknown): boolean {
  return parseWith(grantSchema, body).zuschussfaehig;
}

/** Whether a CampFlow event is no real Aktion, e.g. an order of jumpers (`{ keineAktion }`). */
export function validateKeineAktion(body: unknown): boolean {
  return parseWith(keineAktionSchema, body).keineAktion;
}
