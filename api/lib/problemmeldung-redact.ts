/**
 * The cleaning of free text of the Problemmeldungen (#270): what is removed before a text is
 * stored, shown to the language model or sent to GitHub. Used by `problemmeldung-model.ts`
 * (shared with the web frontend), so it must stay free of imports.
 */

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
      if (i > 0 && i < token.length - 1 && (urlLike || lastEquals > i)) {
        // A bracket that closes `[text](https://x.de/a?b=1)` or `(siehe x.de/a?b=1)` stays
        return token.slice(0, i) + (token.endsWith(')') ? ')' : '');
      }
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
/** A token of letters, digits and `._~%+-` with a digit: a code, not a word. Two linear tests. */
function looksLikeCode(token: string): boolean {
  return /^[\w.~%+-]+$/.test(token) && /\d/.test(token);
}

/** The length of a line without the `?`, `&` and `#` at its end: one backward scan. */
function trailingDelimiters(line: string): number {
  let end = line.length;
  while (end > 0 && '?&#'.includes(line[end - 1])) end--;
  return end;
}

function withoutWrappedQuery(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) lines[i] = lines[i].replace(/^[ \t\r]*&[\w.%-]+=\S*/, '');
    const line = lines[i].trimEnd();
    const last = line.slice(Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t')) + 1);
    if (!/[?&#]$/.test(last) || !(last.includes('/') || /\w\.\w/.test(last))) continue;
    // The query may go on over several lines: `?`, `state=offen&`, `code=654321`
    let end = i;
    let open = true;
    while (open && end + 1 < lines.length) {
      const next = /^[ \t]*(\S+)/.exec(lines[end + 1]);
      // Only what is a value of the query (`name=value`, or a code with a digit in it) goes; a
      // following sentence stays, also in a second pass
      if (!next || !(next[1].includes('=') || looksLikeCode(next[1]))) break;
      lines[end + 1] = lines[end + 1].replace(/^[ \t]*\S+/, '');
      open = /[?&#]$/.test(next[1]);
      end++;
    }
    if (end > i) lines[i] = line.slice(0, trailingDelimiters(line));
  }
  return lines.join('\n');
}

/**
 * Free text without what must not be stored or forwarded: query strings and fragments of URLs
 * (they carry tokens), JWTs, bearer tokens, values after `token=`, `password:` and the like,
 * and long random-looking strings.
 */
export function redactSensitive(text: string): string {
  return redactNamedSecrets(
    withoutWrappedQuery(text)
      // eslint-disable-next-line no-control-regex -- control characters other than line breaks
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      // URL user information is private, including on localhost and protocol-relative links.
      .replace(/\/\/[^/\s?#]*@/g, '//')
      .replace(/\S+/g, withoutQuery)
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, REDACTED)
      .replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
      // Headers carry more than one word (`Basic dXNlcjpwYXNz`, `a=1; b=2`): the rest of the line goes
      .replace(
        /\b(authorization|set-cookie|cookie)(["'“”’]?)\s*[:=][^\n]*/gi,
        (_match, name: string, quote: string) => `${name}${quote}: ${REDACTED}`
      )
  ).replace(/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED);
}

/** End of a quoted value, or the remaining text if its closing quote is missing. */
function quotedSecretEnd(text: string, start: number): number {
  const closing = text[start] === '„' ? '“' : text[start];
  let end = start + 1;
  while (end < text.length) {
    if (text[end] === '\\') end = Math.min(end + 2, text.length);
    else if (text[end++] === closing) break;
  }
  return end;
}

function isSecretQuote(character: string): boolean {
  return character === '"' || character === "'" || character === '„';
}

/** End of a complete object/array value, with an explicit stack instead of recursion. */
function structuredSecretEnd(text: string, start: number): number {
  const closing: string[] = [];
  let end = start;
  while (end < text.length) {
    const character = text[end];
    if (isSecretQuote(character)) {
      end = quotedSecretEnd(text, end);
      continue;
    }
    if (character === '{' || character === '[') closing.push(character === '{' ? '}' : ']');
    else if (character === '}' || character === ']') {
      // A malformed value is safer to remove to the end than to retain a possible secret.
      if (closing.pop() !== character) return text.length;
      if (closing.length === 0) return end + 1;
    }
    end++;
  }
  return end;
}

/** Scan each secret value once, including escaped quotes and nested structured values. */
function redactNamedSecrets(text: string): string {
  // Match whole identifiers once; restarting inside a long compound name must stay cheap.
  const field = /(?<![\w-])(-*[A-Za-z_][\w-]*)(["'“”’]?)\s*[:=]\s*/g;
  const parts: string[] = [];
  let copied = 0;
  let match: RegExpExecArray | null;
  while ((match = field.exec(text)) !== null) {
    const name = match[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    if (!/(?:^|[_-])(token|key|secret|passwort|password|kennwort)(?:$|[_-])/i.test(name)) continue;
    let end = field.lastIndex;
    const opening = text[end];
    if (isSecretQuote(opening)) {
      end = quotedSecretEnd(text, end);
    } else {
      if (opening === '{' || opening === '[') end = structuredSecretEnd(text, end);
      // Structured fields keep their separators, so the next field is checked too.
      while (end < text.length && !/\s/.test(text[end])) {
        if (match[2] && (text[end] === ',' || text[end] === '}')) break;
        end++;
      }
    }
    parts.push(text.slice(copied, match.index), `${match[1]}${match[2]}: ${REDACTED}`);
    copied = end;
    field.lastIndex = end;
  }
  parts.push(text.slice(copied));
  return parts.join('');
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
export function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Trimmed text with line breaks kept, secrets removed and cut to `max`. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return redactSensitive(value.replace(/\r\n?/g, '\n')).trim().slice(0, max);
}
