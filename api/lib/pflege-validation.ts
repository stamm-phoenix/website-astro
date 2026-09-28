/**
 * Validation for the edit modules of the Leitendenbereich (Gruppenstunden, Leitende, Downloads).
 * Invalid input is reported per field so the forms can show the messages next to the inputs.
 */
import type { HelperRole, TeamRole } from './nikolaus-einteilung';
import { HELPER_ROLES, KITCHEN, TEAM_ROLES, normalizeTag, parseTags } from './nikolaus-einteilung';

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
/** Tags whose content is dropped together with the tag. */
const DROPPED_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'template',
  'textarea',
]);
/** A tag or comment; everything between two matches is text. */
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>?/g;

export interface SanitizedRichText {
  html: string;
  /** Number of visible text characters (entities counted as written). */
  textLength: number;
}

function escapeText(text: string): string {
  return text
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Reduces HTML to a small set of formatting tags without any attributes, in a single pass:
 * text between tags is escaped and allowed tags are written anew, so every `<` in the result
 * comes from a tag created here. Mirrors `sanitizeDescription` in the frontend.
 */
function sanitize(html: string): SanitizedRichText {
  let output = '';
  let textLength = 0;
  /** Name of the tag whose content is currently being dropped. */
  let dropping: string | null = null;
  let last = 0;

  const addText = (text: string): void => {
    if (dropping || !text) return;
    output += escapeText(text);
    textLength += text.trim() ? text.length : 0;
  };

  for (const match of html.matchAll(TOKEN)) {
    addText(html.slice(last, match.index));
    last = match.index + match[0].length;

    const name = match[2]?.toLowerCase();
    if (!name) continue; // comment
    const closing = match[1] === '/';

    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (!closing && DROPPED_WITH_CONTENT.has(name)) {
      dropping = name;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;
    if (name === 'br') output += closing ? '' : '<br>';
    else output += closing ? `</${name}>` : `<${name}>`;
  }
  addText(html.slice(last));

  return { html: output.trim(), textLength };
}

/** The sanitized HTML together with its number of visible characters; see `sanitize`. */
export function sanitizeRichTextWithLength(html: string): SanitizedRichText {
  return sanitize(html);
}

/** The sanitized HTML; see `sanitize`. */
export function sanitizeRichText(html: string): string {
  return sanitize(html).html;
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
  const sanitized = sanitize(typeof rawDescription === 'string' ? rawDescription : '');
  if (sanitized.textLength > MAX_DESCRIPTION_LENGTH) {
    reader.errors.description = `Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein.`;
  }
  input.description = sanitized.html;
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

// --- Nikolaus-Dispo ---

export interface DispoSaveInput {
  version: string;
  entries: {
    bookingId: string;
    team: string;
    order: number;
    slotKey: string;
    plannedArrival: string;
    fixed: boolean;
  }[];
}

const MAX_DISPO_ENTRIES = 200;

/**
 * Checks the Dispo of a day before saving.
 * @param teams Team names of the day.
 * @param bookingSlots Slot key per booking ID of the confirmed bookings of the day.
 */
export function validateDispoSave(
  body: unknown,
  teams: string[],
  bookingSlots: Map<string, string>
): DispoSaveInput {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  const version = typeof record.version === 'string' ? record.version : '';
  const raw = Array.isArray(record.entries) ? record.entries : null;

  if (!raw || raw.length > MAX_DISPO_ENTRIES) {
    throw new ValidationError({ entries: 'Die Dispo ist ungültig.' });
  }

  const seen = new Set<string>();
  const entries = raw.map((value) => {
    const entry = asRecord(value);
    const bookingId = typeof entry.bookingId === 'string' ? entry.bookingId : '';
    const team = typeof entry.team === 'string' ? entry.team : '';
    const order = typeof entry.order === 'number' ? entry.order : NaN;
    const plannedArrival = typeof entry.plannedArrival === 'string' ? entry.plannedArrival : '';

    if (!bookingSlots.has(bookingId)) {
      errors.entries = 'Die Dispo enthält Termine, die nicht mehr bestätigt sind. Bitte neu laden.';
    } else if (seen.has(bookingId)) {
      errors.entries = 'Ein Termin ist mehreren Teams zugeordnet.';
    } else if (!teams.includes(team)) {
      errors.entries = `Team „${team}“ gibt es an diesem Tag nicht.`;
    } else if (!Number.isInteger(order) || order < 1 || order > MAX_DISPO_ENTRIES) {
      errors.entries = 'Die Reihenfolge ist ungültig.';
    } else if (!/^\d{2}:\d{2}$/.test(plannedArrival)) {
      errors.entries = 'Die geplante Ankunft ist ungültig.';
    }
    seen.add(bookingId);
    return {
      bookingId,
      team,
      order,
      // The slot is taken from the booking, not from the browser
      slotKey: bookingSlots.get(bookingId) ?? '',
      plannedArrival,
      fixed: entry.fixed === true,
    };
  });

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { version, entries };
}

export interface DispoVisitInput {
  bookingId: string;
  visited: boolean;
}

/** Checks a visit checked off (or undone) in the Fahrt view. */
export function validateDispoVisit(body: unknown): DispoVisitInput {
  const record = asRecord(body);
  const bookingId = typeof record.bookingId === 'string' ? record.bookingId : '';
  if (!/^\d{1,10}$/.test(bookingId) || typeof record.visited !== 'boolean') {
    throw new ValidationError({ visit: 'Der Besuch ist ungültig.' });
  }
  return { bookingId, visited: record.visited };
}

// --- Nikolaus: tags and helpers ---

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/** Reads a list of tags; each without commas, unique regardless of case. */
function readTags(value: unknown, label: string, errors: FieldErrors, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    errors[field] = `${label} sind ungültig.`;
    return [];
  }
  const tags = parseTags((value as string[]).map((tag) => tag.replace(/,/g, ' ')).join(','));
  if (tags.length > MAX_TAGS) errors[field] = `Höchstens ${MAX_TAGS} ${label}.`;
  else if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    errors[field] = `Ein Tag darf höchstens ${MAX_TAG_LENGTH} Zeichen lang sein.`;
  }
  return tags;
}

/** Validates the internal tags of a booking. */
export function validateBookingTags(body: unknown): string[] {
  const errors: FieldErrors = {};
  const tags = readTags(asRecord(body).tags, 'Tags', errors, 'tags');
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return tags;
}

export interface HelperInput {
  name: string;
  availability: Record<string, HelperRole[]>;
  positiveTags: string[];
  negativeTags: string[];
  notes: string;
}

/**
 * Validates a helper of the Nikolausdienst.
 * @param dates The configured days; availability for other days is dropped.
 */
export function validateHelper(body: unknown, dates: string[]): HelperInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const name = reader.text('name', 'den Namen', 100, true);
  const notes = reader.text('notes', 'Bemerkungen', 500);

  const availability: Record<string, HelperRole[]> = {};
  const raw = asRecord(record.availability);
  for (const date of dates) {
    const roles = raw[date];
    if (roles === undefined) continue;
    if (!Array.isArray(roles) || roles.some((r) => !HELPER_ROLES.includes(r as HelperRole))) {
      reader.errors.availability = 'Die Posten sind ungültig.';
      continue;
    }
    const unique = HELPER_ROLES.filter((role) => roles.includes(role));
    if (unique.length > 0) availability[date] = unique;
  }

  const positiveTags = readTags(
    record.positiveTags,
    'positive Tags',
    reader.errors,
    'positiveTags'
  );
  const negativeTags = readTags(
    record.negativeTags,
    'negative Tags',
    reader.errors,
    'negativeTags'
  );
  const negative = new Set(negativeTags.map(normalizeTag));
  if (positiveTags.some((tag) => negative.has(normalizeTag(tag)))) {
    reader.errors.negativeTags = 'Ein Tag kann nicht gleichzeitig positiv und negativ sein.';
  }
  reader.done();
  return { name, availability, positiveTags, negativeTags, notes };
}

