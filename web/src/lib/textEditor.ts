/**
 * The shared formatting editor (`components/ui/TextEditor.svelte`, #320): the Tiptap extensions
 * for the features a place offers, and the Markdown options that match the minutes.
 *
 * Markdown is the stored format; the editor parses it with the same marked options as
 * `ProtokollText.svelte`, so what the editor shows is what the page shows.
 */
import type { Extensions } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { MARKED_OPTIONS } from '../../../api/lib/protokoll-markdown';

export { normalizeBullets } from '../../../api/lib/protokoll-markdown';

/** Which tools a place offers; bold, italic, strikethrough, code and plain lists are always there. */
export interface TextEditorFeatures {
  /** Heading levels, e.g. `[1, 2]` for Markdown (`#`, `##`). */
  headings?: number[];
  links?: boolean;
  checklists?: boolean;
  tables?: boolean;
  /** Quotes, code blocks and horizontal rules. */
  blocks?: boolean;
}

/** Link targets the editor accepts; the same the minutes render (`safeHref`). */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto'];

/** The extensions for the features; `placeholder` is shown while the text is empty. */
export function editorExtensions(features: TextEditorFeatures, placeholder = ''): Extensions {
  const extensions: Extensions = [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    Strike,
    Code,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    UndoRedo,
    Markdown.configure({ markedOptions: MARKED_OPTIONS }),
  ];
  if (placeholder) extensions.push(Placeholder.configure({ placeholder }));
  if (features.headings?.length) {
    extensions.push(Heading.configure({ levels: features.headings as (1 | 2 | 3 | 4 | 5 | 6)[] }));
  }
  if (features.links) {
    extensions.push(
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
        autolink: true,
        protocols: LINK_PROTOCOLS,
        defaultProtocol: 'https',
        // Stored as Markdown, so no target or rel in the document
        HTMLAttributes: { target: null, rel: null },
      })
    );
  }
  if (features.checklists) {
    extensions.push(
      TaskList,
      TaskItem.configure({
        nested: true,
        a11y: {
          checkboxLabel: (node, checked) =>
            `${checked ? 'Erledigt' : 'Offen'}: ${node.textContent || 'leerer Punkt'}`,
        },
      })
    );
  }
  if (features.tables) {
    extensions.push(Table.configure({ resizable: false }), TableRow, TableHeader, TableCell);
  }
  if (features.blocks) extensions.push(Blockquote, CodeBlock, HorizontalRule);
  return extensions;
}

/**
 * `@tiptap/markdown` writes `<`, `>` and `&` as HTML entities, meant for Markdown that becomes
 * HTML. The minutes show their Markdown as text (`protokoll-markdown.ts`), so an entity would
 * appear literally. Only the backslash escapes for Markdown syntax are kept.
 */
interface TextEncoding {
  encodeTextForMarkdown: (text: string, node: unknown, parent: unknown) => string;
  escapeMarkdownSyntax: (text: string) => string;
}
const manager = MarkdownManager.prototype as unknown as TextEncoding;
const encodeWithEntities = manager.encodeTextForMarkdown;
manager.encodeTextForMarkdown = function (this: TextEncoding, text, node, parent) {
  // Inside code the original returns the text unchanged; outside it escapes the syntax
  const encoded = encodeWithEntities.call(this, text, node, parent);
  return encoded === text ? text : this.escapeMarkdownSyntax(text);
};

/** Parses and serializes Markdown like the editor does, without a browser; for tests. */
export function markdownManager(features: TextEditorFeatures): MarkdownManager {
  return new MarkdownManager({
    extensions: editorExtensions(features),
    markedOptions: MARKED_OPTIONS,
  });
}
