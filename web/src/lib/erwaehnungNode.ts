/**
 * Mentions (#547) in the formatting editor: the node a mention becomes, read from and written as
 * the Markdown of `api/lib/protokoll-markdown.ts`, and the search while an `@` is typed, which
 * `ErwaehnungAuswahl` turns into a list of people.
 */
import { Extension, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ERWAEHNUNG_SCHEMA } from '../../../api/lib/protokoll-markdown';
import { erwaehnungMarkdown, erwaehnungSuche } from './protokollErwaehnung';
import type { ErwaehnungSuche } from './protokollErwaehnung';
import type { PersonOption } from '../../../api/lib/protokoll-editor-model';

/** `[@Name](person:login)`; the name may hold escaped characters. */
const MARKDOWN = new RegExp(
  `^\\[@((?:\\\\.|[^\\[\\]\\\\\\n])+)\\]\\(${ERWAEHNUNG_SCHEMA}([^\\s()<>[\\]\\\\]+)\\)`
);

export const Erwaehnung = Node.create({
  name: 'erwaehnung',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      login: { default: '' },
      name: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-erwaehnung]',
        getAttrs: (element) => ({
          login: element.getAttribute('data-erwaehnung') ?? '',
          name: (element.textContent ?? '').replace(/^@/, ''),
        }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-erwaehnung': node.attrs.login, class: 'erwaehnung' },
      `@${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.name}`;
  },

  markdownTokenizer: {
    name: 'erwaehnung',
    level: 'inline',
    start: (src: string) => src.indexOf('[@'),
    tokenize: (src: string) => {
      const match = MARKDOWN.exec(src);
      if (!match) return undefined;
      return {
        type: 'erwaehnung',
        raw: match[0],
        login: match[2],
        name: match[1].replace(/\\(.)/g, '$1'),
      };
    },
  },

  parseMarkdown: (token) => ({
    type: 'erwaehnung',
    attrs: { login: String(token.login ?? ''), name: String(token.name ?? '') },
  }),

  renderMarkdown: (node) =>
    erwaehnungMarkdown({
      login: String(node.attrs?.login ?? ''),
      name: String(node.attrs?.name ?? ''),
    }),
});

/** What the search tells the page: the search at the cursor and where to show the list. */
export interface ErwaehnungSteuerung {
  setze(suche: ErwaehnungSuche | null, position: { left: number; top: number } | null): void;
  taste(event: KeyboardEvent): boolean;
}

const sucheKey = new PluginKey('erwaehnung-suche');

/** The search before the cursor in its paragraph; `start` is a position in the document. */
function sucheIn(view: EditorView): ErwaehnungSuche | null {
  const { selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  // Only where a mention may stand, e.g. not in the title of an agenda item
  const type = view.state.schema.nodes.erwaehnung;
  const index = $from.index();
  if (!type || !$from.parent.canReplaceWith(index, index, type)) return null;
  if ($from.marks().some((mark) => mark.type.name === 'code' || mark.type.name === 'link')) {
    return null;
  }
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const suche = erwaehnungSuche(before);
  return suche ? { query: suche.query, start: $from.start() + suche.start } : null;
}

/** Tells `steuerung` about every `@` typed and passes it the keys while its list is open. */
export const ErwaehnungSuchePlugin = Extension.create<{ steuerung: ErwaehnungSteuerung | null }>({
  name: 'erwaehnungSuche',

  addOptions() {
    return { steuerung: null };
  },

  addProseMirrorPlugins() {
    const steuerung = this.options.steuerung;
    if (!steuerung) return [];
    const melde = (view: EditorView): void => {
      const suche = sucheIn(view);
      if (!suche) {
        steuerung.setze(null, null);
        return;
      }
      const coords = view.coordsAtPos(suche.start);
      steuerung.setze(suche, { left: coords.left, top: coords.bottom + 4 });
    };
    return [
      new Plugin({
        key: sucheKey,
        view: () => ({
          update: melde,
          destroy: () => steuerung.setze(null, null),
        }),
        props: {
          handleKeyDown: (_view, event) => steuerung.taste(event),
          handleDOMEvents: {
            blur: () => {
              steuerung.setze(null, null);
              return false;
            },
            focus: (view) => {
              melde(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Replaces the `@` and the letters typed after it with the mention and a space. */
export function erwaehnen(editor: Editor, person: PersonOption, suche: ErwaehnungSuche): void {
  const to = editor.state.selection.from;
  editor
    .chain()
    .focus()
    .insertContentAt({ from: suche.start, to }, [
      { type: 'erwaehnung', attrs: { login: person.login.trim(), name: person.name.trim() } },
      { type: 'text', text: ' ' },
    ])
    .run();
}
