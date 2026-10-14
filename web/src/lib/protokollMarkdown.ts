import { Lexer } from 'marked';
import type { MdToken } from '../../../api/lib/protokoll-markdown';
import {
  MARKED_OPTIONS,
  markdownTree,
  normalizeBullets,
} from '../../../api/lib/protokoll-markdown';
import type { MdBlock } from '../../../api/lib/protokoll-markdown';

export type { MdAlign, MdBlock, MdInline, MdListItem } from '../../../api/lib/protokoll-markdown';
export { continueList, normalizeBullets, safeHref } from '../../../api/lib/protokoll-markdown';

/**
 * The text of an agenda item as a tree of blocks, ready for `ProtokollText.svelte`. The same
 * tree makes the PDF (`api/lib/protokoll-editor-pdf.ts`), see `api/lib/protokoll-markdown.ts`.
 */
export function parseProtokollMarkdown(text: string): MdBlock[] {
  // marked's tokens are a richer union of the same shape
  const tokens = new Lexer(MARKED_OPTIONS).lex(normalizeBullets(text)) as unknown as MdToken[];
  return markdownTree(tokens);
}
