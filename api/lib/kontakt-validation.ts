/**
 * Validation rules for the contact form, shared between the API and the web frontend
 * (re-exported via `web/src/lib/kontaktConfig.ts`). Must stay free of imports.
 */

/** Topics a visitor can choose; the label ends up in the subject of the mail to the Stamm. */
export const KONTAKT_TOPICS = [
  { id: 'gruppenstunden', label: 'Gruppenstunden & Schnuppern' },
  { id: 'mitgliedschaft', label: 'Mitgliedschaft' },
  { id: 'aktionen', label: 'Aktionen & Zeltlager' },
  { id: 'leiten', label: 'Mitmachen als Leiter*in' },
  { id: 'sonstiges', label: 'Sonstiges' },
] as const;

export type KontaktTopic = (typeof KONTAKT_TOPICS)[number]['id'];

export const KONTAKT_MAX_LENGTH = {
  name: 100,
  email: 254,
  message: 5000,
};

/** Shorter messages are almost always accidental submissions. */
export const KONTAKT_MIN_MESSAGE_LENGTH = 10;

export interface KontaktMessage {
  name: string;
  email: string;
  topic: KontaktTopic;
  message: string;
}

export type KontaktField = keyof KontaktMessage;

export type KontaktInput = Partial<Record<KontaktField, unknown>>;

export interface KontaktValidation {
  /** The trimmed message, or `null` if any field is invalid. */
  message: KontaktMessage | null;
  errors: Partial<Record<KontaktField, string>>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Whether the value is a plausible e-mail address within the length limit. */
export function isValidKontaktEmail(value: unknown): value is string {
  const email = readText(value, KONTAKT_MAX_LENGTH.email);
  return email !== null && EMAIL_PATTERN.test(email);
}

export function findKontaktTopic(id: unknown): (typeof KONTAKT_TOPICS)[number] | undefined {
  return KONTAKT_TOPICS.find((topic) => topic.id === id);
}

/** Validates a contact message; all fields are required. */
export function validateKontaktMessage(input: KontaktInput): KontaktValidation {
  const errors: KontaktValidation['errors'] = {};

  // Line breaks in a name would end up in the subject line.
  const name = readText(input.name, KONTAKT_MAX_LENGTH.name);
  if (name === null || /[\r\n]/.test(name)) errors.name = 'Bitte gib deinen Namen an.';

  const email = isValidKontaktEmail(input.email) ? input.email.trim() : null;
  if (email === null) errors.email = 'Bitte gib eine gültige E-Mail-Adresse an.';

  const topic = findKontaktTopic(input.topic);
  if (!topic) errors.topic = 'Bitte wähle ein Thema aus.';

  const message = readText(input.message, KONTAKT_MAX_LENGTH.message);
  if (message === null) {
    errors.message =
      typeof input.message === 'string' && input.message.trim().length > 0
        ? `Deine Nachricht darf höchstens ${KONTAKT_MAX_LENGTH.message} Zeichen lang sein.`
        : 'Bitte schreib uns eine Nachricht.';
  } else if (message.length < KONTAKT_MIN_MESSAGE_LENGTH) {
    errors.message = `Bitte schreib uns mindestens ${KONTAKT_MIN_MESSAGE_LENGTH} Zeichen.`;
  }

  if (Object.keys(errors).length > 0 || !name || !email || !topic || !message) {
    return { message: null, errors };
  }
  return { message: { name, email, topic: topic.id, message }, errors };
}
