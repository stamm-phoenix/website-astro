/**
 * Validation for the edit modules of the Leitendenbereich.
 * Invalid input is reported per field so the forms can show the messages next to the inputs.
 */
import type { HelperRole, TeamRole } from './nikolaus-einteilung';
import { HELPER_ROLES, KITCHEN, TEAM_ROLES, normalizeTag, parseTags } from './nikolaus-einteilung';
import { CAMPFLOW_EVENT_ID_PATTERN } from './campflow';
import type {
  LiveAbschnitt,
  MitschriftNotizen,
  MitschriftQuelle,
  MitschriftTodo,
} from './mitschriften-model';
import { MAX_AUDIO_BYTES, MAX_NOTE_ITEMS, MAX_NOTE_LENGTH } from './mitschriften-model';
import type {
  ProtokollAktion,
  ProtokollAufgabe,
  ProtokollInhalt,
  ProtokollPerson,
  ProtokollPunkt,
  ProtokollTeilnahme,
  PunktTermin,
  WeiterePerson,
} from './protokoll-editor-model';
import {
  ELEMENT_ID,
  MAX_AUFGABEN,
  MAX_INHALT_BYTES,
  MAX_PROTOKOLLANT,
  MAX_PUNKTE,
  MAX_SITZUNGSLEITUNG,
  MAX_TEILNEHMENDE,
  MAX_TERMINE,
  MAX_TEXT,
  MAX_TITEL,
  MAX_UNTERPUNKTE,
  MAX_ZUSTAENDIG,
} from './protokoll-editor-model';

export type FieldErrors = Record<string, string>;

export class ValidationError extends Error {
  constructor(public fields: FieldErrors) {
    super('Die Eingaben sind unvollständig oder ungültig.');
    this.name = 'ValidationError';
  }
}

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

/** Payment actions accept explicit confirmations, never browser-supplied amounts or state. */
export function validateSammelPaymentInput(body: unknown): SammelPaymentInput {
  const row =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const actions = ['assign', 'preview', 'create', 'adopt', 'dispatched'];
  const action = typeof row.action === 'string' ? row.action : '';
  const errors: FieldErrors = {};
  if (!actions.includes(action)) errors.form = 'Bitte eine gültige Zahlungsaktion wählen.';
  const read = (field: string, max: number, required = false): string => {
    const value = typeof row[field] === 'string' ? row[field].trim() : '';
    if (
      (row[field] !== undefined && typeof row[field] !== 'string') ||
      value.length > max ||
      (required && !value)
    )
      errors[field] = 'Bitte die Angabe prüfen.';
    return value;
  };
  const etag = read('etag', 255, true);
  const personId = read('personId', 255, action === 'assign');
  const hash = read('hash', 64, ['create', 'adopt'].includes(action));
  const feeId = read('feeId', 255, action === 'adopt');
  const reference = read('reference', 100, action === 'adopt');
  const reason = read('reason', 1000);
  const evidence = read('evidence', 1000, ['adopt', 'dispatched'].includes(action));
  if (!/^(?:W\/)?"[^"\r\n]+"$/.test(etag)) errors.etag = 'Bitte die Bestellung neu laden.';
  if (action === 'assign' && !/^per_[A-Za-z0-9]+$/.test(personId))
    errors.personId = 'Bitte eine CampFlow-Person auswählen.';
  if (['create', 'adopt'].includes(action) && !/^[a-f0-9]{64}$/.test(hash))
    errors.hash = 'Bitte den Beitrag erneut prüfen.';
  if (action === 'adopt' && !/^fee_[A-Za-z0-9]+$/.test(feeId))
    errors.feeId = 'Bitte die CampFlow-Beitrags-ID angeben.';
  if (action !== 'preview' && row.confirmed !== true)
    errors.confirmed = 'Bitte die Aktion ausdrücklich bestätigen.';
  if (action === 'adopt' && row.executionEnded !== true)
    errors.executionEnded =
      'Bitte bestätigen, dass kein alter Erstellungsversuch mehr läuft und der vorhandene Beitrag geprüft wurde.';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return {
    action: action as SammelPaymentInput['action'],
    etag,
    personId,
    reason,
    hash,
    feeId,
    reference,
    evidence,
  };
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
/** Additional tags of blog posts; `a` and `img` keep one checked attribute each. */
const BLOG_TAGS = new Set(['h2', 'h3', 'a', 'img']);
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

/** File name of an image attached to a blog post, as created by the upload. */
export const BLOG_IMAGE_FILE = /^bild-\d{1,16}\.jpg$/;
/** Link targets allowed in blog posts: http(s) and mailto only. */
const SAFE_URL = /^(?:https?:\/\/[^\s"'<>`]+|mailto:[^\s"'<>`/:]+@[^\s"'<>`]+)$/i;

export interface SanitizedRichText {
  html: string;
  /** Number of visible text characters (entities counted as written). */
  textLength: number;
  /** Whether text tokens contain more than whitespace or empty editor placeholders. */
  hasVisibleText: boolean;
}

/** Extra content allowed in blog posts. */
interface BlogOptions {
  /** File names of the images of the post; other images are dropped. */
  images: Set<string>;
}

function escapeText(text: string): string {
  return text
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Decoded value of an attribute in the source of a start tag; undefined if missing. */
function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\`]+))`, 'i').exec(
    tag
  );
  if (!match) return undefined;
  return decodeAttribute((match[1] ?? match[2] ?? match[3] ?? '').trim());
}

/**
 * Reduces HTML to a small set of formatting tags without any attributes, in a single pass:
 * text between tags is escaped and allowed tags are written anew, so every `<` in the result
 * comes from a tag created here. Mirrors `sanitizeDescription` in the frontend.
 *
 * With `blog`, headings, links (`href` with http(s) or mailto only) and images of the post
 * (`data-bild` with the file name only) are kept as well; mirrors `toCanonicalBlogHtml`.
 */
function sanitize(html: string, blog?: BlogOptions): SanitizedRichText {
  let output = '';
  let textLength = 0;
  let hasVisibleText = false;
  /** Name of the tag whose content is currently being dropped. */
  let dropping: string | null = null;
  /** Per open `<a>`, whether it was written; closing tags of dropped links are dropped too. */
  const links: boolean[] = [];
  let last = 0;

  const addText = (text: string): void => {
    if (dropping || !text) return;
    output += escapeText(text);
    textLength += text.trim() ? text.length : 0;
    hasVisibleText ||= Boolean(
      text
        .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
    );
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
    if (blog && name === 'a') {
      if (closing) {
        if (links.pop()) output += '</a>';
        continue;
      }
      const href = readAttribute(match[0], 'href');
      const valid = href !== undefined && SAFE_URL.test(href);
      links.push(valid);
      if (valid) output += `<a href="${escapeAttribute(href)}">`;
      continue;
    }
    if (blog && name === 'img') {
      const file = readAttribute(match[0], 'data-bild');
      if (!closing && file && BLOG_IMAGE_FILE.test(file) && blog.images.has(file)) {
        output += `<img data-bild="${file}">`;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name) && !(blog && BLOG_TAGS.has(name))) continue;
    if (name === 'br') output += closing ? '' : '<br>';
    else output += closing ? `</${name}>` : `<${name}>`;
  }
  addText(html.slice(last));
  while (links.length > 0) if (links.pop()) output += '</a>';

  return { html: output.trim(), textLength, hasVisibleText };
}

/** The sanitized HTML together with its number of visible characters; see `sanitize`. */
export function sanitizeRichTextWithLength(html: string): SanitizedRichText {
  return sanitize(html);
}

/** The sanitized HTML; see `sanitize`. */
export function sanitizeRichText(html: string): string {
  return sanitize(html).html;
}

// --- Fragen & Antworten ---

export interface QuestionAndAnswerInput {
  published: boolean;
  question: string;
  answer: string;
  category: string;
}

/** Validates FAQ fields and keeps only the formatting supported by the public FAQ. */
export function validateQuestionAndAnswer(body: unknown): QuestionAndAnswerInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const question = reader.text('question', 'eine Frage', 255, true);
  const category = reader.text('category', 'das Thema', 100) || 'Allgemein';
  const raw = typeof record.answer === 'string' ? record.answer : '';
  const answer = sanitizeRichTextWithLength(raw);
  if (typeof record.published !== 'boolean') {
    reader.errors.published = 'Bitte einen gültigen Veröffentlichungsstatus angeben.';
  }
  if (record.published !== false && !answer.hasVisibleText) {
    reader.errors.answer = 'Bitte eine Antwort angeben.';
  } else if (typeof record.answer !== 'string') {
    reader.errors.answer = 'Bitte eine gültige Antwort angeben.';
  }
  if (answer.textLength > 5000 || answer.html.length > 60000) {
    reader.errors.answer = 'Die Antwort ist zu lang. Bitte auf höchstens 5000 Zeichen kürzen.';
  }
  reader.done();
  return { question, answer: answer.html, category, published: record.published === true };
}

