/**
 * The rules of the Problemmeldungen (#270, `docs/problemmeldungen.md`), shared between the API
 * and the web frontend (re-exported via `web/src/lib/problemmeldung.ts`). Must stay free of
 * imports.
 *
 * A visitor's report only ever carries what this file lets through: paths without query and
 * fragment, short codes and numbers instead of error messages, and free text with the usual
 * secrets removed. The same functions decide what goes to the language model and to GitHub.
 */

export const PROBLEM_ENTRIES = ['footer', 'fehler'] as const;
export type ProblemEntry = (typeof PROBLEM_ENTRIES)[number];

export const PROBLEM_ENVIRONMENTS = ['produktion', 'vorschau'] as const;
export type ProblemEnvironment = (typeof PROBLEM_ENVIRONMENTS)[number];

export const PROBLEM_STATUS = ['neu', 'in_pruefung', 'verworfen', 'uebermittelt'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUS)[number];

/** Whether a report is still open, i.e. can be edited, discarded or sent. */
export function isProblemOpen(status: ProblemStatus): boolean {
  return status === 'neu' || status === 'in_pruefung';
}

export const PROBLEM_AI_STATUS = [
  'offen',
  'laeuft',
  'fertig',
  'fehler',
  'nicht_eingerichtet',
] as const;
export type ProblemAiStatus = (typeof PROBLEM_AI_STATUS)[number];

export const PROBLEM_VERDICTS = ['spam', 'plausibel', 'unklar'] as const;
export type ProblemVerdict = (typeof PROBLEM_VERDICTS)[number];

/** Labels a leader may choose for the issue; `id` is the label in the GitHub repository. */
export const PROBLEM_LABELS = [
  { id: 'bug', label: 'Fehler' },
  { id: 'enhancement', label: 'Verbesserung' },
  { id: 'documentation', label: 'Dokumentation' },
  { id: 'question', label: 'Frage' },
] as const;
export type ProblemLabel = (typeof PROBLEM_LABELS)[number]['id'];

export const PROBLEM_MAX_LENGTH = {
  description: 4000,
  steps: 2000,
  expected: 1000,
  contact: 254,
  title: 200,
  body: 8000,
  discardReason: 500,
  page: 200,
  module: 60,
  errorCode: 60,
  action: 200,
  correlationId: 100,
  browser: 80,
};

/** Shorter reports are almost always accidental submissions. */
export const PROBLEM_MIN_DESCRIPTION_LENGTH = 10;

/** The technical context a report can carry; every value is already cleaned. */
export interface ProblemContext {
  page: string;
  module: string;
  errorCode: string;
  httpStatus: number | null;
  action: string;
  correlationId: string;
  appVersion: string;
  browser: string;
  viewport: string;
}

export interface ProblemReport {
  entry: ProblemEntry;
  description: string;
  steps: string;
  expected: string;
  contact: string;
  context: ProblemContext;
}

export type ProblemField = 'description' | 'steps' | 'expected' | 'contact' | 'entry';

export interface ProblemValidation {
  /** The cleaned report, or `null` if any field is invalid. */
  report: ProblemReport | null;
  errors: Partial<Record<ProblemField, string>>;
}

export const EMPTY_PROBLEM_CONTEXT: ProblemContext = {
  page: '',
  module: '',
  errorCode: '',
  httpStatus: null,
  action: '',
  correlationId: '',
  appVersion: '',
  browser: '',
  viewport: '',
};

// --- Cleaning -------------------------------------------------------------------------------

const REDACTED = '[entfernt]';

/**
 * A token of a text without query and fragment, if it looks like a URL: at some `?` or `#` the
 * part before it has a path, a dot, a port or an IPv6 address (`/a`, `x.de`, `localhost:4321`,
 * `[::1]`), or the part after it has a `name=value`. Everything from the first such place goes,
 * also paths and further parameters inside the query. Other tokens (`Warum?`, `ja?nein`, `#42`)
 * stay; the earlier `?` of `[Warum?](https://x.de/a#1)` does not hide the link behind it. Errs on
 * the side of cutting: a secret in a link is worse than a lost word.
 */
function withoutQuery(token: string): string {
  // One pass: the work must stay linear, the text comes from anybody
  const lastEquals = token.lastIndexOf('=');
  let urlLike = false;
  for (let i = 0; i < token.length; i++) {
    const char = token[i];
    if (char === '?' || char === '#') {
      if (i > 0 && i < token.length - 1 && (urlLike || lastEquals > i)) return token.slice(0, i);
    } else if (char === '/' || char === '.' || char === ':' || char === ']') {
      urlLike = true;
    }
  }
  return token;
}

