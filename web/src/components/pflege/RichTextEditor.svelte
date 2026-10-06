<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { onMount } from 'svelte';
  import { sanitizeDescription } from '../../lib/api';
  import { normalizeLinkUrl } from '../../lib/blog';

  interface Props {
    /** HTML value; only the tags `sanitize` allows survive. */
    value: string;
    id: string;
    labelledBy: string;
    describedBy?: string;
    invalid?: boolean;
    /** Optional tools; without them the editor only offers bold, italic and lists. */
    features?: { headings?: boolean; links?: boolean };
    /** Cleans the editor content into `value`; the tools used must survive it. */
    sanitize?: (html: string) => string;
    /** Prepares `value` for display when the editor is mounted (e.g. image previews). */
    toDisplay?: (html: string) => string;
  }

  let {
    value = $bindable(),
    id,
    labelledBy,
    describedBy,
    invalid = false,
    features = {},
    sanitize = sanitizeDescription,
    toDisplay = (html: string) => html,
  }: Props = $props();

  let editor = $state<HTMLDivElement | null>(null);
  let active = $state<Record<string, boolean>>({});
  let block = $state('');
  /** Last selection inside the editor, restored before inserting links or images. */
  let savedRange: Range | null = null;
  let linkOpen = $state(false);
  let linkUrl = $state('');
  let linkError = $state<string | null>(null);
  let linkInput = $state<HTMLInputElement | null>(null);

  type Command = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList';

  const TOOLS: { command: Command; label: string; icon: string }[] = [
    {
      command: 'bold',
      label: 'Fett',
      icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
    },
    { command: 'italic', label: 'Kursiv', icon: 'M11 5h6M7 19h6M14 5l-4 14' },
    {
      command: 'insertUnorderedList',
      label: 'Aufzählung',
      icon: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    },
    {
      command: 'insertOrderedList',
      label: 'Nummerierte Liste',
      icon: 'M10 6h10M10 12h10M10 18h10M4 5.5h1.5V9M4 9h3M4 15h2.5L4 18.5h3',
    },
  ];

  const HEADINGS: { tag: 'h2' | 'h3'; label: string; text: string }[] = [
    { tag: 'h2', label: 'Zwischenüberschrift', text: 'H2' },
    { tag: 'h3', label: 'Kleine Zwischenüberschrift', text: 'H3' },
  ];

  const LINK_ICON =
    'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7';

  onMount(() => {
    if (!editor) return;
    // Paragraphs instead of <div> for new lines
    document.execCommand('defaultParagraphSeparator', false, 'p');
    // The editable element has no Svelte-managed children, so setting its content is safe
    // eslint-disable-next-line svelte/no-dom-manipulating
    editor.innerHTML = toDisplay(value);

    document.addEventListener('selectionchange', saveSelection);
    return () => document.removeEventListener('selectionchange', saveSelection);
  });

  function saveSelection(): void {
    const selection = document.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }

  /** Focuses the editor with the last selection, or the caret at the end. */
  function restoreSelection(): void {
    if (!editor) return;
    editor.focus();
    const selection = document.getSelection();
    if (!selection) return;
    let range = savedRange;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function sync(): void {
    if (!editor) return;
    value = sanitize(editor.innerHTML);
    updateActive();
  }

  function updateActive(): void {
    active = Object.fromEntries(
      TOOLS.map((t) => [t.command, document.queryCommandState(t.command)])
    );
    block = String(document.queryCommandValue('formatBlock') ?? '').toLowerCase();
    active.link = currentLink() !== null;
  }

  function run(command: Command): void {
    editor?.focus();
    // execCommand is deprecated but still the only built-in way to format contenteditable
    document.execCommand(command);
    sync();
  }

  function toggleHeading(tag: 'h2' | 'h3'): void {
    editor?.focus();
    document.execCommand('formatBlock', false, block === tag ? '<p>' : `<${tag}>`);
    sync();
  }

  /** The link around the current selection, if any. */
  function currentLink(): HTMLAnchorElement | null {
    const node = savedRange?.commonAncestorContainer ?? null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    const link = element?.closest('a') ?? null;
    return link && editor?.contains(link) ? link : null;
  }

  function openLink(): void {
    saveSelection();
    linkUrl = currentLink()?.getAttribute('href') ?? '';
    linkError = null;
    linkOpen = true;
    queueMicrotask(() => linkInput?.focus());
  }

  function closeLink(): void {
    linkOpen = false;
    restoreSelection();
  }

  function applyLink(): void {
    const url = normalizeLinkUrl(linkUrl);
    if (!url) {
      linkError = 'Bitte eine Webadresse (https://…) oder E-Mail-Adresse angeben.';
      return;
    }
    linkOpen = false;
    restoreSelection();
    const existing = currentLink();
    if (existing) {
      existing.setAttribute('href', url);
    } else if (savedRange && !savedRange.collapsed) {
      document.execCommand('createLink', false, url);
    } else {
      // Nothing selected: the address itself becomes the link text
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url.replace(/^mailto:/, '');
      document.execCommand('insertHTML', false, link.outerHTML);
    }
    sync();
  }

  function removeLink(): void {
    linkOpen = false;
    const existing = currentLink();
    restoreSelection();
    if (existing) {
      const range = document.createRange();
      range.selectNodeContents(existing);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    }
    document.execCommand('unlink');
    sync();
  }

  /** Inserts an image at the last cursor position; `attributes` are set on the `<img>`. */
  export function insertImage(attributes: Record<string, string>): void {
    restoreSelection();
    const image = document.createElement('img');
    for (const [name, attributeValue] of Object.entries(attributes)) {
      image.setAttribute(name, attributeValue);
    }
    document.execCommand('insertHTML', false, image.outerHTML);
    sync();
  }

  /** Removes all images matching the selector, e.g. after the image was deleted. */
  export function removeImages(selector: string): void {
    for (const image of Array.from(editor?.querySelectorAll(selector) ?? [])) image.remove();
    sync();
  }

  function onpaste(event: ClipboardEvent): void {
    // Formatting from other sources is dropped; line breaks are kept as paragraphs
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      event.preventDefault();
      run(key === 'b' ? 'bold' : 'italic');
    } else if (key === 'k' && features.links) {
      event.preventDefault();
      openLink();
    }
  }

  function onlinkkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeLink();
    }
  }