/** Sanitized HTML of a blog post; images not in `images` are dropped. See `sanitize`. */
export function sanitizeBlogHtml(html: string, images: Iterable<string>): SanitizedRichText {
  return sanitize(html, { images: new Set(images) });
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

// --- Aktionen (public calendar) ---

/** Stufe of calendar entries that are only shown in the Leitende calendar. */
export const LEITENDE_STUFE = 'Leitende';

const HTTPS_URL = /^https:\/\/[^\s"'<>`]+$/i;

export interface AktionInput {
  /** CampFlow event the entry belongs to; then title, dates and link come from CampFlow. */
  campflowId: string | null;
  stufen: string[];
  description: string;
  title: string;
  start: string;
  end: string;
  link: string;
}

/**
 * Validates a calendar entry. For entries linked to CampFlow (`campflowId` set) title, dates and
 * link are ignored here; the caller takes them from CampFlow.
 */
export function validateAktion(body: unknown, stufen: string[]): AktionInput {
  const record = asRecord(body);
  const reader = new Reader(record);

  let campflowId: string | null = null;
  if (record.campflowId !== undefined && record.campflowId !== null && record.campflowId !== '') {
    if (
      typeof record.campflowId === 'string' &&
      CAMPFLOW_EVENT_ID_PATTERN.test(record.campflowId)
    ) {
      campflowId = record.campflowId;
    } else {
      reader.errors.campflowId = 'Die CampFlow-Aktion ist ungültig.';
    }
  }

  const selected = reader.choices('stufen', 'Die Auswahl der Stufen', stufen);
  if (!reader.errors.stufen && selected.length === 0) {
    reader.errors.stufen = 'Bitte mindestens eine Stufe auswählen.';
  }

  const rawDescription = record.description;
  const description = sanitize(typeof rawDescription === 'string' ? rawDescription : '');
  if (description.textLength > MAX_DESCRIPTION_LENGTH) {
    reader.errors.description = `Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein.`;
  }

  const input: AktionInput = {
    campflowId,
    stufen: selected,
    description: description.html,
    title: '',
    start: '',
    end: '',
    link: '',
  };

  if (!campflowId) {
    input.title = reader.text('title', 'einen Titel', 255, true);
    input.start = reader.text('start', 'ein Startdatum', 10, true);
    input.end = reader.text('end', 'das Enddatum', 10);
    input.link = reader.text('link', 'Der Anmeldelink', 255);
    if (input.start && !isValidDate(input.start)) {
      reader.errors.start = 'Bitte ein gültiges Startdatum angeben.';
    }
    if (input.end && !isValidDate(input.end)) {
      reader.errors.end = 'Bitte ein gültiges Enddatum angeben.';
    } else if (input.end && input.start && input.end < input.start) {
      reader.errors.end = 'Das Enddatum darf nicht vor dem Startdatum liegen.';
    }
    if (!input.end) input.end = input.start;
    if (input.link && !HTTPS_URL.test(input.link)) {
      reader.errors.link = 'Der Anmeldelink muss mit https:// beginnen.';
    }
  }

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

// --- Blog ---

const MAX_BLOG_TEXT_LENGTH = 20000;
/** Plain multi-line text columns hold at most 63 999 characters. */
const MAX_BLOG_HTML_LENGTH = 60000;
const MAX_ALT_LENGTH = 300;
export const MAX_BLOG_IMAGES = 30;
export const MAX_BLOG_IMAGE_BYTES = 4 * 1024 * 1024;
/** Longest side of an uploaded image (`content.blog_image`, `ck_blog_image_width/height`). */
export const MAX_BLOG_IMAGE_SIDE = 10000;

/** An image attached to a blog post; the first one is the cover image. */
export interface BlogImage {
  file: string;
  alt: string;
  width: number;
  height: number;
}

export interface BlogPostInput {
  title: string;
  /** Date of the post as `YYYY-MM-DD`. */
  date: string;
  published: boolean;
  /** Canonical HTML, see `sanitizeBlogHtml`. */
  content: string;
}

/** Whether the value is a real calendar date as `YYYY-MM-DD`. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Validates a blog post.
 * @param images File names of the images of the post; other images are removed from the text.
 */
export function validateBlogPost(body: unknown, images: string[]): BlogPostInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const title = reader.text('title', 'einen Titel', 255, true);
  const date = typeof record.date === 'string' ? record.date : '';
  if (!isValidDate(date)) reader.errors.date = 'Bitte ein gültiges Datum angeben.';
  if (record.published !== undefined && typeof record.published !== 'boolean') {
    reader.errors.published = 'Der Status ist ungültig.';
  }

  const rawContent = typeof record.content === 'string' ? record.content : '';
  const sanitized = sanitizeBlogHtml(rawContent, images);
  if (sanitized.textLength > MAX_BLOG_TEXT_LENGTH) {
    reader.errors.content = `Der Text darf höchstens ${MAX_BLOG_TEXT_LENGTH} Zeichen lang sein.`;
  } else if (sanitized.html.length > MAX_BLOG_HTML_LENGTH) {
    reader.errors.content = 'Der Text ist zu lang, bitte kürzen oder aufteilen.';
  }
  reader.done();
  return { title, date, published: record.published === true, content: sanitized.html };
}

/**
 * Validates new alt texts and a new order of the existing images of a post.
 * @param current The images as stored; files cannot be added or removed here.
 */
export function validateBlogImages(body: unknown, current: BlogImage[]): BlogImage[] {
  const raw = asRecord(body).images;
  const invalid = (message: string): never => {
    throw new ValidationError({ images: message });
  };
  if (!Array.isArray(raw) || raw.length !== current.length) {
    invalid('Die Bilder haben sich inzwischen geändert. Bitte neu laden.');
  }

  const byFile = new Map(current.map((image) => [image.file, image]));
  const seen = new Set<string>();
  return (raw as unknown[]).map((value) => {
    const entry = asRecord(value);
    const file = typeof entry.file === 'string' ? entry.file : '';
    const image = byFile.get(file);
    if (!image || seen.has(file)) {
      return invalid('Die Bilder haben sich inzwischen geändert. Bitte neu laden.');
    }
    seen.add(file);
    const alt = typeof entry.alt === 'string' ? entry.alt.trim().replace(/\s+/g, ' ') : '';
    if (alt.length > MAX_ALT_LENGTH) {
      invalid(`Eine Bildbeschreibung darf höchstens ${MAX_ALT_LENGTH} Zeichen lang sein.`);
    }
    return { ...image, alt };
  });
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
  slotKey: string;
  bookingId: string;
  visited: boolean;
  operationId: string;
  version: string;
}

/** Checks a visit checked off (or undone) in the Fahrt view. */
/** Validate the requested visit and the operation/version pair used for safe offline retries. */
export function validateDispoVisit(body: unknown): DispoVisitInput {
  const record = asRecord(body);
  const bookingId = typeof record.bookingId === 'string' ? record.bookingId : '';
  if (!/^\d{1,10}$/.test(bookingId) || typeof record.visited !== 'boolean') {
    throw new ValidationError({ visit: 'Der Besuch ist ungültig.' });
  }
  if (
    typeof record.operationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.operationId
    ) ||
    typeof record.version !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.version) ||
    typeof record.slotKey !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(record.slotKey)
  ) {
    throw new ValidationError({
      visit: 'Bitte die Route neu laden, bevor Besuche gespeichert werden.',
    });
  }
  return {
    bookingId,
    slotKey: record.slotKey as string,
    visited: record.visited,
    operationId: record.operationId,
    version: record.version,
  };
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

export interface StufenDecisionInput {
  kind: 'booking' | 'helper';
  targetId: string;
  stufe: string;
  decision: 'accept' | 'reject';
}

/** Validates the answer to a suggestion of the Stufen-Abgleich. */
export function validateStufenDecision(body: unknown): StufenDecisionInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const kind = reader.choice('kind', 'die Art', ['booking', 'helper']);
  const stufe = reader.choice('stufe', 'die Stufe', STUFEN);
  const decision = reader.choice('decision', 'die Entscheidung', ['accept', 'reject']);
  const targetId = typeof record.targetId === 'string' ? record.targetId : '';
  if (!/^\d+$/.test(targetId)) reader.errors.targetId = 'Der Eintrag ist ungültig.';
  reader.done();
  return {
    kind: kind as StufenDecisionInput['kind'],
    targetId,
    stufe,
    decision: decision as StufenDecisionInput['decision'],
  };
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

// --- Belege ---

/**
 * Review states of a receipt. The real bookkeeping happens in CampFlow; here the Kasse only
 * accepts a receipt (then transfers it to CampFlow) or rejects it with a reason.
 */
export const BELEG_STATUSES = ['Eingereicht', 'Angenommen', 'Abgelehnt'] as const;
export type BelegStatus = (typeof BELEG_STATUSES)[number];

/** Photos are scaled down in the browser; this only guards against oversized requests. */
export const MAX_BELEG_PHOTO_BYTES = 4 * 1024 * 1024;
/** Shorter photos are too small to read a receipt. */
export const MIN_BELEG_PHOTO_EDGE = 800;
/** 10.000 € – anything above is surely a typo. */
const MAX_BELEG_CENT = 1_000_000;

export interface BelegInput {
  shop: string;
  /** Date of the receipt, `YYYY-MM-DD`. */
  date: string;
  amountCent: number;
  paidBy: string;
  /** Whether the person who paid gets the money back. */
  payout: boolean;
  aktion: string;
  note: string;
  status: BelegStatus;
  /** Remark of the Kasse; for a rejected receipt the reason sent to the uploader. */
  reviewNote: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Validates the details of a receipt.
 * @param today Current date as `YYYY-MM-DD`; receipts from the future are rejected.
 */
export function validateBeleg(body: unknown, today: string): BelegInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const input: BelegInput = {
    shop: reader.text('shop', 'das Geschäft', 100, true),
    date: reader.text('date', 'das Datum', 10, true),
    amountCent: 0,
    paidBy: reader.text('paidBy', 'wer bezahlt hat', 100, true),
    payout: record.payout === true,
    aktion: reader.text('aktion', 'die Aktion', 120, true),
    note: reader.text('note', 'die Bemerkung', 1000),
    status: 'Eingereicht',
    reviewNote: reader.text('reviewNote', 'die Bemerkung der Kasse', 1000),
  };

  if (input.date && !reader.errors.date) {
    if (!isIsoDate(input.date)) reader.errors.date = 'Bitte ein gültiges Datum angeben.';
    else if (input.date > today) reader.errors.date = 'Das Datum liegt in der Zukunft.';
    else if (input.date < '2000-01-01') reader.errors.date = 'Bitte ein gültiges Datum angeben.';
  }

  const amount = record.amountCent;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    reader.errors.amountCent = 'Bitte einen Betrag größer als 0 € angeben.';
  } else if (amount > MAX_BELEG_CENT) {
    reader.errors.amountCent = 'Der Betrag ist zu hoch.';
  } else {
    input.amountCent = amount;
  }

  if (record.status !== undefined) {
    input.status = reader.choice('status', 'den Status', [...BELEG_STATUSES]) as BelegStatus;
  }
  if (input.status === 'Abgelehnt' && !input.reviewNote) {
    reader.errors.reviewNote = 'Bitte begründen, warum der Beleg abgelehnt wird.';
  }

  reader.done();
  return input;
}