/**
 * Parts of a copied link that a line break separated from its start: the line after a link that
 * ends in `?` or `&`, and lines that continue the query with `&name=value`.
 */
function withoutWrappedQuery(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) lines[i] = lines[i].replace(/^[ \t\r]*&[\w.%-]+=\S*/, '');
    const line = lines[i].trimEnd();
    const last = line.slice(Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t')) + 1);
    if (!/[?&#]$/.test(last) || !(last.includes('/') || /\w\.\w/.test(last))) continue;
    const next = i + 1 < lines.length ? /^[ \t]*(\S+)/.exec(lines[i + 1]) : null;
    // Only what is a value of the query goes (`name=value`, or a code with a digit in it); a
    // following sentence stays, also in a second pass
    if (!next || !(next[1].includes('=') || /^[\w.~%+-]*\d[\w.~%+-]*$/.test(next[1]))) continue;
    lines[i + 1] = lines[i + 1].replace(/^[ \t]*\S+/, '');
    lines[i] = line.replace(/[?&#]+$/, '');
  }
  return lines.join('\n');
}

/**
 * Free text without what must not be stored or forwarded: query strings and fragments of URLs
 * (they carry tokens), JWTs, bearer tokens, values after `token=`, `password:` and the like,
 * and long random-looking strings.
 */
export function redactSensitive(text: string): string {
  return (
    withoutWrappedQuery(text)
      // eslint-disable-next-line no-control-regex -- control characters other than line breaks
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\S+/g, withoutQuery)
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, REDACTED)
      .replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
      // Headers carry more than one word (`Basic dXNlcjpwYXNz`, `a=1; b=2`): the rest of the line goes
      .replace(
        /\b(authorization|set-cookie|cookie)\s*[:=][^\n]*/gi,
        (_match, name: string) => `${name}: ${REDACTED}`
      )
      .replace(
        /\b(token|key|secret|passwort|password|kennwort)\s*[:=]\s*\S+/gi,
        (_match, name: string) => `${name}: ${REDACTED}`
      )
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED)
  );
}

/** Whether a domain part has a dot with something on both sides. */
function hasInnerDot(domain: string): boolean {
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot < domain.length - 1;
}

/**
 * A token without what looks like an e-mail address (`name@domain.tld`, also with umlauts), by
 * splitting at the `@`: linear, unlike a pattern that searches around each one.
 */
function redactEmailToken(token: string): string {
  if (!token.includes('@')) return token;
  const parts = token.split('@');
  let result = '';
  for (let i = 0; i < parts.length;) {
    if (i + 1 < parts.length && parts[i] !== '' && hasInnerDot(parts[i + 1])) {
      result += '[E-Mail entfernt]';
      i += 2;
    } else {
      result += parts[i] + (i + 1 < parts.length ? '@' : '');
      i += 1;
    }
  }
  return result;
}

/**
 * For text that is sent on to GitHub or the model: also without e-mail addresses (anything that
 * looks like one, so every address the form accepts is covered) and without the contact address
 * of the report itself, wherever it appears.
 */
export function redactForForwarding(text: string, contact = ''): string {
  let result = redactSensitive(text);
  const own = contact.trim().toLowerCase();
  if (own) {
    const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '[E-Mail entfernt]');
  }
  return result.replace(/\S+/g, redactEmailToken);
}

/** Trimmed text of one line, cut to `max`; `''` for anything else. */
function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Trimmed text with line breaks kept, secrets removed and cut to `max`. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return redactSensitive(value.replace(/\r\n?/g, '\n')).trim().slice(0, max);
}

/**
 * A path segment that is probably a link secret or an ID: long, and with a digit or mixed case,
 * which names of pages (`fragen-und-antworten`) do not have.
 */
function looksLikeSecret(segment: string): boolean {
  return (
    /^[A-Za-z0-9_-]{20,}$/.test(segment) &&
    (/\d/.test(segment) || (/[a-z]/.test(segment) && /[A-Z]/.test(segment)))
  );
}

/**
 * The path of a page or route without origin, query and fragment. Long segments that look like
 * a token or an ID are replaced by `:id`, as they may be a link secret (`/abstimmung/<token>`).
 * `''` if the value is no path.
 */
