import { istMirZugewiesen, type KonversationZeile } from '../../../api/lib/postfach-model';

/**
 * Filters of the list of a mailbox, combined: the state, who is responsible and unread only.
 * The page starts with everything.
 */
export type StandFilter = 'alle' | 'offen' | 'erledigt';
export type ZustaendigFilter = 'alle' | 'mir' | 'niemand';

export interface PostfachFilter {
  stand: StandFilter;
  zustaendig: ZustaendigFilter;
  ungelesen: boolean;
}

export const FILTER_START: PostfachFilter = { stand: 'alle', zustaendig: 'alle', ungelesen: false };

export const STAND_FILTER: readonly { value: StandFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'offen', label: 'Offen' },
  { value: 'erledigt', label: 'Erledigt' },
];

export const ZUSTAENDIG_FILTER: readonly { value: ZustaendigFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'mir', label: 'Ich' },
  { value: 'niemand', label: 'Niemand' },
];

function passtStand(zeile: KonversationZeile, stand: StandFilter): boolean {
  if (stand === 'offen') return !zeile.erledigung;
  if (stand === 'erledigt') return !!zeile.erledigung;
  return true;
}

function passtZustaendig(zeile: KonversationZeile, wer: ZustaendigFilter, ich: string): boolean {
  if (wer === 'mir') return istMirZugewiesen(zeile, ich);
  if (wer === 'niemand') return !zeile.zustaendig;
  return true;
}

function passt(zeile: KonversationZeile, filter: PostfachFilter, ich: string): boolean {
  return (
    passtStand(zeile, filter.stand) &&
    passtZustaendig(zeile, filter.zustaendig, ich) &&
    (!filter.ungelesen || zeile.ungelesen > 0)
  );
}

export function filterKonversationen(
  zeilen: readonly KonversationZeile[],
  filter: PostfachFilter,
  ich: string
): KonversationZeile[] {
  return zeilen.filter((zeile) => passt(zeile, filter, ich));
}

export interface FilterAnzahl {
  stand: Record<StandFilter, number>;
  zustaendig: Record<ZustaendigFilter, number>;
  ungelesen: number;
}

/** What each choice would show, with the other filters as they are. */
export function filterAnzahl(
  zeilen: readonly KonversationZeile[],
  filter: PostfachFilter,
  ich: string
): FilterAnzahl {
  const zaehle = (anders: Partial<PostfachFilter>): number =>
    filterKonversationen(zeilen, { ...filter, ...anders }, ich).length;
  return {
    stand: Object.fromEntries(
      STAND_FILTER.map(({ value }) => [value, zaehle({ stand: value })])
    ) as Record<StandFilter, number>,
    zustaendig: Object.fromEntries(
      ZUSTAENDIG_FILTER.map(({ value }) => [value, zaehle({ zustaendig: value })])
    ) as Record<ZustaendigFilter, number>,
    ungelesen: zaehle({ ungelesen: true }),
  };
}

export function filterAktiv(filter: PostfachFilter): boolean {
  return (
    filter.stand !== FILTER_START.stand ||
    filter.zustaendig !== FILTER_START.zustaendig ||
    filter.ungelesen !== FILTER_START.ungelesen
  );
}

/** Label of a status for the list, the start page and the result note. */
export const STATUS_LABEL = {
  offen: 'Offen',
  erledigt: 'Erledigt',
  kein_handlungsbedarf: 'Kein Handlungsbedarf',
} as const;

const HASH = /^#konversation=([^&]+)$/;

/** The open conversation from the address (`#konversation=<id>`), as the note mails link it. */
export function konversationAusHash(hash: string): string | null {
  const match = HASH.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function konversationHash(id: string): string {
  return `#konversation=${encodeURIComponent(id)}`;
}

const BERLIN = 'Europe/Berlin';

function tag(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: BERLIN }).format(date);
}

/** Short time of a mail in a list: the time today, „gestern“, the day this year, else the date. */
export function mailZeitKurz(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const heute = tag(now);
  const gestern = tag(new Date(now.getTime() - 86_400_000));
  if (tag(date) === heute)
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BERLIN,
    }).format(date);
  if (tag(date) === gestern) return 'gestern';
  const sameYear = heute.slice(0, 4) === tag(date).slice(0, 4);
  return new Intl.DateTimeFormat(
    'de-DE',
    sameYear
      ? { day: 'numeric', month: 'short', timeZone: BERLIN }
      : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BERLIN }
  ).format(date);
}

/** Full time of a mail in the reading view, e.g. „Di., 3. Nov. 2026, 14:32“. */
export function mailZeitLang(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BERLIN,
  }).format(new Date(iso));
}

export function dateiGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * The document of the sandboxed frame that shows a mail. Its own CSP allows no scripts and no
 * requests: images from the internet (often tracking pixels) load only after `externeBilder`.
 * Links open in a new tab.
 */
export function mailDokument(html: string, externeBilder: boolean, dunkel = false): string {
  const img = externeBilder ? 'data: https:' : 'data:';
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:`;
  const farben = dunkel
    ? 'html{color-scheme:dark}body{background:#1b1f24;color:#e6e8eb}a{color:#9cc3ff}'
    : 'html{color-scheme:light}body{background:#fff;color:#1f2933}a{color:#003056}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${farben}body{margin:0;padding:0;display:flow-root;font:15px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin-left:0;padding-left:12px;border-left:3px solid #9aa5b1}</style></head><body>${html}</body></html>`;
}

const EXTERN = /^\s*(?:https?:)?\/\//i;
const BILD_ATTRIBUT = /\b(src|srcset|background|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/**
 * Whether the mail would load images from the internet: absolute or protocol-relative addresses
 * in an attribute that loads an image (each candidate of a `srcset`) or in a CSS `url()`.
 * Embedded `data:` images do not count.
 */
export function hatExterneBilder(html: string): boolean {
  for (const [, name, ...werte] of html.matchAll(BILD_ATTRIBUT)) {
    const wert = werte.find((entry) => entry !== undefined) ?? '';
    const kandidaten = name.toLowerCase() === 'srcset' ? wert.split(',') : [wert];
    if (kandidaten.some((kandidat) => EXTERN.test(kandidat))) return true;
  }
  for (const [, ...werte] of html.matchAll(CSS_URL)) {
    if (EXTERN.test(werte.find((entry) => entry !== undefined) ?? '')) return true;
  }
  return false;
}

/** Escapes a plain text body for the frame, with line breaks. */
export function textAlsHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')}</div>`;
}
