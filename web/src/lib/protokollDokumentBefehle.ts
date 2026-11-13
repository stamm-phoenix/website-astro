/** Commands on the agenda document (add, remove, move, select). See `protokollDokument.ts`. */
import { PUNKTE_META } from './protokollDokumentNodes';
import { findPunkt, countPunkte } from './protokollDokumentPositionen';
import type { DokumentUmwandlung } from './protokollDokumentUmwandlung';
import { leererPunktNode, rebuildDoc } from './protokollDokumentUmwandlung';
import { selectText, selectTitel } from './protokollDokumentGuard';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { MAX_PUNKTE, MAX_UNTERPUNKTE } from '../../../api/lib/protokoll-editor-inhalt';
import { newElementId } from './protokollEditor';
import type { ProtokollAktion, ProtokollPunkt } from '../../../api/lib/protokoll-editor-model';

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

/** Writes the tasks, dates, project and open tasks of an item or sub-item into its node. */
export function setExtras(
  editor: Editor,
  id: string,
  extras: Pick<ProtokollPunkt, 'aufgaben' | 'termine' | 'projekt' | 'offeneAufgaben' | 'zeitraum'>
): boolean {
  const { state } = editor;
  const found = findPunkt(state.doc, id);
  if (!found) return false;
  const pos = found.pos + 1 + found.node.child(0).nodeSize + found.node.child(1).nodeSize;
  const tr = state.tr.setMeta(PUNKTE_META, true).setNodeMarkup(pos, undefined, {
    aufgaben: structuredClone(extras.aufgaben),
    termine: structuredClone(extras.termine),
    projekt: extras.projekt ? structuredClone(extras.projekt) : null,
    offeneAufgaben: structuredClone(extras.offeneAufgaben),
    zeitraum: extras.zeitraum ? structuredClone(extras.zeitraum) : null,
  });
  editor.view.dispatch(tr);
  return true;
}
