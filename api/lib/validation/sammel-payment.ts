/**
 * Validation of the payment actions of a Sammelbestellung. They take explicit confirmations and
 * references only, never browser-supplied amounts or state: the amounts come from the stored order.
 */
import { z } from 'zod';
import { SAMMEL_ETAG_FORMAT } from './sammel-input';
import { isRecord, parseWith } from './zod';
import type { FieldOf } from './zod';

export interface SammelPaymentInput {
  action: 'assign' | 'preview' | 'create' | 'adopt' | 'dispatched';
  etag: string;
  personId: string;
  reason: string;
  hash: string;
  feeId: string;
  reference: string;
  evidence: string;
}

const ACTIONS = ['assign', 'preview', 'create', 'adopt', 'dispatched'] as const;

const CHECK = 'Bitte die Angabe prüfen.';

/** A text of the request: trimmed, a missing one is empty, anything but text is no text. */
function trimmedText(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  return value === undefined ? '' : value;
}

/** Free text of at most `max` characters. */
function bounded(max: number, required = false) {
  return z.preprocess(
    trimmedText,
    z
      .string({ error: CHECK })
      .min(required ? 1 : 0, { error: CHECK })
      .max(max, { error: CHECK })
  );
}

/**
 * Text that must match `format` when `required`; the format message then covers every fault of
 * the value but a well-formed one that is too long. Without `required` it is only bounded.
 */
function formatted(max: number, required: boolean, format: RegExp, message: string) {
  if (!required) return bounded(max);
  return z.preprocess(
    trimmedText,
    z.string({ error: message }).regex(format, { error: message }).max(max, { error: CHECK })
  );
}

/** The schema of one action; what an action needs decides which fields are required. */
function paymentSchema(action: string) {
  const adopt = action === 'adopt';
  return z
    .object({
      action: z.enum(ACTIONS, { error: 'Bitte eine gültige Zahlungsaktion wählen.' }),
      etag: formatted(255, true, SAMMEL_ETAG_FORMAT, 'Bitte die Bestellung neu laden.'),
      personId: formatted(
        255,
        action === 'assign',
        /^per_[A-Za-z0-9]+$/,
        'Bitte eine CampFlow-Person auswählen.'
      ),
      hash: formatted(
        64,
        action === 'create' || adopt,
        /^[a-f0-9]{64}$/,
        'Bitte den Beitrag erneut prüfen.'
      ),
      feeId: formatted(255, adopt, /^fee_[A-Za-z0-9]+$/, 'Bitte die CampFlow-Beitrags-ID angeben.'),
      reference: bounded(100, adopt),
      reason: bounded(1000),
      evidence: bounded(1000, adopt || action === 'dispatched'),
      confirmed:
        action === 'preview'
          ? z.unknown().optional()
          : z.literal(true, { error: 'Bitte die Aktion ausdrücklich bestätigen.' }),
      executionEnded: adopt
        ? z.literal(true, {
            error:
              'Bitte bestätigen, dass kein alter Erstellungsversuch mehr läuft und der vorhandene Beitrag geprüft wurde.',
          })
        : z.unknown().optional(),
    })
    .transform((row): SammelPaymentInput => ({
      action: row.action,
      etag: row.etag,
      personId: row.personId,
      reason: row.reason,
      hash: row.hash,
      feeId: row.feeId,
      reference: row.reference,
      evidence: row.evidence,
    }));
}

/** An unknown action is a fault of the whole form. */
const fieldOf: FieldOf = ([first]) =>
  first === 'action' || typeof first !== 'string' ? 'form' : first;

/** Payment actions accept explicit confirmations, never browser-supplied amounts or state. */
export function validateSammelPaymentInput(body: unknown): SammelPaymentInput {
  const row = isRecord(body) ? body : {};
  return parseWith(paymentSchema(typeof row.action === 'string' ? row.action : ''), row, fieldOf);
}
