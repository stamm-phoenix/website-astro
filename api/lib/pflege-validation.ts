/**
 * Validation for the edit modules of the Leitendenbereich.
 * Invalid input is reported per field so the forms can show the messages next to the inputs.
 */
import type { HelperRole, TeamRole } from './nikolaus-einteilung';
import { isChangelogId } from './changelog-id';
import { pickStaffSettings } from './staff-settings-model';
import type { StaffSettings } from './staff-settings-model';
import { HELPER_ROLES, KITCHEN, TEAM_ROLES, normalizeTag, parseTags } from './nikolaus-einteilung';
import { CAMPFLOW_EVENT_ID_PATTERN } from './campflow';
import type {
  OffeneAufgabe,
  ProtokollAktion,
  ProtokollAufgabe,
  ProtokollInhalt,
  ProtokollPerson,
  ProtokollProjekt,
  ProtokollPunkt,
  ProtokollTeilnahme,
  PunktTermin,
} from './protokoll-editor-model';
import { CAMPFLOW_PERSON_ID } from './personen-model';
import type { PersonInput } from './personen-model';
import {
  ELEMENT_ID,
  MAX_AUFGABEN,
  MAX_INHALT_BYTES,
  MAX_OFFENE_AUFGABEN,
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
/** Additional tags of blog posts; `img` keeps one checked attribute. */
const BLOG_TAGS = new Set(['h2', 'h3', 'img']);
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
/** Link targets allowed in blog posts and FAQ answers: http(s) and mailto only. */
const SAFE_URL = /^(?:https?:\/\/[^\s"'<>`]+|mailto:[^\s"'<>`/:]+@[^\s"'<>`]+)$/i;

export interface SanitizedRichText {
  html: string;
  /** Number of visible text characters (entities counted as written). */
  textLength: number;
  /** Whether text tokens contain more than whitespace or empty editor placeholders. */
  hasVisibleText: boolean;
}

/** Extra content allowed beyond the formatting tags. */
interface SanitizeOptions {
  /** Keeps links (`href` with http(s) or mailto only); used by blog posts and FAQ answers. */
  links?: boolean;
  /** Blog posts: headings and these images of the post; other images are dropped. */
  blog?: { images: Set<string> };
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
 * With `links`, links (`href` with http(s) or mailto only) are kept as well; with `blog`,
 * headings and images of the post (`data-bild` with the file name only). Mirrors
 * `toCanonicalBlogHtml` and `sanitizeDescription` with links.
 */
function sanitize(
  html: string,
  { links: keepLinks, blog }: SanitizeOptions = {}
): SanitizedRichText {
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
    if (keepLinks && name === 'a') {
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

/** Validates FAQ fields and keeps only the formatting (and links) supported by the public FAQ. */
export function validateQuestionAndAnswer(body: unknown): QuestionAndAnswerInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const question = reader.text('question', 'eine Frage', 255, true);
  const category = reader.text('category', 'das Thema', 100) || 'Allgemein';
  const raw = typeof record.answer === 'string' ? record.answer : '';
  const answer = sanitize(raw, { links: true });
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
  return sanitize(html, { links: true, blog: { images: new Set(images) } });
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

/** Size of the parts a download is uploaded in; the last part may be smaller. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

/**
 * Media types by file extension. The type is never taken from the browser: the website serves
 * the files from its own origin, so an uploaded file must not become a web page or a script.
 */
export { downloadMimeType } from './download-file-name';

// --- Nikolaus-Dispo ---

export interface DispoLoadedCheckOff {
  bookingId: string;
  /** Exact time of the check-off as the Dispo delivered it. */
  checkedOffAt: string;
}

export interface DispoSaveInput {
  version: string;
  /** Visits checked off when the Dispo was loaded, with their time; the plan is built on them. */
  done?: DispoLoadedCheckOff[];
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
  const done = Array.isArray(record.done)
    ? record.done.flatMap((value): DispoLoadedCheckOff[] => {
        const item = asRecord(value);
        return typeof item.bookingId === 'string' && typeof item.checkedOffAt === 'string'
          ? [{ bookingId: item.bookingId, checkedOffAt: item.checkedOffAt }]
          : [];
      })
    : undefined;
  return { version, entries, done };
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
    errors[field] =
      `Die Angaben unter „${label}“ sind ungültig. Entferne sie und gib die Merkmale erneut ein.`;
    return [];
  }
  const tags = parseTags((value as string[]).map((tag) => tag.replace(/,/g, ' ')).join(','));
  if (tags.length > MAX_TAGS)
    errors[field] =
      `Unter „${label}“ sind höchstens ${MAX_TAGS} Merkmale möglich. Entferne die übrigen Merkmale.`;
  else if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    errors[field] =
      `Ein Merkmal unter „${label}“ ist zu lang. Kürze es auf höchstens ${MAX_TAG_LENGTH} Zeichen.`;
  }
  return tags;
}

/** Validates the internal tags of a booking. */
export function validateBookingTags(body: unknown): string[] {
  const errors: FieldErrors = {};
  const tags = readTags(asRecord(body).tags, 'Merkmale für die Einteilung', errors, 'tags');
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
    'Bevorzugt zu Familien mit',
    reader.errors,
    'positiveTags'
  );
  const negativeTags = readTags(
    record.negativeTags,
    'Nicht zu Familien mit',
    reader.errors,
    'negativeTags'
  );
  const negative = new Set(negativeTags.map(normalizeTag));
  if (positiveTags.some((tag) => negative.has(normalizeTag(tag)))) {
    reader.errors.negativeTags =
      'Derselbe Begriff steht in „Bevorzugt zu Familien mit“ und „Nicht zu Familien mit“. Entferne ihn aus einem der beiden Felder.';
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

/** An expense, or income such as a donation or a fee paid in cash; income has no Auslage. */
export const BELEG_ARTEN = ['Ausgabe', 'Einnahme'] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number];

/** Photos are scaled down in the browser; this only guards against oversized requests. */
export const MAX_BELEG_PHOTO_BYTES = 4 * 1024 * 1024;
/** A receipt as PDF, e.g. an invoice by mail; with its page and in base64 the request stays small. */
export const MAX_BELEG_PDF_BYTES = 5 * 1024 * 1024;
/** Shorter photos are too small to read a receipt. */
export const MIN_BELEG_PHOTO_EDGE = 800;
/** Kostenstelle and Kategorie; CampFlow's own names are far shorter. */
export const MAX_BELEG_ZUORDNUNG = 120;
/** 10.000 € – anything above is surely a typo. */
const MAX_BELEG_CENT = 1_000_000;

export interface BelegInput {
  art: BelegArt;
  shop: string;
  /** Date of the receipt, `YYYY-MM-DD`. */
  date: string;
  amountCent: number;
  /** Who gets the Auslage back; empty without one. */
  paidBy: string;
  /** Whether it is an Auslage: someone or the savings book gets the money. */
  payout: boolean;
  /** Older receipts only; it stands in for Kostenstelle and Kategorie where they are missing. */
  aktion: string;
  /** Name of the Kostenstelle in CampFlow; one that does not exist is created on transfer. */
  kostenstelle: string;
  /** Name of the Kategorie; one the Kostenstelle lacks is created on transfer. */
  kategorie: string;
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
 * @param aktion The Aktion stored with an older receipt; it is no longer entered.
 */
export function validateBeleg(body: unknown, today: string, aktion = ''): BelegInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  // Receipts from before income was possible are expenses
  const art: BelegArt =
    record.art === undefined
      ? 'Ausgabe'
      : (reader.choice('art', 'die Art des Belegs', [...BELEG_ARTEN]) as BelegArt);
  const payout = art === 'Ausgabe' && record.payout === true;
  const input: BelegInput = {
    art,
    shop: reader.text('shop', 'das Geschäft', 100, true),
    date: reader.text('date', 'das Datum', 10, true),
    amountCent: 0,
    // Who gets the Auslage back, also „Sparbuch“; nobody when the Stamm paid
    paidBy: reader.text('paidBy', 'wer das Geld ausgelegt hat', 100, payout),
    payout,
    aktion,
    kostenstelle: reader.text('kostenstelle', 'die Kostenstelle', MAX_BELEG_ZUORDNUNG),
    kategorie: reader.text('kategorie', 'die Kategorie', MAX_BELEG_ZUORDNUNG),
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
  // A receipt from before Kostenstelle and Kategorie keeps its Aktion until someone picks them
  if (!input.aktion || input.kostenstelle || input.kategorie) {
    if (!input.kostenstelle && !reader.errors.kostenstelle) {
      reader.errors.kostenstelle = 'Bitte die Kostenstelle angeben.';
    }
    if (!input.kategorie && !reader.errors.kategorie) {
      reader.errors.kategorie = 'Bitte die Kategorie angeben.';
    }
  }
  if (input.status === 'Abgelehnt' && !input.reviewNote) {
    reader.errors.reviewNote = 'Bitte begründen, warum der Beleg abgelehnt wird.';
  }
  if (!input.payout) input.paidBy = '';

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

/** Whether a child was there (`anwesend`) or excused (`entschuldigt`). */
export function validateChildStatus(body: unknown): 'anwesend' | 'entschuldigt' {
  const reader = new Reader(asRecord(body));
  const status = reader.choice('status', 'die Anwesenheit', ['anwesend', 'entschuldigt']);
  reader.done();
  return status === 'entschuldigt' ? 'entschuldigt' : 'anwesend';
}

export interface CancelledInput {
  cancelled: boolean;
  /** The version the page loaded; `null` if the Termin did not exist yet. */
  etag: string | null;
  /**
   * When cancelling: the number of entries (children and guests) the page showed and the
   * leader agreed to delete. Entries do not change the version of the Termin.
   */
  entries: number;
}

/** Whether the Gruppenstunde was cancelled, with the state the page loaded. */
export function validateCancelled(body: unknown): CancelledInput {
  const record = asRecord(body);
  const errors: FieldErrors = {};
  if (typeof record.cancelled !== 'boolean')
    errors.cancelled = 'Die Angabe „Ausgefallen“ ist ungültig.';
  const etag = typeof record.etag === 'string' ? record.etag : null;
  if (etag === null && record.etag !== null)
    errors.etag = 'Die Version des Termins fehlt. Bitte neu laden.';
  const entries = record.entries ?? 0;
  if (typeof entries !== 'number' || !Number.isInteger(entries) || entries < 0)
    errors.entries = 'Die Zahl der Einträge ist ungültig.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { cancelled: record.cancelled === true, etag, entries: Number(entries) };
}

/** The name of a guest who is not in CampFlow. */
export function validateGuestName(body: unknown): string {
  const reader = new Reader(asRecord(body));
  const name = reader.text('name', 'den Namen', 100, true);
  reader.done();
  return name;
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

/** A row of the module Aufgaben: a positive whole number. */
function inhaltTaskId(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 999_999_999) {
    throw new InhaltError(`${what} ist ungültig.`);
  }
  return value;
}

function inhaltProjekt(value: unknown): ProtokollProjekt | null {
  if (value === null) return null;
  const record = inhaltRecord(value, 'Das Projekt');
  return {
    id: inhaltTaskId(record.id, 'Das Projekt eines Tagesordnungspunkts'),
    titel: inhaltText(record.titel, 'Der Name des Projekts', MAX_TITEL),
  };
}

function inhaltOffeneAufgabe(value: unknown): OffeneAufgabe {
  const record = inhaltRecord(value, 'Eine offene Aufgabe');
  if (typeof record.erledigt !== 'boolean') {
    throw new InhaltError('Der Stand einer offenen Aufgabe ist ungültig.');
  }
  return {
    id: inhaltTaskId(record.id, 'Eine offene Aufgabe'),
    titel: inhaltText(record.titel, 'Der Titel einer offenen Aufgabe', 500),
    zustaendig: inhaltList(record.zustaendig, 'Zuständige', 20).map(inhaltPerson),
    faellig: inhaltOptional(record.faellig, 'Die Fälligkeit einer offenen Aufgabe', isValidDate),
    erledigt: record.erledigt,
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
    // Both missing in minutes stored before step 3 of #277
    projekt: inhaltProjekt(record.projekt ?? null),
    offeneAufgaben: inhaltList(
      record.offeneAufgaben ?? [],
      'offene Aufgaben',
      MAX_OFFENE_AUFGABEN
    ).map(inhaltOffeneAufgabe),
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
  /** Start of the meeting („HH:MM“, local time of the browser) or empty. */
  beginn: string;
}

/** Title and date of new minutes, optionally the start of the meeting. */
export function validateProtokollEditorCreate(body: unknown): ProtokollEditorCreateInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const title = reader.text('title', 'einen Titel', MAX_TITEL, true);
  const date = typeof record.date === 'string' ? record.date : '';
  if (!isValidDate(date)) reader.errors.date = 'Bitte das Datum der Sitzung angeben.';
  const beginn = typeof record.beginn === 'string' ? record.beginn : '';
  if (beginn && !TIME.test(beginn)) reader.errors.beginn = 'Bitte eine Uhrzeit wie 19:30 angeben.';
  reader.done();
  return { title, date, beginn };
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

// --- Personen (#301, docs/personen.md) ---

const LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A person of the module „Personen“: a leader's link to CampFlow, or Altleitende and others to
 * pick in the minutes.
 */
export function validatePerson(body: unknown): PersonInput {
  const record = asRecord(body);
  const reader = new Reader(record);
  const name = reader.text('name', 'einen Namen', MAX_TITEL, true);
  const login = reader.text('login', 'Der Login', 254).toLowerCase();
  if (login && !LOGIN.test(login)) {
    reader.errors.login = 'Bitte den Login als E-Mail-Adresse angeben oder leer lassen.';
  }
  const gruppe = reader.choice('gruppe', 'die Gruppe', ['leitende', 'altleitende', 'weitere']);
  if (gruppe === 'leitende' && !login && !reader.errors.login) {
    reader.errors.login = 'Leitende brauchen die E-Mail-Adresse ihres Microsoft-Kontos.';
  }
  const campflowPersonId = reader.text('campflowPersonId', 'Die CampFlow-Person', 64);
  if (campflowPersonId && !CAMPFLOW_PERSON_ID.test(campflowPersonId)) {
    reader.errors.campflowPersonId = 'Bitte eine Person aus der CampFlow-Mitgliederliste wählen.';
  }
  if (typeof record.aktiv !== 'boolean')
    reader.errors.aktiv = 'Bitte angeben, ob die Person aktiv ist.';
  reader.done();
  return {
    name,
    login,
    gruppe: gruppe as PersonInput['gruppe'],
    campflowPersonId,
    aktiv: record.aktiv === true,
  };
}

/** Whether the KJR grant is applied for a CampFlow Aktion (`{ zuschussfaehig }`). */
export function validateAktionZuschuss(body: unknown): boolean {
  const { zuschussfaehig } = asRecord(body);
  if (typeof zuschussfaehig !== 'boolean') {
    throw new ValidationError({
      zuschussfaehig: 'Gib an, ob für die Aktion ein KJR-Zuschuss beantragt wird.',
    });
  }
  return zuschussfaehig;
}

/** Whether a CampFlow event is no real Aktion, e.g. an order of jumpers (`{ keineAktion }`). */
export function validateKeineAktion(body: unknown): boolean {
  const { keineAktion } = asRecord(body);
  if (typeof keineAktion !== 'boolean') {
    throw new ValidationError({
      keineAktion: 'Gib an, ob das Event eine Aktion ist oder nur eine Bestellung oder Anmeldung.',
    });
  }
  return keineAktion;
}

/** More than the Leitendenbereich has modules, so a full selection always fits. */
const MAX_FAVORITES = 50;
const FAVORITE_PATH = /^\/leitendenbereich(?:\/[a-z0-9-]+)*\/?$/;

/** The favorites of the start page (`{ modules }`): paths of Leitendenbereich modules. */
/** The settings to merge; only known keys with valid values pass (`staff-settings-model.ts`). */
export function validateStaffSettings(body: unknown): StaffSettings {
  const { settings } = asRecord(body);
  const known = settings && typeof settings === 'object' ? Object.keys(settings) : null;
  const picked = pickStaffSettings(settings);
  if (!known || known.length === 0 || known.length !== Object.keys(picked).length) {
    throw new ValidationError({
      settings: 'Die Einstellung ist ungültig. Bitte lade die Seite neu und wähle sie erneut.',
    });
  }
  return picked;
}

/** The module a person just opened (`{ module }`), for the recently used areas. */
export function validateStaffRecentVisit(body: unknown): string {
  const { module } = asRecord(body);
  if (typeof module !== 'string' || !FAVORITE_PATH.test(module)) {
    throw new ValidationError({ module: 'Der Bereich ist ungültig.' });
  }
  return module.replace(/\/+$/, '');
}

/** The ID of the newest changelog entry a person has seen (`{ lastSeenId }`). */
export function validateChangelogSeen(body: unknown): string {
  const { lastSeenId } = asRecord(body);
  if (!isChangelogId(lastSeenId)) {
    throw new ValidationError({ lastSeenId: 'Die Neuigkeit ist ungültig.' });
  }
  return lastSeenId;
}

export function validateStaffFavorites(body: unknown): string[] {
  const { modules } = asRecord(body);
  if (
    !Array.isArray(modules) ||
    modules.length > MAX_FAVORITES ||
    !modules.every((module) => typeof module === 'string' && FAVORITE_PATH.test(module))
  ) {
    throw new ValidationError({
      modules: 'Die Favoriten sind ungültig. Bitte lade die Seite neu und wähle sie erneut.',
    });
  }
  return [...new Set(modules as string[])];
}

/** The attendance shown when a leader confirms deleting a Gruppenstunde. */
export function validateMeetingDeletion(body: unknown): string {
  const record = asRecord(body);
  if (typeof record.attendance !== 'string' || record.attendance.length > 100_000) {
    throw new ValidationError({ attendance: 'Lade die Gruppenstunde neu, bevor du sie löschst.' });
  }
  return record.attendance;
}