// --- Anwesenheit ---

export const MAX_MEETING_NOTES_LENGTH = 2000;

export interface MeetingNotesInput {
  notes: string;
  /** The version the editor loaded; `null` if the Termin did not exist yet. */
  etag: string | null;
}

/** What the group did: plain text, line breaks kept. */
export function validateMeetingNotes(body: unknown): MeetingNotesInput {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  const raw = record.notes;
  const notes =
    typeof raw === 'string'
      ? raw
          .replace(/\r\n?/g, '\n')
          .replace(/[^\S\n]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : '';
  if (typeof raw !== 'string') errors.notes = 'Der Inhalt ist ungültig.';
  else if (notes.length > MAX_MEETING_NOTES_LENGTH)
    errors.notes = `Der Inhalt darf höchstens ${MAX_MEETING_NOTES_LENGTH} Zeichen lang sein.`;
  const etag = typeof record.etag === 'string' ? record.etag : null;
  if (etag === null && record.etag !== null)
    errors.etag = 'Die Version des Termins fehlt. Bitte neu laden.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { notes, etag };
}

/** The name of a guest who is not in CampFlow. */
export function validateGuestName(body: unknown): string {
  const reader = new Reader(asRecord(body));
  const name = reader.text('name', 'den Namen', 100, true);
  reader.done();
  return name;
}

// --- Mitschriften ---

export interface MitschriftCreateInput {
  title: string;
  date: string;
  mode: 'live' | 'datei';
}

/** Title and date of a Mitschrift; a new one also needs the mode and the consent. */
export function validateMitschrift(body: unknown, create: true): MitschriftCreateInput;
export function validateMitschrift(
  body: unknown,
  create: false
): { title: string; date: string; etag: string };
export function validateMitschrift(
  body: unknown,
  create: boolean
): MitschriftCreateInput | { title: string; date: string; etag: string } {
  const record = asRecord(body);
  const reader = new Reader(record);
  const title = reader.text('title', 'einen Titel', 200, true);
  const date = typeof record.date === 'string' ? record.date : '';
  if (!isValidDate(date)) reader.errors.date = 'Bitte ein gültiges Datum angeben.';
  if (!create) {
    const etag = reader.text('etag', 'Die Version', 100, true);
    reader.done();
    return { title, date, etag };
  }
  const mode = reader.choice('mode', 'die Art', ['live', 'datei']) as 'live' | 'datei';
  if (record.consent !== true) {
    reader.errors.consent =
      'Bitte bestätigen, dass alle Anwesenden informiert und einverstanden sind.';
  }
  reader.done();
  return { title, date, mode };
}

const MAX_MS = 24 * 3_600_000;

function readMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_MS
    ? value
    : undefined;
}

