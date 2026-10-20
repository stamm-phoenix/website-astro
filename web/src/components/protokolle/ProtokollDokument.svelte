<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Placeholder } from '@tiptap/extensions';
  import { TextSelection } from '@tiptap/pm/state';
  import TextEditorToolbar from '../ui/TextEditorToolbar.svelte';
  import {
    DokumentUmwandlung,
    PLACEHOLDER_TEXT,
    PLACEHOLDER_TITEL,
    PUNKTE_META,
    activePunktId,
    appendUnterpunkt,
    dokumentExtensions,
    movePunkt,
    punkteKey,
    removePunkt,
    replacePunkte,
    selectPunkt,
  } from '../../lib/protokollDokument';
  import {
    DokumentViews,
    extrasView,
    punktView,
    textView,
    titelView,
  } from '../../lib/protokollDokumentViews.svelte';
  import { PROTOKOLL_TEXT_FEATURES, neuerPunkt, newElementId } from '../../lib/protokollEditor';
  import type { Griff } from '../../lib/protokollReihenfolge';
  import type { PersonOption, ProtokollPunkt } from '../../lib/types';

  /**
   * The whole agenda as one document (#277): the items are blocks with title, text, tasks and
   * dates, written back into `punkte` with every change. Changes made to `punkte` outside
   * (an item added, a version restored, a drag) are shown in place.
   */
  interface Props {
    punkte: ProtokollPunkt[];
    personen: PersonOption[];
    /** Asks before an item with content goes; calls `remove` once confirmed. */
    confirmRemove: (punkt: ProtokollPunkt, nummer: string, remove: () => void) => void;
    /** The handle to drag an item to another place (`ProtokollTagesordnung`). */
    griff?: Griff;
    /** The item written at the cursor, for readers following along. */
    onactive?: (id: string | null) => void;
  }
  let { punkte = $bindable(), personen, confirmRemove, griff, onactive }: Props = $props();

  let element = $state<HTMLDivElement | null>(null);
  let editor = $state<Editor | null>(null);
  let toolbar = $state<TextEditorToolbar | null>(null);
  /** Bottom of the bars that stay at the top of the window; the toolbar stays below them. */
  let toolbarTop = $state(0);
  let umwandlung: DokumentUmwandlung | null = null;
  /** The agenda the editor last wrote, so outside changes to `punkte` are told apart. */
  let emitted = punkteKey(punkte);
  /** Length of the stored text of every item, for the warning where it is too long. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let laengen = new Map<string, number>();

  function messen(list: ProtokollPunkt[]): void {
    laengen = new Map();
    for (const punkt of list) {
      laengen.set(punkt.id, punkt.text.length);
      for (const sub of punkt.unterpunkte) laengen.set(sub.id, sub.text.length);
    }
  }
  messen(punkte);

  function findIn(list: ProtokollPunkt[], id: string): ProtokollPunkt | null {
    for (const punkt of list) {
      if (punkt.id === id) return punkt;
      const sub = punkt.unterpunkte.find((s) => s.id === id);
      if (sub) return sub;
    }
    return null;
  }

  const views = new DokumentViews({
    // Read when a view is built or an event fires, so the props are seen as they are then
    get griff() {
      return griff;
    },
    get personen() {
      return personen;
    },
    textLaenge: (id) => laengen.get(id) ?? 0,
    onRemove: (id) => {
      const punkt = findIn($state.snapshot(punkte) as ProtokollPunkt[], id);
      if (!punkt || !editor) return;
      confirmRemove(punkt, views.nummern.get(id) ?? '', () => {
        if (editor) removePunkt(editor, id);
      });
    },
    onMove: (id, delta) => {
      if (editor) movePunkt(editor, id, delta);
    },
    onAddUnterpunkt: (id) => {
      if (!editor || !umwandlung) return;
      const sub = neuerPunkt(newElementId());
      if (appendUnterpunkt(editor, umwandlung, id, sub)) selectPunkt(editor, sub.id, 'titel');
    },
  });

  function editorProps(): NonNullable<ConstructorParameters<typeof Editor>[0]>['editorProps'] {
    return {
      attributes: {
        id: 'protokoll-dokument',
        class: 'text-editor-inhalt dokument',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Tagesordnung',
      },
      handleKeyDown: (view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          toolbar?.openLink();
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete') {
          // The browser may have moved the cursor (Home, End, a tap) and not told the editor
          // yet; the keys at the edges of an item must see where it really is, or the browser
          // itself would join the title and the text
          const dom = document.getSelection();
          const anchor = dom?.anchorNode;
          const element = anchor instanceof Element ? anchor : anchor?.parentElement;
          if (anchor && dom.isCollapsed && element?.closest('.punkt-titel, .punkt-text')) {
            try {
              const pos = view.posAtDOM(anchor, dom.anchorOffset);
              const resolved = view.state.doc.resolve(pos);
              if (resolved.parent.isTextblock && pos !== view.state.selection.from) {
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))
                );
              }
            } catch {
              // Outside the document; the editor keeps its own selection
            }
          }
        }
        return false;
      },
    };
  }

  /**
   * Where an end of the browser's selection belongs when it lies in the title row but outside
   * the title: before the title (handle, number) at its start, after it (buttons, Aktion) at its
   * end. Shift+Home and Shift+End put it there, and the editor would drop such a selection.
   */
  function clampSelectionEnd(node: Node): number | null {
    const view = editor?.view;
    const target = node instanceof Element ? node : node.parentElement;
    if (!view || !target || !element?.contains(target)) return null;
    if (target.closest('.punkt-titel, .punkt-text')) return null;
    const titel = target.closest('[data-punkt-kopf]')?.querySelector('.punkt-titel');
    if (!titel) return null;
    const after = (target.compareDocumentPosition(titel) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    return view.posAtDOM(titel, after ? titel.childNodes.length : 0);
  }

  function onSelectionChange(): void {
    const selection = document.getSelection();
    const view = editor?.view;
    if (!view || !selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;
    try {
      const anchor = clampSelectionEnd(selection.anchorNode);
      const head = clampSelectionEnd(selection.focusNode);
      if (anchor === null && head === null) return;
      const { doc, tr } = view.state;
      const from = anchor ?? view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      const to = head ?? view.posAtDOM(selection.focusNode, selection.focusOffset);
      view.dispatch(tr.setSelection(TextSelection.between(doc.resolve(from), doc.resolve(to))));
    } catch {
      // Outside the document; the editor keeps its own selection
    }
  }

  /** The bars that stick to the top of the window: the site header and the status bar. */
  function stickyBars(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('body > header, [data-sticky-top]')].filter(
      (bar) => ['sticky', 'fixed'].includes(getComputedStyle(bar).position)
    );
  }

  /**
   * Where the lowest sticky bar ends once it sticks: its sticky offset plus its height. Its
   * current place on the screen would be wrong before the page is scrolled.
   */
  function measureTop(): void {
    toolbarTop = Math.max(
      0,
      ...stickyBars().map((bar) => {
        const top = parseFloat(getComputedStyle(bar).top);
        return (Number.isFinite(top) ? top : 0) + bar.offsetHeight;
      })
    );
  }

  onMount(() => {
    if (!element) return;
    const extensions = dokumentExtensions({
      punkt: punktView(),
      titel: titelView(views),
      text: textView(views),
      extras: extrasView(views),
    });
    extensions.push(
      Placeholder.configure({
        includeChildren: true,
        showOnlyCurrent: false,
        // Every empty paragraph carries the text; the styles show it only in an empty text
        placeholder: ({ node }) => {
          if (node.type.name === 'punktTitel') return PLACEHOLDER_TITEL;
          return node.type.name === 'paragraph' ? PLACEHOLDER_TEXT : '';
        },
      })
    );
    // The editor starts with an empty item; the agenda is built with its own schema and put in
    // without a history entry, so the nodes are the editor's and nothing can be undone to empty
    const instance = new Editor({
      element,
      extensions,
      editorProps: editorProps(),
      onUpdate: ({ editor: e }) => {
        if (!umwandlung) return;
        const result = umwandlung.punkte(e.state.doc);
        messen(result);
        emitted = punkteKey(result);
        punkte = result;
      },
      onTransaction: ({ editor: e }) => {
        requestAnimationFrame(() => {
          if (!e.isDestroyed) views.sync(e.state.doc);
        });
      },
      onSelectionUpdate: ({ editor: e }) => onactive?.(activePunktId(e.state)),
    });
    const conversion = new DokumentUmwandlung(instance.schema);
    umwandlung = conversion;
    const start = conversion.doc($state.snapshot(punkte) as ProtokollPunkt[]);
    instance.view.updateState(
      instance.state.apply(
        instance.state.tr
          .replaceWith(0, instance.state.doc.content.size, start.content)
          .setMeta(PUNKTE_META, true)
          .setMeta('addToHistory', false)
      )
    );
    editor = instance;
    views.sync(instance.state.doc);
    measureTop();
    // The bars change height with their messages, the status bar takes its offset from the
    // header after it is mounted; measure again after the page has settled
    const bars = new ResizeObserver(() => requestAnimationFrame(measureTop));
    for (const bar of stickyBars()) bars.observe(bar);
    // Before the editor reads the selection (its own listener was added first)
    document.addEventListener('selectionchange', onSelectionChange, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange, true);
      bars.disconnect();
      instance.destroy();
    };
  });

  // The agenda changed outside the editor: show it, keeping the items that stayed the same
  $effect(() => {
    const key = punkteKey(punkte);
    if (!editor || !umwandlung || key === emitted) return;
    emitted = key;
    const next = $state.snapshot(punkte) as ProtokollPunkt[];
    messen(next);
    replacePunkte(editor, umwandlung, next);
  });

  // The people arrive after the page; the name fields take them up
  $effect(() => {
    void personen;
    if (editor) views.sync(editor.state.doc);
  });

  /** Puts the cursor into the title or the text of an item, e.g. after it was added. */
  export function focusPunkt(id: string, field: 'titel' | 'text'): boolean {
    return editor ? selectPunkt(editor, id, field) : false;
  }