export function cleanPath(value: unknown, max = PROBLEM_MAX_LENGTH.page): string {
  if (typeof value !== 'string') return '';
  let path = value.trim().replace(/^https?:\/\/[^/?#]+/i, '');
  path = path.split(/[?#]/)[0];
  if (!path.startsWith('/') || !/^[A-Za-z0-9/_\-.~%:]+$/.test(path)) return '';
  const masked = path
    .split('/')
    .map((segment) => (looksLikeSecret(segment) ? ':id' : segment))
    .join('/');
  return masked.length <= max ? masked : '';
}

/** An API route (`/api/...`) of a failed request, cleaned like a page path. */
export function cleanApiRoute(value: unknown): string {
  const path = cleanPath(value, PROBLEM_MAX_LENGTH.action);
  return path.startsWith('/api/') ? path : '';
}

function cleanPattern(value: unknown, pattern: RegExp): string {
  return typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : '';
}

/** The technical context of a report, reduced to the allowed shapes. */
export function cleanProblemContext(input: unknown): ProblemContext {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const status = Number(raw.httpStatus);
  return {
    page: cleanPath(raw.page),
    module: oneLine(raw.module, PROBLEM_MAX_LENGTH.module).replace(/[^\p{L}\p{N} &.,()-]/gu, ''),
    errorCode: cleanPattern(raw.errorCode, /^[A-Za-z0-9_.-]{1,60}$/),
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    action: cleanApiRoute(raw.action),
    correlationId: cleanPattern(raw.correlationId, /^[A-Za-z0-9._:-]{8,100}$/),
    appVersion: cleanPattern(raw.appVersion, /^[0-9a-f]{7,40}$/i).toLowerCase(),
    browser: cleanPattern(raw.browser, /^[\p{L}\p{N} .,()/_+·-]{1,80}$/u),
    viewport: cleanPattern(raw.viewport, /^\d{2,5}x\d{2,5}$/),
  };
}

/**
 * „Firefox 133 · Linux“ from a user agent: browser and operating system with their major
 * version, nothing else of the long string.
 */
export function describeBrowser(userAgent: string): string {
  const major = (pattern: RegExp): string | undefined => pattern.exec(userAgent)?.[1];
  const edge = major(/\bEdg\/(\d+)/);
  const firefox = major(/\b(?:Firefox|FxiOS)\/(\d+)/);
  const chrome = major(/\b(?:Chrome|CriOS)\/(\d+)/);
  const safari = major(/\bVersion\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//);
  const browser = edge
    ? `Edge ${edge}`
    : firefox
      ? `Firefox ${firefox}`
      : chrome
        ? `Chrome ${chrome}`
        : safari
          ? `Safari ${safari}`
          : '';
  const android = major(/\bAndroid (\d+)/);
  const ios = major(/\b(?:iPhone|CPU) OS (\d+)/);
  const system = android
    ? `Android ${android}`
    : ios
      ? `iOS ${ios}`
      : /\bWindows\b/.test(userAgent)
        ? 'Windows'
        : /\bMac OS X\b/.test(userAgent)
          ? 'macOS'
          : /\bLinux\b/.test(userAgent)
            ? 'Linux'
            : '';
  return [browser, system].filter(Boolean).join(' · ');
}

// --- Report ---------------------------------------------------------------------------------

/** Whether the value is a plausible e-mail address within the length limit. */
function isEmail(value: string): boolean {
  return value.length <= PROBLEM_MAX_LENGTH.contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Validates a report and cleans everything in it. The description is required; steps, expected
 * behavior and the contact address are optional, but a contact address must be plausible. The
 * entry is `footer` unless the report says it comes from an error message. Extra fields are
 * ignored. Lengths count UTF-16 code units.
 */
export function validateProblemReport(input: Record<string, unknown>): ProblemValidation {
  const errors: ProblemValidation['errors'] = {};

  const rawDescription = typeof input.description === 'string' ? input.description.trim() : '';
  // Cleaning only follows the length check: a huge text from anybody must stay cheap to refuse
  const description =
    rawDescription.length <= PROBLEM_MAX_LENGTH.description
      ? cleanText(rawDescription, PROBLEM_MAX_LENGTH.description)
      : '';
  if (!rawDescription) {
    errors.description = 'Bitte beschreib das Problem.';
  } else if (rawDescription.length > PROBLEM_MAX_LENGTH.description) {
    errors.description = `Die Beschreibung darf höchstens ${PROBLEM_MAX_LENGTH.description} Zeichen lang sein.`;
  } else if (description.length < PROBLEM_MIN_DESCRIPTION_LENGTH) {
    errors.description = `Bitte beschreib das Problem mit mindestens ${PROBLEM_MIN_DESCRIPTION_LENGTH} Zeichen.`;
  }

  const rawSteps = typeof input.steps === 'string' ? input.steps.trim() : '';
  if (rawSteps.length > PROBLEM_MAX_LENGTH.steps)
    errors.steps = `Die Schritte dürfen höchstens ${PROBLEM_MAX_LENGTH.steps} Zeichen lang sein.`;
  const rawExpected = typeof input.expected === 'string' ? input.expected.trim() : '';
  if (rawExpected.length > PROBLEM_MAX_LENGTH.expected)
    errors.expected = `Das darf höchstens ${PROBLEM_MAX_LENGTH.expected} Zeichen lang sein.`;

  const contact = typeof input.contact === 'string' ? input.contact.trim() : '';
  if (contact && !isEmail(contact))
    errors.contact = 'Bitte gib eine gültige E-Mail-Adresse an oder lass das Feld leer.';

  const entry: ProblemEntry = input.entry === 'fehler' ? 'fehler' : 'footer';

  if (Object.keys(errors).length > 0) return { report: null, errors };
  return {
    report: {
      entry,
      description,
      steps: cleanText(rawSteps, PROBLEM_MAX_LENGTH.steps),
      expected: cleanText(rawExpected, PROBLEM_MAX_LENGTH.expected),
      contact,
      context: cleanProblemContext(input.context),
    },
    errors,
  };
}

/** A report as the Leitendenbereich shows it. */
export interface StaffProblemMeldung {
  id: string;
  etag: string;
  createdAt: string;
  entry: ProblemEntry;
  environment: ProblemEnvironment;
  description: string;
  steps: string;
  expected: string;
  contact: string;
  context: ProblemContext;
  status: ProblemStatus;
  ai: {
    status: ProblemAiStatus;
    verdict: ProblemVerdict | null;
    reason: string;
    error: string;
    at: string | null;
  };
  draft: { title: string; body: string; label: ProblemLabel };
  reviewedBy: string;
  reviewedAt: string | null;
  discardReason: string;
  github: {
    number: number | null;
    url: string;
    at: string | null;
    /** A hand-over was started but has no result: it runs right now or ended unclear. */
    pending: boolean;
  };
}

// --- Issue ----------------------------------------------------------------------------------

/** What of a report goes into the GitHub issue besides the draft. */
export interface IssueSource {
  id: number;
  createdAt: string;
  entry: ProblemEntry;
  environment: ProblemEnvironment;
  context: ProblemContext;
  /** The contact address of the report; it is removed from the draft wherever it appears. */
  contact?: string;
}

/** The line that identifies the report in the issue; used to find it again after an unclear send. */
export function issueMarker(id: number): string {
  return `Problemmeldung PM-${id}`;
}

function cell(value: string): string {
  return value.replace(/[|`\r\n]/g, ' ').trim();
}

/**
 * The technical details of a report as the table at the end of the issue. Only these fields
 * and the marker go to GitHub in addition to the draft: never the contact address or the
 * original text.
 */
export function issueDetails(source: IssueSource): string {
  const { context } = source;
  const rows: [string, string][] = [
    ['Eingang', source.createdAt],
    ['Einstieg', source.entry === 'fehler' ? 'Fehleranzeige' : 'Footer'],
    ['Seite', context.page],
    ['Modul', context.module],
    ['Fehlercode', context.errorCode],
    ['HTTP-Status', context.httpStatus === null ? '' : String(context.httpStatus)],
    ['Aktion / Route', context.action],
    ['Korrelation', context.correlationId],
    ['Version', context.appVersion],
    ['Umgebung', source.environment === 'vorschau' ? 'PR-Vorschau' : 'Produktion'],
    ['Browser', context.browser],
    ['Fenstergröße', context.viewport],
  ];
  const lines = rows
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `| ${name} | ${cell(value)} |`);
  return ['| Angabe | Wert |', '| --- | --- |', ...lines].join('\n');
}

/** The complete issue text: the draft, the technical details and the marker. */
export function buildIssueBody(draft: string, source: IssueSource): string {
  return [
    redactForForwarding(draft, source.contact).trim(),
    '## Technische Angaben',
    issueDetails(source),
    `_${issueMarker(source.id)} · über „Problem melden“ auf stamm-phoenix.de gemeldet_`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The cleaned title of an issue: one line, no secrets, within the limit. */
export function cleanIssueTitle(value: unknown, max = PROBLEM_MAX_LENGTH.title): string {
  return redactForForwarding(oneLine(value, Infinity)).trim().slice(0, max);
}

/** The cleaned draft text of an issue. */
export function cleanIssueText(value: unknown, max = PROBLEM_MAX_LENGTH.body): string {
  return cleanText(value, Infinity).slice(0, max);
}

export function isProblemLabel(value: unknown): value is ProblemLabel {
  return PROBLEM_LABELS.some((label) => label.id === value);
}

/** Whether an issue text carries the marker of the report, so it is the issue of this report. */
export function containsIssueMarker(text: string, id: number): boolean {
  return text.includes(`${issueMarker(id)} ·`);
}
