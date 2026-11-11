/**
 * How `NichtEingesetzt.svelte` shows and copies kept input that the dialog did not fill in:
 * readable text instead of storage syntax, and formatted answers as HTML and plain text.
 */
import { sanitizeFaqAnswer } from './api';
import type { GeretteterWert } from './geretteteEingaben';
import { parseHtml } from './html';

/** Only explicitly marked editor HTML is interpreted; ordinary fields stay plain text. */
export function editorHtml(kept: GeretteterWert): string | null {
  return kept.kind === 'editor' && kept.format === 'html' ? sanitizeFaqAnswer(kept.value) : null;
}

/** The text shown for a kept value that is not formatted HTML. */
export function keptText(kept: GeretteterWert): string {
  if (kept.kind === 'checked') return kept.value === 'true' ? 'angehakt' : 'nicht angehakt';
  const text = kept.display ?? kept.value;
  return editorHtml(kept) === '' || text === '' ? 'Leer' : text;
}

/** Plain text of sanitized editor HTML, one line per paragraph, list item or line break. */
export function plainText(html: string): string {
  const doc = parseHtml(html);
  for (const br of doc.querySelectorAll('br')) br.replaceWith(doc.createTextNode('\n'));
  for (const block of doc.querySelectorAll('p, div, li')) block.append('\n');
  return doc.body.textContent?.trim() ?? '';
}

/** What „… kopieren“ puts on the clipboard: HTML and plain text, or only plain text. */
export function clipboardContent(kept: GeretteterWert): { html: string | null; text: string } {
  const html = editorHtml(kept);
  return html !== null
    ? { html, text: plainText(html) }
    : { html: null, text: kept.display ?? kept.value };
}
