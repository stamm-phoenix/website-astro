/**
 * The agenda of the minutes as one document in the formatting editor (#277): every agenda item
 * is a block with a title, a text and its tasks and dates; sub-items are blocks inside their
 * item. The document is written back into `ProtokollPunkt[]` on every change, so the stored
 * shape, the reading view, the PDF and the live reading stay as they are.
 *
 * Only this module knows the shape of the document; `ProtokollDokument.svelte` shows it.
 */
import { Extension, Node, getSchema } from '@tiptap/core';
import type { Editor, Extensions, NodeViewRenderer } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { MarkdownManager } from '@tiptap/markdown';
import { MAX_PUNKTE, MAX_TITEL, MAX_UNTERPUNKTE } from '../../../api/lib/protokoll-editor-model';
import { PROTOKOLL_TEXT_FEATURES, neuerPunkt, newElementId, punktNummer } from './protokollEditor';
import { editorExtensions, markdownManager, normalizeBullets } from './textEditor';
import type { ProtokollAktion, ProtokollAufgabe, ProtokollPunkt, PunktTermin } from './types';

/** Transactions that change the agenda itself (this module, the component); the guard lets them through. */
export const PUNKTE_META = 'protokoll-punkte';

export const PLACEHOLDER_TITEL = 'Titel des Tagesordnungspunkts';
export const PLACEHOLDER_TEXT = 'Was besprochen wurde …';

/** The title of an item; it also carries the Aktion, so its row can show it. */
const PunktTitel = Node.create({
  name: 'punktTitel',
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  selectable: false,
  addAttributes() {
    return { aktion: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-punkt-titel]' }];
  },
  renderHTML() {
    return ['div', { 'data-punkt-titel': '', class: 'punkt-titel' }, 0];
  },
});