</script>

<svelte:window onresize={measureTop} />

<div
  class="dokument rounded-md border border-neutral-300 bg-surface shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-400)]"
>
  <TextEditorToolbar
    bind:this={toolbar}
    {editor}
    features={PROTOKOLL_TEXT_FEATURES}
    id="protokoll-dokument"
    class="dokument-toolbar md:sticky z-10 rounded-t-md bg-surface"
    --toolbar-top="{toolbarTop}px"
  />
  <div bind:this={element} class="inhalt"></div>
</div>

<style>
  .dokument :global(.dokument-toolbar) {
    top: var(--toolbar-top, 0px);
  }
  .inhalt :global(.text-editor-inhalt.dokument) {
    gap: 0;
    padding: 0 0.75rem 0.75rem;
  }

  /* An item: a section with a line above it, like the fields before */
  .inhalt :global(.punkt) {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-neutral-200);
  }
  .inhalt :global(.punkt + .punkt) {
    margin-top: 1.5rem;
  }
  .inhalt :global(.unterpunkt) {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-left: 5.5rem;
    padding-left: 1rem;
    border-left: 1px solid var(--color-neutral-200);
  }
  .inhalt :global(.unterpunkt + .unterpunkt) {
    margin-top: 0.5rem;
  }

  /* The title row: handle, number, title, tools; the Aktion below the title */
  .inhalt :global(.punkt-kopf) {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'griff nummer titel werkzeuge'
      '. . aktion aktion'
      '. . warnung warnung';
    align-items: start;
    column-gap: 0.25rem;
  }
  .inhalt :global(.punkt-kopf > .griff) {
    grid-area: griff;
  }
  .inhalt :global(.punkt-kopf > .nummer) {
    grid-area: nummer;
    min-width: 2.25rem;
    padding-top: 0.5rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--color-brand-900);
  }
  .inhalt :global(.unterpunkt .punkt-kopf > .nummer) {
    min-width: 2.5rem;
  }
  .inhalt :global(.punkt-kopf > .punkt-titel) {
    grid-area: titel;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-neutral-300);
    border-radius: var(--radius-md);
    background: var(--color-field);
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-neutral-900);
  }
  .inhalt :global(.punkt-titel.is-empty::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    font-weight: 400;
    color: var(--color-neutral-500);
    pointer-events: none;
  }
  .inhalt :global(.punkt-kopf > .werkzeuge) {
    grid-area: werkzeuge;
    display: flex;
    gap: 0.25rem;
  }
  .inhalt :global(.punkt-kopf > .aktion-zeile) {
    grid-area: aktion;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 0.5rem;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: var(--color-neutral-700);
  }
  .inhalt :global(.punkt-kopf > .aktion-zeile[hidden]) {
    display: none;
  }
  .inhalt :global(.punkt-kopf > .zu-lang) {
    grid-area: warnung;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: var(--color-danger);
  }
  .inhalt :global(.punkt-kopf > .zu-lang[hidden]) {
    display: none;
  }

  /* The text and the tasks sit below the title, aligned with it */
  .inhalt :global(.punkt-text),
  .inhalt :global(.punkt-extras) {
    margin-left: 5.5rem;
  }
  .inhalt :global(.unterpunkt > .punkt-text),
  .inhalt :global(.unterpunkt > .punkt-extras) {
    margin-left: 5.75rem;
  }
  .inhalt :global(.punkt-text) {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    min-height: 4.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-neutral-300);
    border-radius: var(--radius-md);
  }
  .inhalt :global(.punkt-text > p.is-empty:only-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--color-neutral-500);
    pointer-events: none;
  }
  .inhalt :global(.punkt-extras) {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  @media (max-width: 40rem) {
    .inhalt :global(.punkt-text),
    .inhalt :global(.punkt-extras),
    .inhalt :global(.unterpunkt > .punkt-text),
    .inhalt :global(.unterpunkt > .punkt-extras) {
      margin-left: 0;
    }
    .inhalt :global(.unterpunkt) {
      margin-left: 0.5rem;
    }
    /* The title gets the width; the buttons move below it, next to the Aktion */
    .inhalt :global(.punkt-kopf) {
      grid-template-columns: auto auto minmax(0, 1fr);
      grid-template-areas:
        'griff nummer titel'
        'aktion aktion aktion'
        'warnung warnung warnung'
        'werkzeuge werkzeuge werkzeuge';
    }
    .inhalt :global(.punkt-kopf > .werkzeuge) {
      justify-self: end;
    }
    /* One row of tools that scrolls sideways; the cut-off last tool shows there is more */
    .dokument :global(.dokument-toolbar [role='toolbar']) {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: thin;
    }
  }

  /* While an item is dragged, every item shrinks to its title row */
  :global(.is-ordering) .inhalt :global(.punkt-text),
  :global(.is-ordering) .inhalt :global(.punkt-extras),
  :global(.is-ordering) .inhalt :global(.aktion-zeile) {
    display: none;
  }
  :global(.is-ordering) .inhalt :global(.punkt),
  :global(.is-ordering) .inhalt :global(.unterpunkt) {
    gap: 0.25rem;
    padding-top: 0.5rem;
  }
  :global(.is-ordering) .inhalt :global(.punkt + .punkt) {
    margin-top: 0.5rem;
  }

  .inhalt :global(.icon-button) {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md);
    color: var(--color-neutral-700);
  }
  .inhalt :global(.icon-button:hover:not(:disabled)) {
    background: var(--color-neutral-100);
  }
  .inhalt :global(.icon-button:disabled) {
    opacity: 0.35;
  }
  .inhalt :global(.icon-button svg) {
    width: 1.1rem;
    height: 1.1rem;
  }
  .inhalt :global(.icon-button.griff) {
    width: 2.75rem;
    height: 2.75rem;
    cursor: grab;
    touch-action: none;
  }
</style>