/** Plain text of a sentence: one line, at most 4000 characters. */
function readSentence(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && text.length <= 4000 ? text : undefined;
}

export const MAX_LIVE_ABSCHNITTE = 100;

/** Finished sentences of the live recording, sent by the recording browser. */
export function validateLiveAbschnitte(body: unknown): LiveAbschnitt[] {
  const list = asRecord(body).abschnitte;
  if (!Array.isArray(list) || list.length > MAX_LIVE_ABSCHNITTE) {
    throw new ValidationError({ abschnitte: 'Die Abschnitte sind ungültig.' });
  }
  return list.map((entry: unknown): LiveAbschnitt => {
    const row = asRecord(entry);
    const startMs = readMs(row.startMs);
    const endMs = readMs(row.endMs);
    const text = readSentence(row.text);
    const speakerKey = row.speakerKey;
    if (
      typeof row.clientId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(row.clientId) ||
      (row.source !== 'raum' && row.source !== 'teams') ||
      (speakerKey !== null &&
        (typeof speakerKey !== 'string' || !/^[A-Za-z0-9:_-]{1,60}$/.test(speakerKey))) ||
      startMs === undefined ||
      endMs === undefined ||
      endMs < startMs ||
      text === undefined
    ) {
      throw new ValidationError({ abschnitte: 'Die Abschnitte sind ungültig.' });
    }
    return { clientId: row.clientId, source: row.source, speakerKey, startMs, endMs, text };
  });
}

