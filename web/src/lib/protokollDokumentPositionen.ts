/** Positions and numbers of items in the agenda document. See `protokollDokument.ts`. */
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { punktNummer } from './protokollEditor';

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

export interface Found {
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
export function punktMarkup(doc: PMNode): Map<string, { titel: PMNode; extras: PMNode }> {
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

export function countPunkte(doc: PMNode): { punkte: number; unterpunkte: number; maxSub: number } {
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