/** The text of an item: everything the Markdown of the minutes offers. */
const PunktText = Node.create({
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

/** The tasks and dates of an item, edited in their own fields below the text. */
const PunktExtras = Node.create({
  name: 'punktExtras',
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      aufgaben: { default: [], rendered: false },
      termine: { default: [], rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-punkt-extras]' }];
  },
  renderHTML() {
    return ['div', { 'data-punkt-extras': '', class: 'punkt-extras' }];
  },
});

const Unterpunkt = Node.create({
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

const Punkt = Node.create({
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

const Dokument = Document.extend({ content: 'punkt+' });

// --- Positions ---

/** The item or sub-item around `$pos`, with the depth of its node, or `null` outside. */
export function punktAt($pos: ResolvedPos): { node: PMNode; depth: number; pos: number } | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'punkt' || node.type.name === 'unterpunkt') {
      return { node, depth, pos: $pos.before(depth) };
    }
  }
  return null;
}

/** ID of the item written at the selection, for readers following along. */
export function activePunktId(state: EditorState): string | null {
  return punktAt(state.selection.$from)?.node.attrs.id ?? null;
}

interface Found {
  node: PMNode;
  pos: number;
  /** The item of a sub-item, or the item itself. */
  parent: PMNode | null;
  parentPos: number;
}

/** The item or sub-item with `id`, searched through the whole document. */
export function findPunkt(doc: PMNode, id: string): Found | null {
  let found: Found | null = null;
  doc.forEach((punkt, offset) => {
    if (found) return;
    if (punkt.attrs.id === id) {
      found = { node: punkt, pos: offset, parent: null, parentPos: -1 };
      return;
    }
    punkt.forEach((child, childOffset) => {
      if (!found && child.type.name === 'unterpunkt' && child.attrs.id === id) {
        found = { node: child, pos: offset + 1 + childOffset, parent: punkt, parentPos: offset };
      }
    });
  });
  return found;
}

/** The number of every item and sub-item („1.“, „1a.“), in document order. */
export function punktNummern(doc: PMNode): Map<string, string> {
  const nummern = new Map<string, string>();
  doc.forEach((punkt, _offset, index) => {
    nummern.set(punkt.attrs.id, punktNummer(index));
    let subIndex = 0;
    punkt.forEach((child) => {
      if (child.type.name === 'unterpunkt') {
        nummern.set(child.attrs.id, punktNummer(index, subIndex++));
      }
    });
  });
  return nummern;
}

/** The title and extras nodes of every item and sub-item by ID; they carry the Aktion, tasks and dates. */
function punktMarkup(doc: PMNode): Map<string, { titel: PMNode; extras: PMNode }> {
  const items = new Map<string, { titel: PMNode; extras: PMNode }>();
  const add = (node: PMNode): void => {
    items.set(node.attrs.id as string, { titel: node.child(0), extras: node.child(2) });
  };
  doc.forEach((punkt) => {
    add(punkt);
    punkt.forEach((child) => {
      if (child.type.name === 'unterpunkt') add(child);
    });
  });
  return items;
}

function countPunkte(doc: PMNode): { punkte: number; unterpunkte: number; maxSub: number } {
  let punkte = 0;
  let unterpunkte = 0;
  let maxSub = 0;
  doc.forEach((punkt) => {
    punkte++;
    let sub = 0;
    punkt.forEach((child) => {
      if (child.type.name === 'unterpunkt') sub++;
    });
    unterpunkte += sub;
    maxSub = Math.max(maxSub, sub);
  });
  return { punkte, unterpunkte, maxSub };
}

// --- Conversion ---

/** An item or sub-item without content, built without reading Markdown. */
export function leererPunktNode(schema: Schema, id: string, sub: boolean): PMNode {
  const children = [
    schema.nodes.punktTitel.create({ aktion: null }),
    schema.nodes.punktText.create(null, schema.nodes.paragraph.create()),
    schema.nodes.punktExtras.create({ aufgaben: [], termine: [] }),
  ];
  return schema.nodes[sub ? 'unterpunkt' : 'punkt'].create({ id }, children);
}

/** The content of an item as one string, to notice a change whatever the order of its keys. */
export function punktKey(punkt: ProtokollPunkt): string {
  return JSON.stringify([
    punkt.id,
    punkt.titel,
    punkt.aktion,
    punkt.text,
    punkt.aufgaben,
    punkt.termine,
    punkt.unterpunkte.map(punktKey),
  ]);
}

export function punkteKey(punkte: ProtokollPunkt[]): string {
  return punkte.map(punktKey).join('\n');
}

/** Converts between the agenda and the document; one per editor. */
export class DokumentUmwandlung {
  readonly schema: Schema;
  private readonly manager: MarkdownManager;
  /** Markdown of text nodes already serialized; nodes are immutable, so the text is too. */
  private readonly texte = new WeakMap<PMNode, string>();

  constructor(schema: Schema, manager: MarkdownManager = markdownManager(PROTOKOLL_TEXT_FEATURES)) {
    this.schema = schema;
    this.manager = manager;
  }

  /** The blocks of a text; a text that cannot be read becomes one paragraph with the text. */
  private textNodes(text: string): PMNode[] {
    const { schema } = this;
    try {
      const json = this.manager.parse(normalizeBullets(text));
      const nodes = (json.content ?? []).map((block) => schema.nodeFromJSON(block));
      if (nodes.length > 0) return nodes;
    } catch {
      if (text.trim()) return [schema.nodes.paragraph.create(null, schema.text(text))];
    }
    return [schema.nodes.paragraph.create()];
  }

  /**
   * The text node of an item. It remembers the stored Markdown, so an item nobody touched is
   * written back exactly as it was, not in the editor's own spelling.
   */
  private textNode(text: string): PMNode {
    const node = this.schema.nodes.punktText.create(null, Fragment.fromArray(this.textNodes(text)));
    this.texte.set(node, text);
    return node;
  }

  private kopf(punkt: ProtokollPunkt): PMNode[] {
    const { schema } = this;
    const titel = punkt.titel.trim();
    return [
      schema.nodes.punktTitel.create(
        { aktion: punkt.aktion ? structuredClone(punkt.aktion) : null },
        titel ? schema.text(titel) : null
      ),
      this.textNode(punkt.text),
      schema.nodes.punktExtras.create({
        aufgaben: structuredClone(punkt.aufgaben),
        termine: structuredClone(punkt.termine),
      }),
    ];
  }

  unterpunktNode(punkt: ProtokollPunkt): PMNode {
    return this.schema.nodes.unterpunkt.create({ id: punkt.id }, this.kopf(punkt));
  }

  punktNode(punkt: ProtokollPunkt): PMNode {
    return this.schema.nodes.punkt.create({ id: punkt.id }, [
      ...this.kopf(punkt),
      ...punkt.unterpunkte.map((sub) => this.unterpunktNode(sub)),
    ]);
  }

  /** The whole agenda as a document; an empty agenda gets one empty item. */
  doc(punkte: ProtokollPunkt[]): PMNode {
    const items = punkte.length > 0 ? punkte : [neuerPunkt(newElementId())];
    return this.schema.topNodeType.create(
      null,
      items.map((punkt) => this.punktNode(punkt))
    );
  }

  private text(node: PMNode): string {
    const known = this.texte.get(node);
    if (known !== undefined) return known;
    const content = node.toJSON().content ?? [];
    const text = this.manager.serialize({ type: 'doc', content });
    this.texte.set(node, text);
    return text;
  }

  /** An item or sub-item as stored; the arrays are copies, so the editor keeps its own. */
  punkt(node: PMNode): ProtokollPunkt {
    const titel = node.child(0);
    const extras = node.child(2);
    const unterpunkte: ProtokollPunkt[] = [];
    node.forEach((child) => {
      if (child.type.name === 'unterpunkt') unterpunkte.push(this.punkt(child));
    });
    return {
      id: node.attrs.id,
      titel: titel.textContent,
      aktion: titel.attrs.aktion ? structuredClone(titel.attrs.aktion as ProtokollAktion) : null,
      text: this.text(node.child(1)),
      aufgaben: structuredClone(extras.attrs.aufgaben as ProtokollAufgabe[]),
      termine: structuredClone(extras.attrs.termine as PunktTermin[]),
      unterpunkte,
    };
  }

  punkte(doc: PMNode): ProtokollPunkt[] {
    const punkte: ProtokollPunkt[] = [];
    doc.forEach((node) => punkte.push(this.punkt(node)));
    return punkte;
  }
}

/**
 * The document for `punkte`, reusing the nodes of `current` whose item did not change, so the
 * editor keeps their views and the undo history stays small. Used when the agenda changes
 * outside the editor: an item added or moved, a version restored.
 */
export function rebuildDoc(
  umwandlung: DokumentUmwandlung,
  current: PMNode,
  punkte: ProtokollPunkt[]
): PMNode {
  const known = new Map<string, { node: PMNode; json: string }>();
  current.forEach((punkt) => {
    known.set(punkt.attrs.id, { node: punkt, json: punktKey(umwandlung.punkt(punkt)) });
    punkt.forEach((child) => {
      if (child.type.name === 'unterpunkt') {
        known.set(child.attrs.id, { node: child, json: punktKey(umwandlung.punkt(child)) });
      }
    });
  });
  const reuse = (punkt: ProtokollPunkt, sub: boolean): PMNode => {
    const old = known.get(punkt.id);
    const type = sub ? 'unterpunkt' : 'punkt';
    if (old && old.node.type.name === type && old.json === punktKey(punkt)) return old.node;
    if (sub) return umwandlung.unterpunktNode(punkt);
    // An item whose sub-items moved keeps its own content nodes
    const base = umwandlung.punktNode({ ...punkt, unterpunkte: [] });
    const children: PMNode[] = [];
    base.forEach((child) => children.push(child));
    return umwandlung.schema.nodes.punkt.create({ id: punkt.id }, [
      ...children,
      ...punkt.unterpunkte.map((child) => reuse(child, true)),
    ]);
  };
  const items = punkte.length > 0 ? punkte : [neuerPunkt(newElementId())];
  return umwandlung.schema.topNodeType.create(
    null,
    items.map((punkt) => reuse(punkt, false))
  );
}

// --- Guard ---

/** Whether an item has nothing but its title. */
export function punktLeer(node: PMNode): boolean {
  const text = node.child(1);
  const extras = node.child(2);
  const textEmpty =
    text.childCount === 1 && text.firstChild?.type.name === 'paragraph' && !text.textContent;
  return (
    textEmpty &&
    (extras.attrs.aufgaben as unknown[]).length === 0 &&
    (extras.attrs.termine as unknown[]).length === 0 &&
    node.childCount === 3
  );
}

const guardKey = new PluginKey('protokoll-dokument');

/**
 * Keeps the agenda whole while typing: no item disappears with a selection (the delete button
 * asks first), the limits of the minutes hold, a title stays within its length, and every item
 * keeps its own ID, also after a copy and paste.
 */
const Guard = Extension.create({
  name: 'protokollDokumentGuard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: guardKey,
        filterTransaction(tr, state) {
          // Undo and redo replay changes that were allowed when they were made
          if (!tr.docChanged || tr.getMeta(PUNKTE_META) || tr.getMeta('history$')) return true;
          // Every item stays, with its Aktion and its tasks and dates: a selection that takes an
          // item with it, or what the schema puts back in its place, is refused
          const kept = punktMarkup(tr.doc);
          for (const [id, old] of punktMarkup(state.doc)) {
            const next = kept.get(id);
            if (!next || !next.titel.sameMarkup(old.titel) || !next.extras.sameMarkup(old.extras)) {
              return false;
            }
          }
          const after = countPunkte(tr.doc);
          if (after.punkte > MAX_PUNKTE || after.maxSub > MAX_UNTERPUNKTE) return false;
          let tooLong = false;
          tr.doc.descendants((node) => {
            if (tooLong) return false;
            if (
              node.type.name === 'punktTitel' &&
              (node.textContent.length > MAX_TITEL || node.textContent.includes('\n'))
            ) {
              tooLong = true;
            }
            return node.type.name !== 'punktText';
          });
          return !tooLong;
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          const fixes: { pos: number; node: PMNode }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'punkt' && node.type.name !== 'unterpunkt') {
              return node.type.name === 'punkt';
            }
            const id = node.attrs.id as string;
            if (!id || seen.has(id)) fixes.push({ pos, node });
            else seen.add(id);
            return node.type.name === 'punkt';
          });
          if (fixes.length === 0) return null;
          const tr = state.tr.setMeta(PUNKTE_META, true).setMeta('addToHistory', false);
          for (const { pos, node } of fixes) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newElementId() });
          }
          return tr;
        },
      }),
    ];
  },
});

