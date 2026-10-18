<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import TextEditorToolbar from './TextEditorToolbar.svelte';
  import { sanitizeDescription } from '../../lib/api';
  import { editorExtensions, normalizeBullets, unwrapListParagraphs } from '../../lib/textEditor';
  import type { TextEditorFeatures, TextEditorFormat } from '../../lib/textEditor';

  /**
   * Formatting editor for Leitende (#320): writes Markdown or HTML without showing the syntax.
   * Bold, italic and lists are always there; `features` adds the rest. `value` holds the stored
   * text and changes with every keystroke; outside changes to it are shown.
   */
  interface Props {
    value: string;
    /** Markdown (the minutes) or HTML (the other fields); default Markdown. */
    format?: TextEditorFormat;
    /** HTML only: cleans the editor output into `value`; the tools offered must survive it. */
    sanitize?: (html: string) => string;
    /** HTML only: prepares `value` for display, e.g. adds image previews. */
    toDisplay?: (html: string) => string;
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
    format = 'markdown',
    sanitize = sanitizeDescription,
    toDisplay = (html: string) => html,
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
  let toolbar = $state<TextEditorToolbar | null>(null);
  /** The Markdown the editor last produced, so outside changes to `value` are told apart. */
  let emitted = value;

  const tooLong = $derived(maxLength !== undefined && value.length > maxLength);

  /** The stored text as the editor shows it. */
  function toEditor(text: string): string {
    return format === 'markdown' ? normalizeBullets(text) : toDisplay(text);
  }

  /** The editor content as it is stored. */
  function fromEditor(e: Editor): string {
    return format === 'markdown' ? e.getMarkdown() : sanitize(unwrapListParagraphs(e.getHTML()));
  }

  /** The attributes of the editable element; renewed when the field becomes invalid. */
  function editorProps(): NonNullable<ConstructorParameters<typeof Editor>[0]>['editorProps'] {
    return {
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
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && features.links) {
          event.preventDefault();
          toolbar?.openLink();
          return true;
        }
        return false;
      },
    };
  }

  onMount(() => {
    if (!element) return;
    const instance = new Editor({
      element,
      extensions: editorExtensions(features, placeholder, format),
      content: toEditor(value),
      contentType: format,
      editorProps: editorProps(),
      onUpdate: ({ editor: e }) => {
        emitted = fromEditor(e);
        value = emitted;
      },
    });
    editor = instance;
    return () => instance.destroy();
  });

  // Text changed outside the editor, e.g. restored from the device: show it
  $effect(() => {
    const next = value;
    if (!editor || next === emitted) return;
    emitted = next;
    editor.commands.setContent(toEditor(next), { contentType: format, emitUpdate: false });
  });

  // The error state and the described-by hint change after a failed save
  $effect(() => {
    void [invalid, describedBy, labelledBy];
    editor?.setOptions({ editorProps: editorProps() });
  });

  /** Blog: puts an image at the cursor; `attributes` are `data-bild`, the preview `src` and `alt`. */
  export function insertImage(attributes: Record<string, string>): void {
    editor?.chain().focus().insertContent({ type: 'image', attrs: attributes }).run();
  }

  /** Blog: removes every copy of the image `file` from the text, e.g. after it was deleted. */
  export function removeImage(file: string): void {
    if (!editor) return;
    const { doc, tr } = editor.state;
    const found: { pos: number; size: number }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs['data-bild'] === file) {
        found.push({ pos, size: node.nodeSize });
      }
    });
    if (found.length === 0) return;
    for (const { pos, size } of found.reverse()) tr.delete(pos, pos + size);
    editor.view.dispatch(tr);
  }
</script>

<div
  class="text-editor rounded-md border bg-surface shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid ||
  tooLong
    ? 'border-danger'
    : 'border-neutral-300'}"
>
  <TextEditorToolbar bind:this={toolbar} {editor} {features} {id} />
  <div bind:this={element} class="inhalt"></div>
  {#if tooLong && maxLength !== undefined}
    <p class="border-t border-neutral-200 px-3 py-1.5 text-sm text-danger" role="alert">
      Der Text ist zu lang ({value.length.toLocaleString('de-DE')} von
      {maxLength.toLocaleString('de-DE')} Zeichen) und wird so nicht gespeichert. Bitte kürzen.
    </p>
  {/if}
</div>

<style>
  /* The editable area; Tiptap renders the document inside it. Same surface as the fields */
  .inhalt :global(.text-editor-inhalt) {
    min-height: 4.5rem;
    padding: 0.5rem 0.75rem;
  }
  .inhalt :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--color-neutral-500);
    pointer-events: none;
  }
</style>
