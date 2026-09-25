<script lang="ts">
  import { onMount } from 'svelte';
  import { sanitizeDescription } from '../../lib/api';

  interface Props {
    /** HTML value; only the tags `sanitizeDescription` allows survive. */
    value: string;
    id: string;
    labelledBy: string;
    describedBy?: string;
    invalid?: boolean;
  }

  let { value = $bindable(), id, labelledBy, describedBy, invalid = false }: Props = $props();

  let editor = $state<HTMLDivElement | null>(null);
  let active = $state<Record<string, boolean>>({});

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

  onMount(() => {
    if (!editor) return;
    // Paragraphs instead of <div> for new lines
    document.execCommand('defaultParagraphSeparator', false, 'p');
    // The editable element has no Svelte-managed children, so setting its content is safe
    // eslint-disable-next-line svelte/no-dom-manipulating
    editor.innerHTML = value;
  });

  function sync(): void {
    if (!editor) return;
    value = sanitizeDescription(editor.innerHTML);
    updateActive();
  }

  function updateActive(): void {
    active = Object.fromEntries(
      TOOLS.map((t) => [t.command, document.queryCommandState(t.command)])
    );
  }

  function run(command: Command): void {
    editor?.focus();
    // execCommand is deprecated but still the only built-in way to format contenteditable
    document.execCommand(command);
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
    }
  }
</script>

<div
  class="mt-1 rounded-md border bg-white shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid
    ? 'border-[var(--color-dpsg-red)]'
    : 'border-neutral-300'}"
>
  <div
    role="toolbar"
    aria-label="Formatierung"
    aria-controls={id}
    class="flex gap-1 border-b border-neutral-200 px-1.5 py-1"
  >
    {#each TOOLS as tool (tool.command)}
      <button
        type="button"
        class="rounded p-1.5 text-brand-900 hover:bg-[var(--color-brand-50)] aria-pressed:bg-[var(--color-brand-100)]"
        aria-label={tool.label}
        aria-pressed={active[tool.command] ?? false}
        title={tool.label}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => run(tool.command)}
      >
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
          <path d={tool.icon} />
        </svg>
      </button>
    {/each}
  </div>
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
  .rich-text :global(p),
  .rich-text :global(div) {
    margin: 0 0 0.5rem;
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