// --- Keys ---

/** Puts the cursor at the start of the text of the item or sub-item at `pos`. */
function selectText(tr: Transaction, punktPos: number): Transaction {
  const punkt = tr.doc.nodeAt(punktPos);
  if (!punkt) return tr;
  const textStart = punktPos + 1 + punkt.child(0).nodeSize + 1;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(textStart + 1)));
}

/** Puts the cursor at the end of the title of the item or sub-item at `pos`. */
function selectTitel(tr: Transaction, punktPos: number): Transaction {
  const punkt = tr.doc.nodeAt(punktPos);
  if (!punkt) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, punktPos + 2 + punkt.child(0).content.size));
}

/** Puts the cursor at the end of the text of the item or sub-item at `pos`. */
function selectTextEnd(tr: Transaction, punktPos: number): Transaction {
  const punkt = tr.doc.nodeAt(punktPos);
  if (!punkt) return tr;
  const textEnd = punktPos + 1 + punkt.child(0).nodeSize + punkt.child(1).nodeSize - 1;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(textEnd), -1));
}

/**
 * Enter and Backspace at the edges of an item, as in a document: Enter in the title goes to the
 * text, Enter in an empty last paragraph starts the next item, Backspace in an empty item
 * removes it, Backspace at the start of the text goes back to the title.
 */