export interface AuftragInput {
  source: MitschriftQuelle;
  offsetMs: number;
  untilMs: number | null;
}

/**
 * A file to transcribe: an uploaded recording (`datei`) or a gap of the live recording of one
 * source with its time range.
 */
export function validateAuftrag(body: unknown): AuftragInput {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  const source = record.source;
  if (source !== 'datei' && source !== 'raum' && source !== 'teams') {
    errors.source = 'Die Quelle ist ungültig.';
  }
  const size = record.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    errors.datei = 'Die Datei ist leer.';
  } else if (size > MAX_AUDIO_BYTES) {
    errors.datei = `Die Datei darf höchstens ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB groß sein.`;
  }
  const offsetMs = source === 'datei' ? 0 : readMs(record.offsetMs);
  const untilMs = source === 'datei' ? null : readMs(record.untilMs);
  if (
    offsetMs === undefined ||
    (source !== 'datei' && (untilMs === undefined || untilMs! <= offsetMs))
  ) {
    errors.offsetMs = 'Der Zeitbereich ist ungültig.';
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { source: source as MitschriftQuelle, offsetMs: offsetMs!, untilMs: untilMs ?? null };
}

/** Text and speaker of a sentence, with the loaded version. */
export function validateAbschnitt(body: unknown): {
  text: string;
  sprecherId: number | null;
  etag: string;
} {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  const text = readSentence(record.text);
  if (text === undefined) errors.text = 'Bitte einen Text mit höchstens 4000 Zeichen angeben.';
  const sprecherId = record.sprecherId;
  if (sprecherId !== null && (typeof sprecherId !== 'number' || !Number.isInteger(sprecherId))) {
    errors.sprecherId = 'Der Sprecher ist ungültig.';
  }
  const etag = typeof record.etag === 'string' ? record.etag : '';
  if (!etag) errors.etag = 'Die Version des Abschnitts fehlt. Bitte neu laden.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { text: text!, sprecherId: sprecherId as number | null, etag };
}

/** IDs of the sentences to delete. */
export function validateAbschnittIds(body: unknown): number[] {
  const ids = asRecord(body).ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 5000 ||
    ids.some((id) => typeof id !== 'number' || !Number.isInteger(id) || id <= 0)
  ) {
    throw new ValidationError({ ids: 'Bitte mindestens einen Abschnitt auswählen.' });
  }
  return [...new Set(ids as number[])];
}

/** The time window in which cut sentences are joined automatically. */
export function validateSmoothWindow(body: unknown): { fromMs: number; untilMs: number | null } {
  const record = asRecord(body);
  const fromMs = record.fromMs === undefined ? 0 : readMs(record.fromMs);
  const untilMs =
    record.untilMs === undefined || record.untilMs === null ? null : readMs(record.untilMs);
  if (fromMs === undefined || untilMs === undefined) {
    throw new ValidationError({ fromMs: 'Der Zeitbereich ist ungültig.' });
  }
  return { fromMs, untilMs };
}

/** Sentences to join (each with its loaded version) and the joined text. */
export function validateAbschnitteMerge(body: unknown): {
  abschnitte: { id: number; etag: string }[];
  text: string;
} {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  const list = Array.isArray(record.abschnitte) ? record.abschnitte : [];
  const abschnitte = list.flatMap((entry: unknown) => {
    const row = asRecord(entry);
    return typeof row.id === 'number' &&
      Number.isInteger(row.id) &&
      row.id > 0 &&
      typeof row.etag === 'string' &&
      row.etag
      ? [{ id: row.id, etag: row.etag }]
      : [];
  });
  const unique = new Set(abschnitte.map((a) => a.id));
  if (abschnitte.length !== list.length || unique.size !== list.length || list.length < 2) {
    errors.abschnitte = 'Bitte mindestens zwei Abschnitte auswählen.';
  } else if (list.length > 200) {
    errors.abschnitte = 'Bitte höchstens 200 Abschnitte auf einmal zusammenfügen.';
  }
  const text = readSentence(record.text);
  if (text === undefined) errors.text = 'Bitte einen Text mit höchstens 4000 Zeichen angeben.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { abschnitte, text: text! };
}

