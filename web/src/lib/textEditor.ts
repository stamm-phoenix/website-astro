/**
 * The shared formatting editor (`components/ui/TextEditor.svelte`, #320): the Tiptap extensions
 * for the features a place offers, and the Markdown options that match the minutes.
 *
 * Markdown is the stored format; the editor parses it with the same marked options as
 * `ProtokollText.svelte`, so what the editor shows is what the page shows.
 */
import { Node, mergeAttributes } from '@tiptap/core';
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
import Underline from '@tiptap/extension-underline';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { MARKED_OPTIONS } from '../../../api/lib/protokoll-markdown';
import { BLOG_IMAGE_FILE } from './blog';
import { parseHtml } from './html';

export { normalizeBullets } from '../../../api/lib/protokoll-markdown';

/** Which tools a place offers; bold, italic and plain lists are always there. */
export interface TextEditorFeatures {
  /** Heading levels, e.g. `[1, 2]` for Markdown (`#`, `##`) or `[2, 3]` for HTML. */
  headings?: number[];
  strike?: boolean;
  code?: boolean;
  links?: boolean;
  checklists?: boolean;
  tables?: boolean;
  /** Quotes, code blocks and horizontal rules. */
  blocks?: boolean;
  /** Images of the blog: `<img data-bild="…">` with a preview `src` (HTML only). */
  images?: boolean;
}

/** What the editor reads and writes: Markdown (the minutes) or HTML (the other fields). */
export type TextEditorFormat = 'markdown' | 'html';

/** Preview of a blog image as `getStaffBlogImageUrl` builds it; no other `src` is shown. */
const STAFF_IMAGE_URL =
  /^\/api\/intern\/pflege\/blog\/\d{1,16}\/bilder\/bild-\d{1,16}\.jpg\?w=\d{1,4}$/;

/**
 * An image of a blog post. Stored as `<img data-bild="file">`; the editor shows it with the
 * preview `src` the page adds (`toEditorHtml`), which the sanitizer removes again. Pasted HTML
 * keeps only our own previews, so the editor never loads an image from elsewhere.
 */
const BlogImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      'data-bild': { default: null },
      // Tiptap reads each attribute on its own after `getAttrs`, so the check lives here
      src: {
        default: null,
        parseHTML: (element) => {
          const src = element.getAttribute('src') ?? '';
          return STAFF_IMAGE_URL.test(src) ? src : null;
        },
      },
      alt: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-bild]',
        getAttrs: (element) =>
          BLOG_IMAGE_FILE.test(element.getAttribute('data-bild') ?? '') ? null : false,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

/** Link targets the editor accepts; the same the minutes render (`safeHref`). */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto'];

/** The extensions for the features; `placeholder` is shown while the text is empty. */
export function editorExtensions(
  features: TextEditorFeatures,
  placeholder = '',
  format: TextEditorFormat = 'markdown'
): Extensions {
  const extensions: Extensions = [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    UndoRedo,
  ];
  if (format === 'markdown') extensions.push(Markdown.configure({ markedOptions: MARKED_OPTIONS }));
  // The stored HTML may hold underlines from the previous editor; they survive editing
  if (format === 'html') extensions.push(Underline);
  if (placeholder) extensions.push(Placeholder.configure({ placeholder }));
  if (features.strike) extensions.push(Strike);
  if (features.code) extensions.push(Code);
  if (features.images) extensions.push(BlogImage);
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
        // Neither Markdown nor the stored HTML carry target or rel; the pages add them
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

/**
 * In the browser `@tiptap/markdown` turns HTML in the Markdown into formatting when the schema
 * knows the tags (`<b>x</b>` would become bold). The minutes show such text literally and never
 * render HTML, so the editor keeps it as text too; otherwise opening a text would change it.
 */
interface HtmlParsing {
  parseHTMLToken: (token: { text?: string; raw?: string; block?: boolean }) => unknown;
  htmlAsLiteralText: (html: string, block: boolean) => unknown;
}
const parsing = MarkdownManager.prototype as unknown as HtmlParsing;
parsing.parseHTMLToken = function (this: HtmlParsing, token) {
  const html = token.text || token.raw || '';
  return html.trim() ? this.htmlAsLiteralText(html, !!token.block) : null;
};

/**
 * Tiptap writes `<li><p>eins</p></li>`; the stored HTML of the site has `<li>eins</li>`, as the
 * previous editor wrote it. Unwraps a single paragraph in a list item (nested lists may follow),
 * so saved texts keep their shape and spacing on the pages.
 */
export function unwrapListParagraphs(html: string): string {
  const doc = parseHtml(html);
  for (const item of Array.from(doc.body.querySelectorAll('li'))) {
    const [first, ...rest] = Array.from(item.children);
    if (!first || first.tagName.toLowerCase() !== 'p') continue;
    if (!rest.every((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))) continue;
    first.replaceWith(...Array.from(first.childNodes));
  }
  return doc.body.innerHTML;
}

/** Parses and serializes Markdown like the editor does, without a browser; for tests. */
export function markdownManager(features: TextEditorFeatures): MarkdownManager {
  return new MarkdownManager({
    extensions: editorExtensions(features, '', 'markdown'),
    markedOptions: MARKED_OPTIONS,
  });
}