const Keys = Extension.create({
  name: 'protokollDokumentKeys',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        const found = punktAt($from);
        if (!found) return false;
        if ($from.parent.type.name === 'punktTitel') {
          editor.view.dispatch(selectText(state.tr, found.pos).scrollIntoView());
          return true;
        }
        // An empty paragraph at the end of the text, directly in it (not in a list or table)
        const parent = $from.parent;
        const container = $from.node($from.depth - 1);
        if (
          parent.type.name !== 'paragraph' ||
          parent.content.size > 0 ||
          container.type.name !== 'punktText' ||
          $from.index($from.depth - 1) !== container.childCount - 1
        ) {
          return false;
        }
        const sub = found.node.type.name === 'unterpunkt';
        const counts = countPunkte(state.doc);
        if (
          sub ? countSubs(state.doc, found.pos) >= MAX_UNTERPUNKTE : counts.punkte >= MAX_PUNKTE
        ) {
          return false;
        }
        const node = leererPunktNode(state.schema, newElementId(), sub);
        const after = found.pos + found.node.nodeSize;
        let tr = state.tr.setMeta(PUNKTE_META, true);
        tr = tr.insert(after, node);
        // The empty paragraph goes if the text keeps another block
        if (container.childCount > 1) {
          tr = tr.delete($from.before(), $from.after());
        }
        const insertedAt = tr.mapping.map(after, -1);
        tr = selectTitel(tr, insertedAt).scrollIntoView();
        editor.view.dispatch(tr);
        return true;
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        const found = punktAt($from);
        if (!found) return false;
        if ($from.parent.type.name === 'punktTitel') {
          if (!punktLeer(found.node) || found.node.textContent) return true;
          const previous = previousPunkt(state.doc, found.pos);
          if (previous === null) return true;
          const tr = state.tr.setMeta(PUNKTE_META, true);
          tr.delete(found.pos, found.pos + found.node.nodeSize);
          editor.view.dispatch(selectTextEnd(tr, previous).scrollIntoView());
          return true;
        }
        // At the very start of the text, whatever the block the cursor sits in: the title is
        // next, never the item before (the browser would otherwise join the two)
        const textStart = found.pos + 1 + found.node.child(0).nodeSize + 1;
        if ($from.pos <= textStart + 1 && $from.pos >= textStart) {
          editor.view.dispatch(selectTitel(state.tr, found.pos).scrollIntoView());
          return true;
        }
        return false;
      },
    };
  },
});

