/** The nodes of the agenda document (#277): item, sub-item, title, text and extras. See `protokollDokument.ts`. */
import { Node, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import {
  MAX_AUFGABEN,
  MAX_OFFENE_AUFGABEN,
  MAX_TERMINE,
} from '../../../api/lib/protokoll-editor-inhalt';
import {
  leseAktion,
  leseAufgabe,
  leseListe,
  leseOffeneAufgabe,
  leseProjekt,
  leseTermin,
  leseZeitraum,
} from './protokollDokumentLesen';
import type {
  OffeneAufgabe,
  ProtokollAktion,
  ProtokollAufgabe,
  ProtokollProjekt,
  ProtokollZeitraum,
  PunktTermin,
} from '../../../api/lib/protokoll-editor-model';

/** Transactions that change the agenda itself (this module, the component); the guard lets them through. */
export const PUNKTE_META = 'protokoll-punkte';

export const PLACEHOLDER_TITEL = 'Titel des Tagesordnungspunkts';
export const PLACEHOLDER_TEXT = 'Was besprochen wurde … Mit @ erwähnst du jemanden.';

/**
 * An attribute that holds data, not text. It is not rendered in the document (the views show it)
 * but written into the HTML of the clipboard as JSON, so a copied item keeps it. `lese` reads
 * the value back and keeps only what fits the model; anything else becomes the default.
 */
export function jsonAttribute<T>(
  name: string,
  fallback: T,
  lese: (value: unknown) => T,
  /** The attribute in the node, if it is not the name without `data-`. */
  key = name.slice('data-'.length)
): Record<string, unknown> {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement): T => {
      try {
        return lese(JSON.parse(element.getAttribute(name) ?? 'null'));
      } catch {
        return fallback;
      }
    },
    renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
      const value = attributes[key];
      const empty = Array.isArray(value) ? value.length === 0 : value === null;
      return empty ? {} : { [name]: JSON.stringify(value) };
    },
  };
}

/** The title of an item; it also carries the Aktion, so its row can show it. */
export const PunktTitel = Node.create({
  name: 'punktTitel',
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  selectable: false,
  addAttributes() {
    return { aktion: jsonAttribute<ProtokollAktion | null>('data-aktion', null, leseAktion) };
  },
  parseHTML() {
    return [{ tag: 'div[data-punkt-titel]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-punkt-titel': '', class: 'punkt-titel' }),
      0,
    ];
  },
});

/** The text of an item: everything the Markdown of the minutes offers. */
export const PunktText = Node.create({
  name: 'punktText',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-punkt-text]' }];
  },
  renderHTML() {
    return ['div', { 'data-punkt-text': '', class: 'punkt-text' }, 0];
  },
});

/**
 * The tasks and dates of an item, its project and the open tasks shown in it, edited in their
 * own fields below the text.
 */
export const PunktExtras = Node.create({
  name: 'punktExtras',
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      aufgaben: jsonAttribute<ProtokollAufgabe[]>('data-aufgaben', [], (value) =>
        leseListe(value, leseAufgabe, MAX_AUFGABEN)
      ),
      termine: jsonAttribute<PunktTermin[]>('data-termine', [], (value) =>
        leseListe(value, leseTermin, MAX_TERMINE)
      ),
      projekt: jsonAttribute<ProtokollProjekt | null>('data-projekt', null, leseProjekt),
      offeneAufgaben: jsonAttribute<OffeneAufgabe[]>(
        'data-offene-aufgaben',
        [],
        (value) => leseListe(value, leseOffeneAufgabe, MAX_OFFENE_AUFGABEN),
        'offeneAufgaben'
      ),
      zeitraum: jsonAttribute<ProtokollZeitraum | null>('data-zeitraum', null, leseZeitraum),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-punkt-extras]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-punkt-extras': '', class: 'punkt-extras' }),
    ];
  },
});

export const Unterpunkt = Node.create({
  name: 'unterpunkt',
  content: 'punktTitel punktText punktExtras',
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { id: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'section[data-unterpunkt]' }];
  },
  renderHTML() {
    return ['section', { 'data-unterpunkt': '', class: 'unterpunkt' }, 0];
  },
});

export const Punkt = Node.create({
  name: 'punkt',
  content: 'punktTitel punktText punktExtras unterpunkt*',
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { id: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'section[data-punkt-block]' }];
  },
  renderHTML() {
    return ['section', { 'data-punkt-block': '', class: 'punkt' }, 0];
  },
});

export const Dokument = Document.extend({ content: 'punkt+' });
