import { istMirZugewiesen, type KonversationZeile } from '../../../api/lib/postfach-model';

/** Filters of the list of a mailbox. */
export type PostfachFilter = 'alle' | 'ungelesen' | 'mir' | 'offen';

export const POSTFACH_FILTER: readonly { value: PostfachFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'ungelesen', label: 'Ungelesen' },
  { value: 'mir', label: 'Mir zugewiesen' },
  { value: 'offen', label: 'Ohne Zuständige' },
];

export function filterKonversationen(
  zeilen: readonly KonversationZeile[],
  filter: PostfachFilter,
  ich: string
): KonversationZeile[] {
  switch (filter) {
    case 'ungelesen':
      return zeilen.filter((zeile) => zeile.ungelesen > 0);
    case 'mir':
      return zeilen.filter((zeile) => istMirZugewiesen(zeile, ich));
    case 'offen':
      return zeilen.filter((zeile) => !zeile.zustaendig);
    default:
      return [...zeilen];
  }
}

export function filterAnzahl(
  zeilen: readonly KonversationZeile[],
  ich: string
): Record<PostfachFilter, number> {
  return {
    alle: zeilen.length,
    ungelesen: filterKonversationen(zeilen, 'ungelesen', ich).length,
    mir: filterKonversationen(zeilen, 'mir', ich).length,
    offen: filterKonversationen(zeilen, 'offen', ich).length,
  };
}

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

/** Whether the mail would load images from the internet. */
export function hatExterneBilder(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

/** Escapes a plain text body for the frame, with line breaks. */
export function textAlsHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')}</div>`;
}
