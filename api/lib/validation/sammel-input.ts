/** Validation of the small request bodies of the Sammelbestellungen endpoints. */
import { z } from 'zod';
import { parseWith } from './zod';

/** A concrete quoted ETag, weak or strong; `*` and unquoted versions never match. */
export const SAMMEL_ETAG_FORMAT = /^(?:W\/)?"[^"\r\n]+"$/;

/** Whether the value is a concrete quoted ETag. */
export function isSammelEtag(value: unknown): value is string {
  return z.string().regex(SAMMEL_ETAG_FORMAT).safeParse(value).success;
}

const creationKeySchema = z.object({
  creationKey: z
    .string({ error: 'Bitte öffne das Formular erneut.' })
    .regex(/^[a-f0-9-]{36}$/, { error: 'Bitte öffne das Formular erneut.' }),
});

/** The key that makes creating a campaign safe to repeat (`{ creationKey }`). */
export function validateSammelCreationKey(body: Record<string, unknown>): string {
  return parseWith(creationKeySchema, body).creationKey;
}

const archivedSchema = z.object({
  archived: z.boolean({ error: 'Bitte gib den Archivstatus an.' }),
});

/** Whether a campaign is archived (`{ archived }`). */
export function validateSammelArchived(body: Record<string, unknown>): boolean {
  return parseWith(archivedSchema, body).archived;
}

export interface SammelItemStatusInput {
  index: number;
  excluded: boolean;
}

/** The article of an order (by position) and whether it is left out of the order. */
export function validateSammelItemStatus(
  body: Record<string, unknown>,
  itemCount: number
): SammelItemStatusInput {
  const message = 'Bitte wähle einen Artikel und seinen Bestellstatus.';
  const schema = z.object({
    index: z
      .number({ error: message })
      .refine(Number.isInteger, { error: message })
      .min(0, { error: message })
      .max(itemCount - 1, { error: message }),
    excluded: z.boolean({ error: message }),
  });
  return parseWith(schema, body, () => 'form');
}

const inviteSchema = z.object({
  action: z.enum(['preview', 'send'], { error: 'Bitte wähle Vorschau oder Versand.' }),
});

/** Whether the invitation delivery only counts the audience or sends (`{ action }`). */
export function validateSammelInviteAction(body: Record<string, unknown>): 'preview' | 'send' {
  return parseWith(inviteSchema, body, () => 'form').action;
}