function countSubs(doc: PMNode, unterpunktPos: number): number {
  const $pos = doc.resolve(unterpunktPos);
  const parent = $pos.parent;
  let subs = 0;
  parent.forEach((child) => {
    if (child.type.name === 'unterpunkt') subs++;
  });
  return subs;
}

/**
 * Position of the item or sub-item written before the one at `pos`: the sub-item above, the
 * item of the first sub-item, or the last sub-item (or the item itself) of the item above.
 */
function previousPunkt(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  const index = $pos.index();
  if ($pos.parent.type.name === 'punkt') {
    return index > 3 ? $pos.posAtIndex(index - 1) : $pos.before();
  }
  if (index === 0) return null;
  const before = doc.child(index - 1);
  const beforePos = $pos.posAtIndex(index - 1);
  let last = beforePos;
  before.forEach((child, offset) => {
    if (child.type.name === 'unterpunkt') last = beforePos + 1 + offset;
  });
  return last;
}

// --- Commands ---

/** Appends an item at the end of the agenda. */
export function appendPunkt(
  editor: Editor,
  umwandlung: DokumentUmwandlung,
  punkt: ProtokollPunkt
): boolean {
  const { state } = editor;
  if (countPunkte(state.doc).punkte >= MAX_PUNKTE) return false;
  const tr = state.tr.setMeta(PUNKTE_META, true);
  tr.insert(state.doc.content.size, umwandlung.punktNode(punkt));
  editor.view.dispatch(tr);
  return true;
}

/** Appends a sub-item to the item `parentId`. */
export function appendUnterpunkt(
  editor: Editor,
  umwandlung: DokumentUmwandlung,
  parentId: string,
  punkt: ProtokollPunkt
): boolean {
  const { state } = editor;
  const parent = findPunkt(state.doc, parentId);
  if (!parent || parent.node.type.name !== 'punkt') return false;
  if (parent.node.childCount - 3 >= MAX_UNTERPUNKTE) return false;
  const tr = state.tr.setMeta(PUNKTE_META, true);
  tr.insert(parent.pos + parent.node.nodeSize - 1, umwandlung.unterpunktNode(punkt));
  editor.view.dispatch(tr);
  return true;
}

/**
 * Removes an item or sub-item. The agenda always has one item, so the last one is replaced by
 * an empty one: its content goes, the place to write stays.
 */
export function removePunkt(editor: Editor, id: string): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const tr = state.tr.setMeta(PUNKTE_META, true);
  if (found.node.type.name === 'punkt' && state.doc.childCount === 1) {
    tr.replaceWith(
      found.pos,
      found.pos + found.node.nodeSize,
      leererPunktNode(state.schema, newElementId(), false)
    );
    editor.view.dispatch(selectTitel(tr, found.pos).scrollIntoView());
    editor.view.focus();
    return true;
  }
  tr.delete(found.pos, found.pos + found.node.nodeSize);
  editor.view.dispatch(tr);
  return true;
}

