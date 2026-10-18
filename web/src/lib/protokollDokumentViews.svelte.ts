/**
 * How the agenda nodes of `protokollDokument.ts` look in the editor: an item as a section with
 * handle, number, title row, Aktion and tools, its tasks and dates as the Svelte component
 * below the text. The views register with `DokumentViews`, so the component can refresh the
 * numbers and names after every change.
 */
import { mount, unmount } from 'svelte';
import type { Editor, NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import ProtokollPunktExtras from '../components/protokolle/ProtokollPunktExtras.svelte';
import { punktNummern, setAktion } from './protokollDokument';
import { aktionZeitraum } from './protokollEditor';
import type { Griff } from './protokollReihenfolge';
import type { PersonOption, ProtokollAktion, ProtokollAufgabe, PunktTermin } from './types';

export interface DokumentHooks {
  /** The handle to drag an item (`ProtokollTagesordnung`); without it there is no handle. */
  griff?: Griff;
  personen: PersonOption[];
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onAddUnterpunkt: (id: string) => void;
}

interface Synced {
  sync(): void;
}

/** The views of one editor and what they need from the page. */
export class DokumentViews {
  hooks: DokumentHooks;
  // Plain collections: nothing renders from them, the views read them when asked to sync
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  nummern = new Map<string, string>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly views = new Set<Synced>();

  constructor(hooks: DokumentHooks) {
    this.hooks = hooks;
  }

  /** A new view syncs with the others after the transaction; while it is built, positions are new but the state is old. */
  add(view: Synced): void {
    this.views.add(view);
  }

  remove(view: Synced): void {
    this.views.delete(view);
  }

  /** Renews numbers, labels and names after the document or the people changed. */
  sync(doc: PMNode): void {
    this.nummern = punktNummern(doc);
    for (const view of this.views) view.sync();
  }
}

interface Parent {
  node: PMNode;
  /** Index among all children of the container (sub-items start at 3). */
  index: number;
  container: PMNode;
}

/** The item or sub-item a child node view belongs to, by its current position. */
function parentOf(editor: Editor, getPos: () => number | undefined): Parent | null {
  const pos = getPos();
  if (pos === undefined || editor.isDestroyed) return null;
  try {
    const resolved = editor.state.doc.resolve(pos);
    return {
      node: resolved.parent,
      index: resolved.index(resolved.depth - 1),
      container: resolved.node(resolved.depth - 1),
    };
  } catch {
    // The view is being built for a document the editor does not hold yet
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attributes: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function svg(paths: string, fill = false): SVGSVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('viewBox', '0 0 24 24');
  if (fill) element.setAttribute('fill', 'currentColor');
  else {
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '2');
  }
  element.innerHTML = paths;
  return element;
}

const GRIFF_DOTS = [6, 12, 18]
  .flatMap((y) => [9, 15].map((x) => `<circle cx="${x}" cy="${y}" r="1.6" />`))
  .join('');

/** The section of an item or sub-item; the editor renders the children into it. */
export function punktView(): NodeViewRenderer {
  return ({ node: first }) => {
    let node = first;
    const dom = el('section', node.type.name === 'punkt' ? 'punkt' : 'unterpunkt');
    dom.dataset.punkt = node.attrs.id;
    return {
      dom,
      contentDOM: dom,
      update(next: PMNode) {
        if (next.type !== node.type) return false;
        node = next;
        dom.dataset.punkt = next.attrs.id;
        return true;
      },
      // Numbers and labels are set on the section from outside; the editor needs not react
      ignoreMutation: (mutation: ViewMutationRecord) =>
        mutation.type === 'attributes' && mutation.target === dom,
    };
  };
}

/** The text of an item; its own view, so its ID can be set without the editor redrawing it. */
export function textView(views: DokumentViews): NodeViewRenderer {
  return ({ node: first, editor, getPos }) => {
    let node = first;
    const dom = el('div', 'punkt-text');
    const synced: Synced = {
      sync() {
        const parent = parentOf(editor, getPos);
        if (parent) dom.id = `text-${parent.node.attrs.id}`;
      },
    };
    views.add(synced);
    return {
      dom,
      contentDOM: dom,
      update(next: PMNode) {
        if (next.type !== node.type) return false;
        node = next;
        return true;
      },
      ignoreMutation: (mutation: ViewMutationRecord) =>
        mutation.type === 'attributes' && mutation.target === dom,
      destroy() {
        views.remove(synced);
      },
    };
  };
}

/**
 * The title row of an item: handle, number, the editable title, the buttons to move and delete
 * it, and the Aktion it came from.
 */
export function titelView(views: DokumentViews): NodeViewRenderer {
  return ({ node: first, editor, getPos }) => {
    let node = first;
    // Only the title is written; the parts around it are plain, so their buttons take the focus
    const dom = el('div', 'punkt-kopf');
    const nummer = el('span', 'nummer', { 'aria-hidden': 'true', contenteditable: 'false' });
    const heading = el('div', 'punkt-titel', { role: 'heading', 'aria-level': '3' });
    const tools = el('div', 'werkzeuge', { role: 'group', contenteditable: 'false' });
    const up = el('button', 'icon-button', { type: 'button' });
    up.append(svg('<path d="M12 19V5M5 12l7-7 7 7" />'));
    const down = el('button', 'icon-button', { type: 'button' });
    down.append(svg('<path d="M12 5v14M19 12l-7 7-7-7" />'));
    const remove = el('button', 'icon-button', { type: 'button' });
    remove.append(svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />'));
    tools.append(up, down, remove);
    const aktionZeile = el('p', 'aktion-zeile', { contenteditable: 'false', hidden: '' });
    const aktionText = el('span');
    const loesen = el('button', 'text-link text-sm', { type: 'button' });
    loesen.textContent = 'Verknüpfung lösen';
    aktionZeile.append(aktionText, loesen);

    const griff = views.hooks.griff
      ? el('button', 'griff icon-button', { type: 'button', contenteditable: 'false' })
      : null;
    if (griff) {
      griff.title = 'Ziehen zum Verschieben';
      griff.append(svg(GRIFF_DOTS, true));
    }

    const id = (): string | null => parentOf(editor, getPos)?.node.attrs.id ?? null;

    griff?.addEventListener('pointerdown', (event) => {
      const punktId = id();
      if (punktId) views.hooks.griff?.down(event, punktId);
    });
    griff?.addEventListener('keydown', (event) => {
      const punktId = id();
      if (punktId) views.hooks.griff?.key(event, punktId);
    });
    up.addEventListener('click', () => {
      const punktId = id();
      if (punktId) views.hooks.onMove(punktId, -1);
    });
    down.addEventListener('click', () => {
      const punktId = id();
      if (punktId) views.hooks.onMove(punktId, 1);
    });
    remove.addEventListener('click', () => {
      const punktId = id();
      if (punktId) views.hooks.onRemove(punktId);
    });
    loesen.addEventListener('click', () => {
      const punktId = id();
      if (punktId) setAktion(editor, punktId, null);
    });
    // Buttons never take the selection of the editor with them
    for (const button of [griff, up, down, remove, loesen]) {
      button?.addEventListener('mousedown', (event) => event.preventDefault());
    }

    if (griff) dom.append(griff);
    dom.append(nummer, heading, tools, aktionZeile);

    function renderAktion(): void {
      const aktion = node.attrs.aktion as ProtokollAktion | null;
      aktionZeile.hidden = !aktion;
      if (!aktion) {
        aktionText.textContent = '';
        return;
      }
      const zeitraum = aktionZeitraum(aktion);
      aktionText.textContent = `Aktion${zeitraum ? `, ${zeitraum}` : ''}`;
      loesen.setAttribute('aria-label', `Verknüpfung mit der Aktion ${aktion.titel} lösen`);
    }
    renderAktion();

    const synced: Synced = {
      sync() {
        const parent = parentOf(editor, getPos);
        if (!parent) return;
        const punktId = parent.node.attrs.id as string;
        const sub = parent.node.type.name === 'unterpunkt';
        const number = views.nummern.get(punktId) ?? '';
        const titel = heading.textContent?.trim() || 'Tagesordnungspunkt';
        const label = `${number} ${titel}`;
        dom.dataset.punktKopf = punktId;
        nummer.textContent = number;
        heading.setAttribute('aria-level', sub ? '4' : '3');
        heading.id = `titel-${punktId}`;
        const section = dom.parentElement;
        if (section) section.setAttribute('aria-label', label);
        if (griff) {
          griff.id = `griff-${punktId}`;
          griff.setAttribute(
            'aria-label',
            `${label} verschieben. Ziehen oder Pfeiltasten: hoch und runter verschieben, rechts macht ihn zum Unterpunkt, links zum Hauptpunkt.`
          );
        }
        tools.setAttribute('aria-label', `Punkt ${number} verschieben oder löschen`);
        const position = sub ? parent.index - 3 : parent.index;
        const count = sub ? parent.container.childCount - 3 : parent.container.childCount;
        up.disabled = position === 0;
        down.disabled = position === count - 1;
        up.setAttribute('aria-label', `Punkt ${number} nach oben`);
        down.setAttribute('aria-label', `Punkt ${number} nach unten`);
        remove.setAttribute('aria-label', `Punkt ${number} löschen`);
      },
    };
    views.add(synced);

    return {
      dom,
      contentDOM: heading,
      update(next: PMNode) {
        if (next.type !== node.type) return false;
        node = next;
        renderAktion();
        return true;
      },
      stopEvent: (event: Event) => !heading.contains(event.target as Node),
      ignoreMutation: (mutation: ViewMutationRecord) =>
        mutation.type !== 'selection' &&
        (!heading.contains(mutation.target) || mutation.type === 'attributes'),
      destroy() {
        views.remove(synced);
      },
    };
  };
}

interface ExtrasProps {
  aufgaben: ProtokollAufgabe[];
  termine: PunktTermin[];
  nummer: string;
  personen: PersonOption[];
  isSub: boolean;
  unterpunkte: number;
  onAddUnterpunkt: () => void;
}

function extrasKey(attrs: { aufgaben: unknown; termine: unknown }): string {
  return JSON.stringify([attrs.aufgaben, attrs.termine]);
}

/** The tasks and dates of an item as the Svelte component, writing into the node's attributes. */
export function extrasView(views: DokumentViews): NodeViewRenderer {
  return ({ node: first, editor, getPos }) => {
    let node = first;
    const dom = el('div', 'punkt-extras');
    dom.contentEditable = 'false';
    const props: ExtrasProps = $state({
      aufgaben: structuredClone(node.attrs.aufgaben as ProtokollAufgabe[]),
      termine: structuredClone(node.attrs.termine as PunktTermin[]),
      nummer: '',
      personen: views.hooks.personen,
      isSub: false,
      unterpunkte: 0,
      onAddUnterpunkt: () => {
        const punktId = parentOf(editor, getPos)?.node.attrs.id as string | undefined;
        if (punktId) views.hooks.onAddUnterpunkt(punktId);
      },
    });
    /** What the node holds; the component's changes are written back only when they differ. */
    let known = extrasKey(node.attrs as { aufgaben: unknown; termine: unknown });
    const instance = mount(ProtokollPunktExtras, { target: dom, props });
    const stop = $effect.root(() => {
      $effect(() => {
        const next = {
          aufgaben: $state.snapshot(props.aufgaben),
          termine: $state.snapshot(props.termine),
        };
        const key = extrasKey(next);
        if (key === known) return;
        known = key;
        const pos = getPos();
        if (pos === undefined || editor.isDestroyed) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
      });
    });

    const synced: Synced = {
      sync() {
        const parent = parentOf(editor, getPos);
        if (!parent) return;
        props.nummer = views.nummern.get(parent.node.attrs.id) ?? '';
        props.isSub = parent.node.type.name === 'unterpunkt';
        props.unterpunkte = parent.node.childCount - 3;
        props.personen = views.hooks.personen;
      },
    };
    views.add(synced);

    return {
      dom,
      update(next: PMNode) {
        if (next.type !== node.type) return false;
        node = next;
        const key = extrasKey(next.attrs as { aufgaben: unknown; termine: unknown });
        if (key !== known) {
          known = key;
          props.aufgaben = structuredClone(next.attrs.aufgaben as ProtokollAufgabe[]);
          props.termine = structuredClone(next.attrs.termine as PunktTermin[]);
        }
        return true;
      },
      // Everything inside is the component's: the editor neither handles its events nor
      // reads its changes
      stopEvent: () => true,
      ignoreMutation: () => true,
      destroy() {
        views.remove(synced);
        stop();
        void unmount(instance);
      },
    };
  };
}