/** The name of a speaker (empty for the default label), with the loaded version. */
export function validateSprecherName(body: unknown): { name: string; etag: string } {
  const reader = new Reader(asRecord(body));
  const name = reader.text('name', 'Der Name', 100);
  const etag = reader.text('etag', 'die Version', 100, true);
  reader.done();
  return { name, etag };
}

/** The speaker another one is merged into. */
export function validateSprecherMerge(body: unknown): number {
  const into = asRecord(body).into;
  if (typeof into !== 'number' || !Number.isInteger(into) || into <= 0) {
    throw new ValidationError({ into: 'Bitte einen Sprecher wählen.' });
  }
  return into;
}

function noteText(value: unknown, required: boolean): string | null | undefined {
  if (value === null || value === undefined) return required ? undefined : null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > MAX_NOTE_LENGTH) return undefined;
  return text || (required ? undefined : null);
}

function noteTexts(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_NOTE_ITEMS) return undefined;
  const texts = value.map((entry) => noteText(entry, false));
  if (texts.some((text) => text === undefined)) return undefined;
  return texts.filter((text): text is string => typeof text === 'string');
}

/** Notes changed by hand, in the fixed structure, with the loaded version of the Mitschrift. */
export function validateNotizen(body: unknown): { notes: MitschriftNotizen; etag: string } {
  const record = asRecord(body);
  const value = asRecord(record.notes);
  const errors: FieldErrors = {};
  const beschluesse = noteTexts(value.beschluesse);
  const offenePunkte = noteTexts(value.offenePunkte);
  const naechsterTermin = noteText(value.naechsterTermin, false);
  const todos: MitschriftTodo[] = [];
  const todoList = Array.isArray(value.todos) ? value.todos : undefined;
  if (!todoList || todoList.length > MAX_NOTE_ITEMS) errors.todos = 'Die To-dos sind ungültig.';
  for (const entry of todoList ?? []) {
    const todo = asRecord(entry);
    const aufgabe = noteText(todo.aufgabe, false);
    const verantwortlich = noteText(todo.verantwortlich, false);
    const frist = noteText(todo.frist, false);
    if (aufgabe === undefined || verantwortlich === undefined || frist === undefined) {
      errors.todos = `Die To-dos dürfen je Angabe höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.`;
    } else if (aufgabe !== null) {
      todos.push({ aufgabe, verantwortlich, frist });
    }
  }
  const tooLong = `Höchstens ${MAX_NOTE_ITEMS} Einträge mit je ${MAX_NOTE_LENGTH} Zeichen.`;
  if (!beschluesse) errors.beschluesse = tooLong;
  if (!offenePunkte) errors.offenePunkte = tooLong;
  if (naechsterTermin === undefined) errors.naechsterTermin = tooLong;
  const etag = typeof record.etag === 'string' ? record.etag : '';
  if (!etag) errors.etag = 'Die Version der Mitschrift fehlt. Bitte neu laden.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    notes: {
      beschluesse: beschluesse!,
      todos,
      offenePunkte: offenePunkte!,
      naechsterTermin: naechsterTermin!,
    },
    etag,
  };
}

export interface NotizenRequest {
  /** Running notes during the meeting, or the more thorough pass at its end. */
  pass: 'laufend' | 'abschluss';
  /** Store the notes; running notes are only shown on the recording computer. */
  save: boolean;
  /** Replace notes that were changed by hand (the person confirmed it). */
  overwrite: boolean;
  etag: string;
}

export function validateNotizenRequest(body: unknown): NotizenRequest {
  const record = asRecord(body);
  const pass = record.pass === 'laufend' ? 'laufend' : 'abschluss';
  const save = record.save !== false;
  const etag = typeof record.etag === 'string' ? record.etag : '';
  if (save && !etag) {
    throw new ValidationError({ etag: 'Die Version der Mitschrift fehlt. Bitte neu laden.' });
  }
  return { pass, save, overwrite: record.overwrite === true, etag };
}

// --- Protokoll-Editor ---

/** Thrown at the first invalid part of the minutes; reported as the field `inhalt`. */
class InhaltError extends Error {}

/** Control characters other than tab and line breaks; typed text never contains them. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function inhaltRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InhaltError(`${what} fehlt.`);
  }
  return value as Record<string, unknown>;
}

function inhaltList(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new InhaltError(`${what} fehlt.`);
  if (value.length > max) throw new InhaltError(`Höchstens ${max} ${what}.`);
  return value;
}

/**
 * Text as typed: kept exactly (the editor saves while typing, so trimming would fight the
 * cursor), only checked for length and control characters. `line` forbids line breaks.
 */
function inhaltText(value: unknown, what: string, max: number, line = true): string {
  if (typeof value !== 'string') throw new InhaltError(`${what} fehlt.`);
  if (value.length > max) throw new InhaltError(`${what} darf höchstens ${max} Zeichen lang sein.`);
  if (CONTROL_CHARS.test(value) || (line && /[\r\n]/.test(value))) {
    throw new InhaltError(`${what} enthält ungültige Zeichen.`);
  }
  return value;
}

