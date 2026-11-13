/** Guard and keys of the agenda document: what the editor refuses and how it moves. See `protokollDokument.ts`. */
import { PUNKTE_META } from './protokollDokumentNodes';
import { punktAt, punktMarkup, countPunkte } from './protokollDokumentPositionen';
import { leererPunktNode } from './protokollDokumentUmwandlung';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { MAX_PUNKTE, MAX_TITEL, MAX_UNTERPUNKTE } from '../../../api/lib/protokoll-editor-inhalt';
import { newElementId } from './protokollEditor';
import { isRecord } from './protokollDokumentLesen';

// --- Guard ---

/**
 * Whether an item has nothing but its title; one from an Aktion or with a project keeps its
 * link and is not empty.
 */
export function punktLeer(node: PMNode): boolean {
  const text = node.child(1);
  const extras = node.child(2);
  const textEmpty =
    text.childCount === 1 && text.firstChild?.type.name === 'paragraph' && !text.textContent;
  return (
    textEmpty &&
    node.child(0).attrs.aktion === null &&
    (extras.attrs.aufgaben as unknown[]).length === 0 &&
    (extras.attrs.termine as unknown[]).length === 0 &&
    extras.attrs.projekt === null &&
    extras.attrs.zeitraum === null &&
    (extras.attrs.offeneAufgaben as unknown[]).length === 0 &&
    node.childCount === 3
  );
}

export const guardKey = new PluginKey('protokoll-dokument');

/**
 * Keeps the agenda whole while typing: no item disappears with a selection (the delete button
 * asks first), the limits of the minutes hold, a title stays within its length, and every item
 * keeps its own ID, also after a copy and paste.
 */
export const Guard = Extension.create({
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
          const fixes: { pos: number; attrs: Record<string, unknown> }[] = [];
          /** A fresh ID where one is missing or already taken, else the own one. */
          const unique = (id: unknown): string => {
            const own = typeof id === 'string' && id && !seen.has(id) ? id : newElementId();
            seen.add(own);
            return own;
          };
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'punkt' || node.type.name === 'unterpunkt') {
              const id = unique(node.attrs.id);
              if (id !== node.attrs.id) fixes.push({ pos, attrs: { ...node.attrs, id } });
              return true;
            }
            if (node.type.name === 'punktExtras') {
              const renew = (list: unknown): { items: { id: string }[]; changed: boolean } => {
                let changed = false;
                const items = (Array.isArray(list) ? list : []).filter(isRecord).map((item) => {
                  const id = unique(item.id);
                  if (id !== item.id) changed = true;
                  return { ...item, id };
                });
                return { items, changed };
              };
              const aufgaben = renew(node.attrs.aufgaben);
              const termine = renew(node.attrs.termine);
              if (aufgaben.changed || termine.changed) {
                fixes.push({
                  pos,
                  attrs: { ...node.attrs, aufgaben: aufgaben.items, termine: termine.items },
                });
              }
            }
            return false;
          });
          if (fixes.length === 0) return null;
          const tr = state.tr.setMeta(PUNKTE_META, true).setMeta('addToHistory', false);
          for (const { pos, attrs } of fixes) tr.setNodeMarkup(pos, undefined, attrs);
          return tr;
        },
      }),
    ];
  },
});

// --- Keys ---

/** Puts the cursor at the start of the text of the item or sub-item at `pos`. */
export function selectText(tr: Transaction, punktPos: number): Transaction {
  const punkt = tr.doc.nodeAt(punktPos);
  if (!punkt) return tr;
  const textStart = punktPos + 1 + punkt.child(0).nodeSize + 1;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(textStart + 1)));
}

/** Puts the cursor at the end of the title of the item or sub-item at `pos`. */
export function selectTitel(tr: Transaction, punktPos: number): Transaction {
  const punkt = tr.doc.nodeAt(punktPos);
  if (!punkt) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, punktPos + 2 + punkt.child(0).content.size));
}

/** Puts the cursor at the end of the text of the item or sub-item at `pos`. */
export function selectTextEnd(tr: Transaction, punktPos: number): Transaction {
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
export const Keys = Extension.create({
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

export function countSubs(doc: PMNode, unterpunktPos: number): number {
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
export function previousPunkt(doc: PMNode, pos: number): number | null {
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
