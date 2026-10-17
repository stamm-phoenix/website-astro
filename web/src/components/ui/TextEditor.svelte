<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import ActionButton from './ActionButton.svelte';
  import { editorExtensions, normalizeBullets } from '../../lib/textEditor';
  import type { TextEditorFeatures } from '../../lib/textEditor';
  import { normalizeLinkUrl } from '../../lib/blog';

  /**
   * Formatting editor for Leitende (#320): writes Markdown without showing its syntax. Bold,
   * italic, strikethrough, code and lists are always there; `features` adds headings, links,
   * checklists, tables and blocks. `value` holds the Markdown and changes with every keystroke.
   */
  interface Props {
    value: string;
    id: string;
    labelledBy: string;
    describedBy?: string;
    invalid?: boolean;
    placeholder?: string;
    features?: TextEditorFeatures;
    /** Longest text the server accepts; a longer one shows a warning. */
    maxLength?: number;
  }

  let {
    value = $bindable(),
    id,
    labelledBy,
    describedBy,
    invalid = false,
    placeholder = '',
    features = {},
    maxLength,
  }: Props = $props();

  let element = $state<HTMLDivElement | null>(null);
  let editor = $state<Editor | null>(null);
  let active = $state<Record<string, boolean>>({});
  let can = $state({ undo: false, redo: false });
  /** A table is wider than the editor, so it scrolls sideways; said in words on phones. */
  let tableTooWide = $state(false);
  /** The Markdown the editor last produced, so outside changes to `value` are told apart. */
  let emitted = value;

  let linkOpen = $state(false);
  let linkUrl = $state('');
  let linkError = $state<string | null>(null);
  let linkInput = $state<HTMLInputElement | null>(null);

  interface Tool {
    key: string;
    label: string;
    /** Icon path or, for headings, the text on the button. */
    icon: string;
    text?: boolean;
    run: (editor: Editor) => void;
    shortcut?: string;
  }

  const MARKS: Tool[] = [
    {
      key: 'bold',
      label: 'Fett',
      shortcut: 'Strg+B',
      icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Kursiv',
      shortcut: 'Strg+I',
      icon: 'M11 5h6M7 19h6M14 5l-4 14',
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      key: 'strike',
      label: 'Durchgestrichen',
      shortcut: 'Strg+Umschalt+S',
      icon: 'M4 12h16M8 7a4 3 0 0 1 8 0M8 17a4 3 0 0 0 8 0',
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      key: 'code',
      label: 'Code',
      shortcut: 'Strg+E',
      icon: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ];

  const LISTS: Tool[] = [
    {
      key: 'bulletList',
      label: 'Aufzählung',
      shortcut: 'Strg+Umschalt+8',
      icon: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      label: 'Nummerierte Liste',
      shortcut: 'Strg+Umschalt+7',
      icon: 'M10 6h10M10 12h10M10 18h10M4 5.5h1.5V9M4 9h3M4 15h2.5L4 18.5h3',
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  ];

  const CHECKLIST: Tool = {
    key: 'taskList',
    label: 'Checkliste',
    shortcut: 'Strg+Umschalt+9',
    icon: 'M11 6h9M11 12h9M11 18h9M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
    run: (e) => e.chain().focus().toggleTaskList().run(),
  };

  const LINK_ICON =
    'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7';

  const TABLE: Tool = {
    key: 'table',
    label: 'Tabelle',
    icon: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    run: (e) => e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(),
  };

  const BLOCKS: Tool[] = [
    {
      key: 'blockquote',
      label: 'Zitat',
      shortcut: 'Strg+Umschalt+B',
      icon: 'M6 11h4v6H6zM6 11c0-3 1-5 4-6M14 11h4v6h-4zM14 11c0-3 1-5 4-6',
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      key: 'codeBlock',
      label: 'Codeblock',
      shortcut: 'Strg+Alt+C',
      icon: 'M4 5h16v14H4zM9 10l-2 2 2 2M15 10l2 2-2 2',
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      key: 'horizontalRule',
      label: 'Trennlinie',
      icon: 'M4 12h16',
      run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ];

  const HISTORY: Tool[] = [
    {
      key: 'undo',
      label: 'Rückgängig',
      shortcut: 'Strg+Z',
      icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
      run: (e) => e.chain().focus().undo().run(),
    },
    {
      key: 'redo',
      label: 'Wiederholen',
      shortcut: 'Strg+Umschalt+Z',
      icon: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
      run: (e) => e.chain().focus().redo().run(),
    },
  ];

  const TABLE_TOOLS: { label: string; run: (editor: Editor) => void }[] = [
    { label: 'Zeile darunter', run: (e) => e.chain().focus().addRowAfter().run() },
    { label: 'Spalte rechts', run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: 'Zeile löschen', run: (e) => e.chain().focus().deleteRow().run() },
    { label: 'Spalte löschen', run: (e) => e.chain().focus().deleteColumn().run() },
    { label: 'Tabelle löschen', run: (e) => e.chain().focus().deleteTable().run() },
  ];

  const headings = $derived(
    (features.headings ?? []).map((level, index) => ({
      level,
      label: index === 0 ? 'Zwischenüberschrift' : 'Kleine Zwischenüberschrift',
      text: `H${level}`,
    }))
  );
  const tooLong = $derived(maxLength !== undefined && value.length > maxLength);

  onMount(() => {
    if (!element) return;
    const instance = new Editor({
      element,
      extensions: editorExtensions(features, placeholder),
      content: normalizeBullets(value),
      contentType: 'markdown',
      editorProps: {
        attributes: {
          id,
          class: 'text-editor-inhalt',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelledBy,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(invalid ? { 'aria-invalid': 'true' } : {}),
        },
        handleKeyDown: (_view, event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'k' &&
            features.links
          ) {
            event.preventDefault();
            openLink();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: e }) => {
        emitted = e.getMarkdown();
        value = emitted;
      },
      onTransaction: ({ editor: e }) => updateActive(e),
    });
    editor = instance;
    updateActive(instance);
    return () => instance.destroy();
  });

  // Text changed outside the editor, e.g. restored from the device: show it
  $effect(() => {
    const next = value;
    if (!editor || next === emitted) return;
    emitted = next;
    editor.commands.setContent(normalizeBullets(next), {
      contentType: 'markdown',
      emitUpdate: false,
    });
  });

  function updateActive(e: Editor): void {
    const next: Record<string, boolean> = {};
    for (const tool of [...MARKS, ...LISTS, CHECKLIST, TABLE, ...BLOCKS]) {
      next[tool.key] = e.isActive(tool.key);
    }
    for (const heading of headings) {
      next[`heading${heading.level}`] = e.isActive('heading', { level: heading.level });
    }
    next.link = e.isActive('link');
    active = next;
    can = { undo: e.can().undo(), redo: e.can().redo() };
    requestAnimationFrame(measureTables);
  }

  function measureTables(): void {
    const wrappers = Array.from(element?.querySelectorAll('.tableWrapper') ?? []);
    tableTooWide = wrappers.some((wrapper) => wrapper.scrollWidth > wrapper.clientWidth + 1);
  }

  function title(tool: { label: string; shortcut?: string }): string {
    return tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
  }

  function openLink(): void {
    if (!editor) return;
    linkUrl = (editor.getAttributes('link').href as string | undefined) ?? '';
    linkError = null;
    linkOpen = true;
    queueMicrotask(() => linkInput?.focus());
  }

  function closeLink(): void {
    linkOpen = false;
    editor?.commands.focus();
  }

  function applyLink(): void {
    if (!editor) return;
    const url = normalizeLinkUrl(linkUrl);
    if (!url) {
      linkError = 'Bitte eine Webadresse (https://…) oder E-Mail-Adresse angeben.';
      return;
    }
    linkOpen = false;
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive('link')) {
      // Nothing selected: the address itself becomes the link text
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: url.replace(/^mailto:/, ''),
          marks: [{ type: 'link', attrs: { href: url } }],
        })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }

  function removeLink(): void {
    linkOpen = false;
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
  }
</script>

<svelte:window onresize={measureTables} />

{#snippet icon(path: string)}
  <svg
    aria-hidden="true"
    class="size-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d={path} />
  </svg>
{/snippet}

{#snippet toolButton(tool: Tool, disabled = false)}
  <button
    type="button"
    class="tool"
    aria-label={tool.label}
    aria-pressed={active[tool.key] ?? false}
    title={title(tool)}
    {disabled}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => editor && tool.run(editor)}
  >
    {@render icon(tool.icon)}
  </button>
{/snippet}

{#snippet separator()}
  <span aria-hidden="true" class="mx-0.5 w-px self-stretch bg-neutral-200"></span>
{/snippet}

<div
  class="text-editor rounded-md border bg-surface shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid ||
  tooLong
    ? 'border-danger'
    : 'border-neutral-300'}"
>
  <div
    role="toolbar"
    aria-label="Formatierung"
    aria-controls={id}
    class="flex flex-wrap gap-0.5 border-b border-neutral-200 px-1 py-0.5"
  >
    {#each MARKS as tool (tool.key)}
      {@render toolButton(tool)}
    {/each}
    {#if headings.length > 0}
      {@render separator()}
      {#each headings as heading (heading.level)}
        <button
          type="button"
          class="tool text-sm font-bold"
          aria-label={heading.label}
          aria-pressed={active[`heading${heading.level}`] ?? false}
          title={heading.label}
          onmousedown={(event) => event.preventDefault()}
          onclick={() =>
            editor
              ?.chain()
              .focus()
              .toggleHeading({ level: heading.level as 1 | 2 | 3 | 4 | 5 | 6 })
              .run()}
        >
          {heading.text}
        </button>
      {/each}
    {/if}
    {@render separator()}
    {#each LISTS as tool (tool.key)}
      {@render toolButton(tool)}
    {/each}
    {#if features.checklists}
      {@render toolButton(CHECKLIST)}
    {/if}
    {#if features.links}
      {@render separator()}
      <button
        type="button"
        class="tool"
        aria-label="Link"
        aria-pressed={active.link ?? false}
        aria-expanded={linkOpen}
        title="Link (Strg+K)"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => (linkOpen ? closeLink() : openLink())}
      >
        {@render icon(LINK_ICON)}
      </button>
    {/if}
    {#if features.tables || features.blocks}
      {@render separator()}
    {/if}
    {#if features.tables}
      {@render toolButton(TABLE)}
    {/if}
    {#if features.blocks}
      {#each BLOCKS as tool (tool.key)}
        {@render toolButton(tool)}
      {/each}
    {/if}
    {@render separator()}
    {@render toolButton(HISTORY[0], !can.undo)}
    {@render toolButton(HISTORY[1], !can.redo)}
  </div>
  {#if linkOpen}
    <div class="flex flex-wrap items-start gap-2 border-b border-neutral-200 bg-neutral-50 p-2">
      <label class="min-w-48 flex-1 text-sm">
        <span class="sr-only">Linkadresse</span>
        <input
          bind:this={linkInput}
          type="text"
          inputmode="url"
          class="form-input mt-0!"
          placeholder="https://… oder E-Mail-Adresse"
          aria-invalid={linkError ? 'true' : undefined}
          aria-describedby={linkError ? `${id}-link-error` : undefined}
          bind:value={linkUrl}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyLink();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeLink();
            }
          }}
        />
      </label>
      <ActionButton variant="primary" onclick={applyLink}>Übernehmen</ActionButton>
      {#if active.link}
        <ActionButton onclick={removeLink}>Link entfernen</ActionButton>
      {/if}
      <ActionButton onclick={closeLink}>Abbrechen</ActionButton>
      {#if linkError}
        <p id="{id}-link-error" class="w-full text-sm text-danger">{linkError}</p>
      {/if}
    </div>
  {/if}
  {#if active.table}
    <div
      role="toolbar"
      aria-label="Tabelle"
      class="flex flex-wrap gap-1 border-b border-neutral-200 bg-neutral-50 px-2 py-1"
    >
      {#each TABLE_TOOLS as tool (tool.label)}
        <button
          type="button"
          class="table-tool"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => editor && tool.run(editor)}
        >
          {tool.label}
        </button>
      {/each}
      {#if tableTooWide}
        <p class="w-full px-1 pb-1 text-xs text-neutral-700">
          Die Tabelle ist breiter als der Bildschirm. Wische in der Tabelle seitlich, um alle
          Spalten zu sehen.
        </p>
      {/if}
    </div>
  {/if}
  <div bind:this={element} class="inhalt"></div>
  {#if tooLong && maxLength !== undefined}
    <p class="border-t border-neutral-200 px-3 py-1.5 text-sm text-danger" role="alert">
      Der Text ist zu lang ({value.length.toLocaleString('de-DE')} von
      {maxLength.toLocaleString('de-DE')} Zeichen) und wird so nicht gespeichert. Bitte kürzen.
    </p>
  {/if}
</div>

<style>
  .tool,
  .table-tool {
    display: grid;
    place-items: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: var(--radius-md);
    color: var(--color-brand-900);
  }
  .table-tool {
    padding: 0 0.6rem;
    font-size: 0.875rem;
  }
  .tool:hover:not(:disabled),
  .table-tool:hover {
    background: var(--color-brand-50);
  }
  .tool[aria-pressed='true'] {
    background: var(--color-brand-100);
  }
  .tool:disabled {
    opacity: 0.35;
  }

  /* The editable area; Tiptap renders the document inside it */
  .inhalt :global(.text-editor-inhalt) {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    min-height: 4.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--color-neutral-900);
    overflow-wrap: anywhere;
    outline: none;
  }
  .inhalt :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--color-neutral-500);
    pointer-events: none;
  }
  .inhalt :global(h1),
  .inhalt :global(h2),
  .inhalt :global(h3) {
    margin-top: 0.4em;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .inhalt :global(h1) {
    font-size: 1.125em;
  }
  .inhalt :global(h2),
  .inhalt :global(h3) {
    font-size: 1em;
  }
  .inhalt :global(a) {
    color: var(--color-brand-700);
    text-decoration: underline;
  }
  .inhalt :global(ul),
  .inhalt :global(ol) {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    padding-left: 1.5em;
  }
  .inhalt :global(ul) {
    list-style: disc;
  }
  .inhalt :global(ol) {
    list-style: decimal;
  }
  .inhalt :global(li > p + ul),
  .inhalt :global(li > p + ol),
  .inhalt :global(li > div > p + ul),
  .inhalt :global(li > div > p + ol) {
    margin-top: 0.25em;
  }
  .inhalt :global(ul[data-type='taskList']) {
    list-style: none;
    padding-left: 0.25em;
  }
  .inhalt :global(ul[data-type='taskList'] > li) {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
    /* Each row is as tall as the touch target, so neighbouring boxes never overlap */
    min-height: 2.75rem;
  }
  .inhalt :global(ul[data-type='taskList'] > li > label) {
    display: grid;
    flex: none;
    place-items: center;
    /* A 44 px touch target around the box; the negative margins keep the box in place */
    width: 2.75rem;
    height: 2.75rem;
    margin-inline: calc((1.05em - 2.75rem) / 2);
  }
  .inhalt :global(ul[data-type='taskList'] > li input) {
    width: 1.05em;
    height: 1.05em;
    accent-color: var(--color-success);
    cursor: pointer;
  }
  .inhalt :global(ul[data-type='taskList'] > li > div) {
    flex: 1;
    min-width: 0;
    /* The first line sits level with the box */
    padding-top: calc((2.75rem - 1.55em) / 2);
  }
  .inhalt :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--color-neutral-100);
    border-radius: var(--radius-sm);
    padding: 0.1em 0.3em;
  }
  .inhalt :global(pre) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--color-neutral-100);
    border-radius: var(--radius-sm);
    padding: 0.75em 1em;
    overflow-x: auto;
    white-space: pre;
  }
  .inhalt :global(pre code) {
    padding: 0;
    background: none;
    font-size: inherit;
  }
  .inhalt :global(blockquote) {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    border-left: 3px solid var(--color-neutral-300);
    padding-left: 0.9em;
    color: var(--color-neutral-700);
  }
  .inhalt :global(hr) {
    border: 0;
    border-top: 1px solid var(--color-neutral-200);
    margin: 0.4em 0;
  }
  .inhalt :global(.tableWrapper) {
    max-width: 100%;
    overflow-x: auto;
  }
  .inhalt :global(table) {
    border-collapse: collapse;
    font-size: 0.95em;
  }
  .inhalt :global(th),
  .inhalt :global(td) {
    position: relative;
    min-width: 3em;
    border: 1px solid var(--color-neutral-200);
    padding: 0.35em 0.65em;
    text-align: left;
    vertical-align: top;
  }
  .inhalt :global(th) {
    background: var(--color-neutral-100);
    font-weight: 600;
  }
  .inhalt :global(.selectedCell::after) {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--color-brand-400);
    opacity: 0.2;
    pointer-events: none;
  }
</style>