function inhaltOptional(value: unknown, what: string, valid: (text: string) => boolean): string {
  if (value !== '' && (typeof value !== 'string' || !valid(value))) {
    throw new InhaltError(`${what} ist ungültig.`);
  }
  return value;
}

function inhaltId(value: unknown, seen: Set<string>): string {
  if (typeof value !== 'string' || !ELEMENT_ID.test(value) || seen.has(value)) {
    throw new InhaltError('Ein Element des Protokolls hat keine gültige ID.');
  }
  seen.add(value);
  return value;
}

function inhaltPerson(value: unknown): ProtokollPerson {
  const record = inhaltRecord(value, 'Eine Person');
  return {
    login: inhaltText(record.login, 'Der Login', 254),
    name: inhaltText(record.name, 'Der Name', MAX_TITEL),
  };
}

function inhaltAufgabe(value: unknown, seen: Set<string>): ProtokollAufgabe {
  const record = inhaltRecord(value, 'Eine Aufgabe');
  return {
    id: inhaltId(record.id, seen),
    titel: inhaltText(record.titel, 'Der Titel einer Aufgabe', 500),
    zustaendig: inhaltList(record.zustaendig, 'Zuständige', MAX_ZUSTAENDIG).map(inhaltPerson),
    faellig: inhaltOptional(record.faellig, 'Die Fälligkeit einer Aufgabe', isValidDate),
  };
}

function inhaltTermin(value: unknown, seen: Set<string>): PunktTermin {
  const record = inhaltRecord(value, 'Ein Termin');
  return {
    id: inhaltId(record.id, seen),
    titel: inhaltText(record.titel, 'Der Titel eines Termins', 500),
    datum: inhaltOptional(record.datum, 'Das Datum eines Termins', isValidDate),
    uhrzeit: inhaltOptional(record.uhrzeit, 'Die Uhrzeit eines Termins', (t) => TIME.test(t)),
    ort: inhaltText(record.ort, 'Der Ort eines Termins', MAX_TITEL),
    zustaendig: inhaltList(record.zustaendig, 'Zuständige', MAX_ZUSTAENDIG).map(inhaltPerson),
  };
}

/**
 * People of the head. Minutes written before #301 hold one typed string; it is read as one
 * person without login, so they look the same as before.
 */
function inhaltPersonen(value: unknown, what: string, max: number): ProtokollPerson[] {
  if (typeof value === 'string') {
    const name = inhaltText(value, what, MAX_TITEL);
    return name.trim() ? [{ login: '', name }] : [];
  }
  return inhaltList(value, what, max).map(inhaltPerson);
}

function inhaltAktion(value: unknown): ProtokollAktion | null {
  if (value === null) return null;
  const record = inhaltRecord(value, 'Die Aktion');
  if (typeof record.id !== 'string' || !CAMPFLOW_EVENT_ID_PATTERN.test(record.id)) {
    throw new InhaltError('Die Aktion eines Tagesordnungspunkts ist ungültig.');
  }
  return {
    id: record.id,
    titel: inhaltText(record.titel, 'Der Name der Aktion', MAX_TITEL),
    start: inhaltOptional(record.start, 'Der Beginn der Aktion', isValidDate),
    ende: inhaltOptional(record.ende, 'Das Ende der Aktion', isValidDate),
  };
}

function inhaltPunkt(value: unknown, seen: Set<string>, sub: boolean): ProtokollPunkt {
  const record = inhaltRecord(value, 'Ein Tagesordnungspunkt');
  const unterpunkte = inhaltList(record.unterpunkte, 'Unterpunkte', sub ? 0 : MAX_UNTERPUNKTE).map(
    (item) => inhaltPunkt(item, seen, true)
  );
  return {
    id: inhaltId(record.id, seen),
    titel: inhaltText(record.titel, 'Der Titel eines Tagesordnungspunkts', MAX_TITEL),
    aktion: inhaltAktion(record.aktion ?? null),
    text: inhaltText(record.text, 'Der Text eines Tagesordnungspunkts', MAX_TEXT, false),
    aufgaben: inhaltList(record.aufgaben, 'Aufgaben', MAX_AUFGABEN).map((item) =>
      inhaltAufgabe(item, seen)
    ),
    // Missing in minutes stored before #297
    termine: inhaltList(record.termine ?? [], 'Termine', MAX_TERMINE).map((item) =>
      inhaltTermin(item, seen)
    ),
    unterpunkte,
  };
}

function inhaltTeilnahme(value: unknown): ProtokollTeilnahme {
  const record = inhaltRecord(value, 'Eine teilnehmende Person');
  const status = record.status;
  if (status !== 'anwesend' && status !== 'entschuldigt') {
    throw new InhaltError('Die Anwesenheit einer Person ist ungültig.');
  }
  return { ...inhaltPerson(record), status };
}