/** Moves an item or sub-item one place up or down among its siblings. */
export function movePunkt(editor: Editor, id: string, delta: -1 | 1): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const $pos = state.doc.resolve(found.pos);
  const container = $pos.parent;
  const index = $pos.index();
  const target = index + delta;
  const sibling = target >= 0 && target < container.childCount ? container.child(target) : null;
  if (!sibling || sibling.type !== found.node.type) return false;
  const siblingPos = $pos.posAtIndex(target);
  const tr = state.tr.setMeta(PUNKTE_META, true);
  let newPos: number;
  if (delta < 0) {
    tr.delete(found.pos, found.pos + found.node.nodeSize);
    tr.insert(siblingPos, found.node);
    newPos = siblingPos;
  } else {
    tr.insert(siblingPos + sibling.nodeSize, found.node);
    tr.delete(found.pos, found.pos + found.node.nodeSize);
    newPos = found.pos + sibling.nodeSize;
  }
  // A cursor in the moved item travels with it; the mapping alone would leave it at the gap
  const { from, to } = state.selection;
  if (from >= found.pos && to <= found.pos + found.node.nodeSize) {
    tr.setSelection(
      TextSelection.create(tr.doc, newPos + (from - found.pos), newPos + (to - found.pos))
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Replaces the whole agenda, keeping the nodes of unchanged items. */
export function replacePunkte(
  editor: Editor,
  umwandlung: DokumentUmwandlung,
  punkte: ProtokollPunkt[]
): void {
  const { state } = editor;
  const doc = rebuildDoc(umwandlung, state.doc, punkte);
  const tr = state.tr.setMeta(PUNKTE_META, true);
  tr.replaceWith(0, state.doc.content.size, doc.content);
  editor.view.dispatch(tr);
}

/** Puts the cursor into the title or the text of an item or sub-item. */
export function selectPunkt(editor: Editor, id: string, field: 'titel' | 'text'): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const tr = field === 'titel' ? selectTitel(state.tr, found.pos) : selectText(state.tr, found.pos);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Sets the Aktion of an item, or removes it with `null`. */
export function setAktion(editor: Editor, id: string, aktion: ProtokollAktion | null): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const titel = found.node.child(0);
  const tr = state.tr
    .setMeta(PUNKTE_META, true)
    .setNodeMarkup(found.pos + 1, undefined, { ...titel.attrs, aktion });
  editor.view.dispatch(tr);
  return true;
}

/** Writes the tasks and dates of an item or sub-item into its document node. */
export function setExtras(
  editor: Editor,
  id: string,
  extras: { aufgaben: ProtokollAufgabe[]; termine: PunktTermin[] }
): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const pos = found.pos + 1 + found.node.child(0).nodeSize + found.node.child(1).nodeSize;
  const tr = state.tr.setMeta(PUNKTE_META, true).setNodeMarkup(pos, undefined, {
    aufgaben: structuredClone(extras.aufgaben),
    termine: structuredClone(extras.termine),
  });
  editor.view.dispatch(tr);
  return true;
}

// --- Extensions ---

/** How the editor shows the agenda nodes; without them the plain elements are rendered. */
export interface DokumentNodeViews {
  punkt: NodeViewRenderer;
  titel: NodeViewRenderer;
  text: NodeViewRenderer;
  extras: NodeViewRenderer;
}

/** The extensions of the document editor: the agenda nodes and the text tools of the minutes. */
export function dokumentExtensions(views?: DokumentNodeViews): Extensions {
  const text = editorExtensions(PROTOKOLL_TEXT_FEATURES, '', 'markdown').filter(
    (extension) => extension.name !== 'doc' && extension.name !== 'markdown'
  );
  const nodes = views
    ? [
        Punkt.extend({ addNodeView: () => views.punkt }),
        Unterpunkt.extend({ addNodeView: () => views.punkt }),
        PunktTitel.extend({ addNodeView: () => views.titel }),
        PunktText.extend({ addNodeView: () => views.text }),
        PunktExtras.extend({ addNodeView: () => views.extras }),
      ]
    : [Punkt, Unterpunkt, PunktTitel, PunktText, PunktExtras];
  return [Dokument, ...nodes, ...text, Guard, Keys];
}

/** The schema of the document editor, for the conversion outside an editor (tests). */
export function dokumentSchema(): Schema {
  return getSchema(dokumentExtensions());
}
