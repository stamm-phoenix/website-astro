/**
 * Validation for the edit modules of the Leitendenbereich (Gruppenstunden, Leitende, Downloads).
 * Invalid input is reported per field so the forms can show the messages next to the inputs.
 */

export type FieldErrors = Record<string, string>;

export class ValidationError extends Error {
  constructor(public fields: FieldErrors) {
    super('Die Eingaben sind unvollständig oder ungültig.');
    this.name = 'ValidationError';
  }
}

/**
 * The four Stufen; they are also Team values of the Leitende list and link leaders to their
 * Gruppenstunde. These names never change.
 */
export const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'];

/** Team whose members are shown with phone and address on the Vorstand page. */
export const VORSTAND_TEAM = 'Vorstand';

/** Sorts teams: Vorstand, the Stufen in their usual order, then any other team. */
export function sortTeams(teams: string[]): string[] {
  const fixed = [VORSTAND_TEAM, ...STUFEN];
  const rank = (team: string): number => {
    const index = fixed.indexOf(team);
    return index === -1 ? fixed.length : index;
  };
  return [...teams].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'de'));
}

export const WEEKDAYS = [
  'Montags',
  'Dienstags',
  'Mittwochs',
  'Donnerstags',
  'Freitags',
  'Samstags',
  'Sonntags',
];

const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

class Reader {
  errors: FieldErrors = {};
  constructor(private body: Record<string, unknown>) {}

  text(field: string, label: string, max: number, required = false): string {
    const raw = this.body[field];
    const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      this.errors[field] = `${label} ist ungültig.`;
    } else if (required && !value) {
      this.errors[field] = `Bitte ${label} angeben.`;
    } else if (value.length > max) {
      this.errors[field] = `${label} darf höchstens ${max} Zeichen lang sein.`;
    }
    return value;
  }

  choice(field: string, label: string, allowed: string[]): string {
    const value = this.body[field];
    if (typeof value !== 'string' || !allowed.includes(value)) {
      this.errors[field] = `Bitte eine gültige Auswahl für ${label} treffen.`;
      return '';
    }
    return value;
  }

  choices(field: string, label: string, allowed: string[]): string[] {
    const value = this.body[field];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !allowed.includes(v))) {
      this.errors[field] = `${label} enthält ungültige Werte.`;
      return [];
    }
    return [...new Set(value as string[])];
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) throw new ValidationError(this.errors);
  }
}

// --- HTML ---

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'div']);
const DROPPED_WITH_CONTENT = /<(script|style|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi;

/**
 * Reduces HTML to a small set of formatting tags without any attributes. Mirrors
 * `sanitizeDescription` in the frontend, which renders the description.
 */
export function sanitizeRichText(html: string): string {
  return html
    .replace(DROPPED_WITH_CONTENT, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g, (tag, name: string) => {
      const lower = name.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return '';
      if (lower === 'br') return '<br>';
      return tag.startsWith('</') ? `</${lower}>` : `<${lower}>`;
    })
    .replace(/<(?![/a-z])/gi, '&lt;')
    .trim();
}

function textLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').trim().length;
}

// --- Gruppenstunden ---

export interface GruppenstundeInput {
  stufe: string;
  weekday: string;
  time: string;
  ageRange: string;
  location: string;
  description: string;
}

export function validateGruppenstunde(body: unknown, stufen: string[]): GruppenstundeInput {
  const reader = new Reader(asRecord(body));
  const input: GruppenstundeInput = {
    stufe: reader.choice('stufe', 'die Stufe', stufen),
    weekday: reader.text('weekday', 'den Wochentag', 30, true),
    time: reader.text('time', 'die Uhrzeit', 60, true),
    ageRange: reader.text('ageRange', 'das Alter', 60),
    location: reader.text('location', 'den Ort', 120, true),
    description: '',
  };
  const rawDescription = asRecord(body).description;
  const description = sanitizeRichText(typeof rawDescription === 'string' ? rawDescription : '');
  if (textLength(description) > MAX_DESCRIPTION_LENGTH) {
    reader.errors.description = `Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein.`;
  }
  input.description = description;
  reader.done();
  return input;
}

// --- Leitende ---

export interface LeitendeInput {
  name: string;
  teams: string[];
  phone: string;
  street: string;
  postalCode: string;
  city: string;
}

export function validateLeitende(body: unknown, teams: string[]): LeitendeInput {
  const reader = new Reader(asRecord(body));
  const input: LeitendeInput = {
    name: reader.text('name', 'den Namen', 100, true),
    teams: reader.choices('teams', 'Teams', teams),
    phone: reader.text('phone', 'Telefon', 40),
    street: reader.text('street', 'Straße', 120),
    postalCode: reader.text('postalCode', 'PLZ', 10),
    city: reader.text('city', 'Ort', 80),
  };
  // Contact details are only published for the Vorstand; for everyone else they are not kept
  if (!input.teams.includes(VORSTAND_TEAM)) {
    input.phone = '';
    input.street = '';
    input.postalCode = '';
    input.city = '';
  }
  if (input.phone && !/^[+0-9][0-9 ()/-]{3,}$/.test(input.phone)) {
    reader.errors.phone = 'Bitte eine gültige Telefonnummer angeben.';
  }
  if (input.postalCode && !/^\d{5}$/.test(input.postalCode)) {
    reader.errors.postalCode = 'Bitte eine fünfstellige PLZ angeben.';
  }
  const addressParts = [input.street, input.postalCode, input.city].filter(Boolean).length;
  if (addressParts > 0 && addressParts < 3) {
    reader.errors.street = 'Bitte die Adresse vollständig oder gar nicht angeben.';
  }
  reader.done();
  return input;
}

// --- Downloads ---

/** Returns an error message for an unsuitable file name, or undefined if it is fine. */
export function checkFileName(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name.trim()) return 'Bitte einen Dateinamen angeben.';
  if (name.length > 200) return 'Der Dateiname darf höchstens 200 Zeichen lang sein.';
  if (/["*:<>?/\\|#%]/.test(name) || name.startsWith('.') || name.endsWith('.')) {
    return 'Der Dateiname darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %';
  }
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) return 'Der Dateiname braucht eine Dateiendung.';
  return undefined;
}
