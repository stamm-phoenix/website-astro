/**
 * Markdown of the Protokoll-Editor (#299, `docs/protokoll-editor.md`): CommonMark with the
 * GitHub additions (tables, task lists, strikethrough, links found in the text). The tokens of
 * `marked` become a small tree that the page (`ProtokollText.svelte`) and the PDF
 * (`protokoll-editor-pdf.ts`) render the same way, never as HTML: raw HTML in the text stays
 * visible as text, and links keep only http(s) and mailto. Single line breaks are kept, as the
 * editor always did.
 *
 * Shared with the frontend, so free of imports: each side lexes with its own `marked`
 * (`MARKED_OPTIONS`) and passes the tokens to `markdownTree`.
 */

/** Options of `marked`'s `Lexer` on both sides. */
export const MARKED_OPTIONS = { gfm: true, breaks: true } as const;

/** The parts of a `marked` token this module reads. */
export interface MdToken {
  type: string;
  raw: string;
  text?: string;
  href?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | '';
  task?: boolean;
  checked?: boolean;
  tokens?: MdToken[];
  items?: MdToken[];
  align?: (string | null)[];
  header?: { tokens: MdToken[] }[];
  rows?: { tokens: MdToken[] }[][];
}

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'br' }
  | { type: 'link'; href: string; children: MdInline[] };

export interface MdListItem {
  /** `null` for a plain item, else whether its box is ticked. */
  checked: boolean | null;
  blocks: MdBlock[];
}

export type MdAlign = 'left' | 'center' | 'right' | null;

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'heading'; depth: number; children: MdInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { type: 'code'; text: string }
  | { type: 'quote'; blocks: MdBlock[] }
  | { type: 'hr' }
  | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] };

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

/** The link target if it is http(s) or mailto, else `null` (the link stays plain text). */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return SAFE_LINK.test(trimmed) && !/[\s<>"`]/.test(trimmed) ? trimmed : null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * `• ` started list items before #299; Markdown knows only `-`, `*` and `+`. Turns them into
 * `- ` outside code blocks, so old minutes look the same.
 */
export function normalizeBullets(text: string): string {
  let fence: string | null = null;
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker && fence === null) {
        fence = marker;
        return line;
      }
      // A fence closes with the same character, at least as long as it opened
      if (marker && fence !== null && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        return line;
      }
      return fence === null ? line.replace(/^(\s*)•(\s+)/, '$1-$2') : line;
    })
    .join('\n');
}

function inline(tokens: MdToken[] | undefined): MdInline[] {
  const result: MdInline[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        result.push({ type: token.type, children: inline(token.tokens) });
        break;
      case 'codespan':
        result.push({ type: 'code', text: token.text ?? '' });
        break;
      case 'br':
        result.push({ type: 'br' });
        break;
      case 'link': {
        const href = safeHref(token.href ?? '');
        if (href) result.push({ type: 'link', href, children: inline(token.tokens) });
        else result.push({ type: 'text', text: token.raw });
        break;
      }
      case 'image': {
        // No images from elsewhere (privacy): the description links to the image instead
        const href = safeHref(token.href ?? '');
        const text = token.text || token.href || '';
        if (href) result.push({ type: 'link', href, children: [{ type: 'text', text }] });
        else result.push({ type: 'text', text: token.raw });
        break;
      }
      case 'text':
        if (token.tokens?.length) result.push(...inline(token.tokens));
        else result.push({ type: 'text', text: token.text ?? '' });
        break;
      case 'escape':
        result.push({ type: 'text', text: token.text ?? '' });
        break;
      default:
        // Raw HTML and anything unknown stay visible as typed
        result.push({ type: 'text', text: token.raw });
    }
  }
  // Neighbouring text pieces in one node keep the tree small
  return result.reduce<MdInline[]>((merged, node) => {
    const last = merged[merged.length - 1];
    if (node.type === 'text' && last?.type === 'text') last.text += node.text;
    else merged.push(node.type === 'text' ? { ...node } : node);
    return merged;
  }, []);
}

function alignment(value: string | null): MdAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

function listItem(item: MdToken): MdListItem {
  const tokens = (item.tokens ?? []).filter((token) => token.type !== 'checkbox');
  return { checked: item.task ? Boolean(item.checked) : null, blocks: blocks(tokens) };
}

function blocks(tokens: MdToken[]): MdBlock[] {
  const result: MdBlock[] = [];
  let lastToken: MdToken | undefined;
  for (const token of tokens) {
    const previousToken = lastToken;
    lastToken = token;
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'paragraph':
        result.push({ type: 'paragraph', children: inline(token.tokens) });
        break;
      case 'text':
        // Text of a tight list item
        result.push({
          type: 'paragraph',
          children: token.tokens
            ? inline(token.tokens)
            : [{ type: 'text', text: token.text ?? '' }],
        });
        break;
      case 'heading':
        result.push({ type: 'heading', depth: token.depth ?? 1, children: inline(token.tokens) });
        break;
      case 'list': {
        const items = (token.items ?? []).map(listItem);
        const previous = result[result.length - 1];
        // `- a` directly followed by `* b` (or `• c`) is one list, as before #299
        if (
          !token.ordered &&
          previous?.type === 'list' &&
          !previous.ordered &&
          previousToken?.type === 'list'
        ) {
          previous.items.push(...items);
          break;
        }
        result.push({
          type: 'list',
          ordered: Boolean(token.ordered),
          start: typeof token.start === 'number' ? token.start : 1,
          items,
        });
        break;
      }
      case 'code':
        result.push({ type: 'code', text: token.text ?? '' });
        break;
      case 'blockquote':
        result.push({ type: 'quote', blocks: blocks(token.tokens ?? []) });
        break;
      case 'hr':
        result.push({ type: 'hr' });
        break;
      case 'table':
        result.push({
          type: 'table',
          align: (token.align ?? []).map(alignment),
          header: (token.header ?? []).map((cell) => inline(cell.tokens)),
          rows: (token.rows ?? []).map((row) => row.map((cell) => inline(cell.tokens))),
        });
        break;
      default:
        // Raw HTML (`<script>`, `<img onerror>` …) is shown as typed, never interpreted
        if (token.raw.trim()) {
          result.push({ type: 'paragraph', children: [{ type: 'text', text: token.raw.trim() }] });
        }
    }
  }
  return result;
}

/**
 * The tree of an agenda item's text from the tokens of `new Lexer(MARKED_OPTIONS)` applied to
 * `normalizeBullets(text)`.
 */
export function markdownTree(tokens: readonly MdToken[]): MdBlock[] {
  return blocks([...tokens]);
}

/**
 * Continues a list when Enter is pressed at the end of `line`: the marker of the next line
 * (`- `, `2. `, `- [ ] `), `''` to end the list on an empty item, or `null` outside a list.
 */
export function continueList(line: string): { next: string; end: boolean } | null {
  const match = /^(\s*)([-*+•]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (!match) return null;
  const [marker, indent, bullet, number, delimiter, space, task] = match;
  if (!line.slice(marker.length).trim()) return { next: '', end: true };
  const nextBullet = number ? `${Number(number) + 1}${delimiter}` : bullet;
  return { next: `${indent}${nextBullet}${space}${task ? '[ ] ' : ''}`, end: false };
}