/** The whole document of the editor, rebuilt from known fields only. */
export function validateProtokollInhalt(value: unknown): ProtokollInhalt {
  try {
    if (JSON.stringify(value ?? null).length > MAX_INHALT_BYTES) {
      throw new InhaltError('Das Protokoll ist zu lang.');
    }
    const record = inhaltRecord(value, 'Der Inhalt');
    const kopf = inhaltRecord(record.kopf, 'Der Kopf');
    const naechste = inhaltRecord(record.naechsteSitzung, 'Die nächste Sitzung');
    const seen = new Set<string>();
    return {
      kopf: {
        sitzungsleitung: inhaltPersonen(
          kopf.sitzungsleitung,
          'Die Sitzungsleitung',
          MAX_SITZUNGSLEITUNG
        ),
        protokollant: inhaltPersonen(kopf.protokollant, 'Wer Protokoll führt', MAX_PROTOKOLLANT),
        beginn: inhaltOptional(kopf.beginn, 'Der Sitzungsbeginn', (t) => TIME.test(t)),
        ende: inhaltOptional(kopf.ende, 'Das Sitzungsende', (t) => TIME.test(t)),
        teilnehmende: inhaltList(kopf.teilnehmende, 'Teilnehmende', MAX_TEILNEHMENDE).map(
          inhaltTeilnahme
        ),
        externe: inhaltText(kopf.externe, 'Die Externen', 2000, false),
      },
      punkte: inhaltList(record.punkte, 'Tagesordnungspunkte', MAX_PUNKTE).map((item) =>
        inhaltPunkt(item, seen, false)
      ),
      naechsteSitzung: {
        datum: inhaltOptional(naechste.datum, 'Das Datum der nächsten Sitzung', isValidDate),
        uhrzeit: inhaltOptional(naechste.uhrzeit, 'Die Uhrzeit der nächsten Sitzung', (t) =>
          TIME.test(t)
        ),
        ort: inhaltText(naechste.ort, 'Der Ort der nächsten Sitzung', MAX_TITEL),
      },
    };
  } catch (error: unknown) {
    if (error instanceof InhaltError) throw new ValidationError({ inhalt: error.message });
    throw error;
  }
}

export interface ProtokollEditorCreateInput {
  title: string;
  date: string;
}

/** Title and date of new minutes. */
export function validateProtokollEditorCreate(body: unknown): ProtokollEditorCreateInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const title = reader.text('title', 'einen Titel', MAX_TITEL, true);
  const date = typeof record.date === 'string' ? record.date : '';
  if (!isValidDate(date)) reader.errors.date = 'Bitte das Datum der Sitzung angeben.';
  reader.done();
  return { title, date };
}

/** Token of the writing tab: random, created by the browser. */
const SPERRE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export interface ProtokollSperreInput {
  token: string;
  /** Take over a lock another tab holds and that has not run out. */
  uebernehmen: boolean;
  aktiverPunkt: string | null;
}

function readSperre(record: Record<string, unknown>, reader: Reader): ProtokollSperreInput {
  const token = typeof record.token === 'string' ? record.token : '';
  if (!SPERRE_TOKEN.test(token)) reader.errors.token = 'Die Sitzung des Editors ist ungültig.';
  const aktiv = record.aktiverPunkt;
  if (
    aktiv !== undefined &&
    aktiv !== null &&
    (typeof aktiv !== 'string' || !ELEMENT_ID.test(aktiv))
  ) {
    reader.errors.aktiverPunkt = 'Der aktive Tagesordnungspunkt ist ungültig.';
  }
  return {
    token,
    uebernehmen: record.uebernehmen === true,
    aktiverPunkt: typeof aktiv === 'string' ? aktiv : null,
  };
}

/** Taking, renewing or releasing the lock. */
export function validateProtokollSperre(body: unknown): ProtokollSperreInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const input = readSperre(record, reader);
  reader.done();
  return input;
}

export type ProtokollSicherung = 'ueberschreiben' | 'wiederherstellen';

export interface ProtokollEditorSaveInput extends ProtokollSperreInput {
  etag: string;
  title: string;
  date: string;
  inhalt: ProtokollInhalt;
  /** Keep the stored version as a revision first (a local or older version replaces it). */
  sicherung: ProtokollSicherung | null;
}

/** A save of the editor: the whole document with the version it was based on. */
export function validateProtokollEditorSave(body: unknown): ProtokollEditorSaveInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const sperre = readSperre(record, reader);
  const etag = reader.text('etag', 'Die Version', 100, true);
  const title = reader.text('title', 'einen Titel', MAX_TITEL, true);
  const date = typeof record.date === 'string' ? record.date : '';
  if (!isValidDate(date)) reader.errors.date = 'Bitte das Datum der Sitzung angeben.';
  const sicherung = record.sicherung ?? null;
  if (sicherung !== null && sicherung !== 'ueberschreiben' && sicherung !== 'wiederherstellen') {
    reader.errors.sicherung = 'Die Sicherung ist ungültig.';
  }
  let inhalt: ProtokollInhalt | undefined;
  try {
    inhalt = validateProtokollInhalt(record.inhalt);
  } catch (error: unknown) {
    if (!(error instanceof ValidationError)) throw error;
    Object.assign(reader.errors, error.fields);
  }
  reader.done();
  return {
    ...sperre,
    etag,
    title,
    date,
    inhalt: inhalt as ProtokollInhalt,
    sicherung: sicherung as ProtokollSicherung | null,
  };
}

// --- Weitere Personen (#301) ---

export type WeiterePersonInput = Pick<WeiterePerson, 'name' | 'login' | 'gruppe' | 'aktiv'>;

const LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A person of the list of Altleitende and others to pick in the minutes. */
export function validateWeiterePerson(body: unknown): WeiterePersonInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const name = reader.text('name', 'einen Namen', MAX_TITEL, true);
  const login = reader.text('login', 'Der Login', 254).toLowerCase();
  if (login && !LOGIN.test(login)) {
    reader.errors.login = 'Bitte den Login als E-Mail-Adresse angeben oder leer lassen.';
  }
  const gruppe = reader.choice('gruppe', 'die Gruppe', ['altleitende', 'weitere']);
  if (typeof record.aktiv !== 'boolean')
    reader.errors.aktiv = 'Bitte angeben, ob die Person aktiv ist.';
  reader.done();
  return {
    name,
    login,
    gruppe: gruppe as WeiterePersonInput['gruppe'],
    aktiv: record.aktiv === true,
  };
}