</script>

{#snippet icon(path: string)}
  <svg
    aria-hidden="true"
    class="size-4"
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

<div
  class="mt-1 rounded-md border bg-surface shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid
    ? 'border-danger'
    : 'border-neutral-300'}"
>
  <div
    role="toolbar"
    aria-label="Formatierung"
    aria-controls={id}
    class="flex flex-wrap gap-1 border-b border-neutral-200 px-1.5 py-1"
  >
    {#if features.headings}
      {#each HEADINGS as heading (heading.tag)}
        <button
          type="button"
          class="tool min-w-8 text-xs font-bold"
          aria-label={heading.label}
          aria-pressed={block === heading.tag}
          title={heading.label}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => toggleHeading(heading.tag)}
        >
          {heading.text}
        </button>
      {/each}
      <span aria-hidden="true" class="mx-0.5 w-px self-stretch bg-neutral-200"></span>
    {/if}
    {#each TOOLS as tool (tool.command)}
      <button
        type="button"
        class="tool"
        aria-label={tool.label}
        aria-pressed={active[tool.command] ?? false}
        title={tool.label}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => run(tool.command)}
      >
        {@render icon(tool.icon)}
      </button>
    {/each}
    {#if features.links}
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
          onkeydown={onlinkkeydown}
        />
      </label>
      <ActionButton variant="primary" type="button" onclick={applyLink}>Übernehmen</ActionButton>
      {#if active.link}
        <ActionButton variant="secondary" type="button" onclick={removeLink}
          >Link entfernen</ActionButton
        >
      {/if}
      <ActionButton variant="secondary" type="button" onclick={closeLink}>Abbrechen</ActionButton>
      {#if linkError}
        <p id="{id}-link-error" class="w-full text-sm text-danger">
          {linkError}
        </p>
      {/if}
    </div>
  {/if}
  <div
    bind:this={editor}
    {id}
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    aria-invalid={invalid ? 'true' : undefined}
    contenteditable="true"
    class="rich-text min-h-32 px-3 py-2 text-base text-neutral-900 focus:outline-none focus-visible:outline-none"
    oninput={sync}
    onkeyup={updateActive}
    onmouseup={updateActive}
    {onpaste}
    {onkeydown}
  ></div>
</div>

<style>
  .tool {
    border-radius: 0.25rem;
    padding: 0.375rem;
    color: var(--color-brand-900);
  }
  .tool:hover {
    background: var(--color-brand-50);
  }
  .tool[aria-pressed='true'] {
    background: var(--color-brand-100);
  }
  .rich-text :global(p),
  .rich-text :global(div) {
    margin: 0 0 0.5rem;
  }
  .rich-text :global(h2) {
    margin: 1rem 0 0.5rem;
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .rich-text :global(h3) {
    margin: 0.75rem 0 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .rich-text :global(a) {
    color: var(--color-brand-700);
    text-decoration: underline;
  }
  .rich-text :global(img) {
    display: block;
    max-width: 100%;
    max-height: 20rem;
    margin: 0.5rem 0;
    border-radius: 0.375rem;
  }
  .rich-text :global(ul) {
    list-style: disc;
    padding-left: 1.5rem;
    margin-bottom: 0.5rem;
  }
  .rich-text :global(ol) {
    list-style: decimal;
    padding-left: 1.5rem;
    margin-bottom: 0.5rem;
  }
</style>