export interface EinteilungSaveInput {
  version: string;
  assignments: { personId: string; date: string; team: string; role: HelperRole; fixed: boolean }[];
}

/**
 * Checks the Einteilung before saving.
 * @param teamsByDate Team names per configured day.
 * @param personIds IDs of the existing helpers.
 */
export function validateEinteilungSave(
  body: unknown,
  teamsByDate: Map<string, string[]>,
  personIds: Set<string>
): EinteilungSaveInput {
  const record = asRecord(body);
  const raw = Array.isArray(record.assignments) ? record.assignments : null;
  const invalid = (message: string): never => {
    throw new ValidationError({ assignments: message });
  };
  if (!raw || raw.length > 1000) invalid('Die Einteilung ist ungültig.');

  const personDays = new Set<string>();
  const posts = new Set<string>();
  const assignments = (raw as unknown[]).map((value) => {
    const entry = asRecord(value);
    const personId = typeof entry.personId === 'string' ? entry.personId : '';
    const date = typeof entry.date === 'string' ? entry.date : '';
    const team = typeof entry.team === 'string' ? entry.team : '';
    const role = entry.role as HelperRole;
    const teams = teamsByDate.get(date);
    if (!personIds.has(personId))
      invalid('Die Einteilung enthält gelöschte Personen. Bitte neu laden.');
    if (!teams) invalid('Die Einteilung enthält einen unbekannten Tag.');
    const isKitchen = team === KITCHEN && role === KITCHEN;
    if (!isKitchen && (!teams?.includes(team) || !TEAM_ROLES.includes(role as TeamRole))) {
      invalid('Die Einteilung enthält einen unbekannten Posten.');
    }
    const personDay = `${personId}|${date}`;
    if (personDays.has(personDay)) invalid('Eine Person ist an einem Tag mehrfach eingeteilt.');
    personDays.add(personDay);
    const post = `${date}|${team}|${role}`;
    if (!isKitchen && posts.has(post)) invalid('Ein Posten ist mehrfach besetzt.');
    posts.add(post);
    return { personId, date, team, role, fixed: entry.fixed === true };
  });
  return { version: typeof record.version === 'string' ? record.version : '', assignments };
}
