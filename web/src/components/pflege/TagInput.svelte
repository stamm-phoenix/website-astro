<script lang="ts">
  import { getContext } from 'svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  interface Props {
    /** Id of the text input; a label must point to it. */
    id: string;
    tags: string[];
    /** Tags already in use, offered while typing. */
    suggestions?: string[];
    /** Colour of the chips. */
    tone?: 'neutral' | 'positive' | 'negative';
    placeholder?: string;
    describedBy?: string;
    invalid?: boolean;
    /** Called with the new list whenever a tag is added or removed. */
    onchange: (tags: string[]) => void;
    disabled?: boolean;
    /** Lets a surrounding dialog protect text that has not yet been added. */
    ondraftchange?: (value: string) => void;
  }

  let {
    id,
    tags,
    suggestions = [],
    tone = 'neutral',
    placeholder = 'Neues Merkmal',
    describedBy,
    invalid = false,
    onchange,
    disabled = false,
    ondraftchange,
  }: Props = $props();

  const notifyEdited = getContext<(() => void) | undefined>('form-edited');
  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const TONE_CLASS = {
    neutral: 'border-neutral-300 text-brand-900',
    positive: 'border-success/50 text-success',
    negative: 'border-danger/50 text-danger',
  };

  const normalize = (tag: string): string =>
    tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
  const open = $derived(
    suggestions
      .filter((s) => !tags.some((t) => normalize(t) === normalize(s)))
      .map((s) => ({ value: s }))
  );

  function add(value: string): void {
    const additions = value
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const next = [...tags];
    for (const tag of additions) {
      // Reuse the spelling of an existing tag, so the same tag is not written differently
      const known = suggestions.find((s) => normalize(s) === normalize(tag)) ?? tag;
      if (!next.some((t) => normalize(t) === normalize(known))) next.push(known);
    }
    draft = '';
    ondraftchange?.('');
    if (next.length !== tags.length) onchange(next);
    notifyEdited?.();
  }

  function remove(tag: string): void {
    onchange(tags.filter((t) => t !== tag));
    notifyEdited?.();
    input?.focus();
  }
</script>

<div
  class="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid
    ? 'border-danger'
    : 'border-neutral-300'}"
>
  {#each tags as tag (tag)}
    <span
      class="inline-flex min-h-11 max-w-full items-center gap-1 rounded-sm border pl-2 text-sm {TONE_CLASS[
        tone
      ]}"
    >
      <span class="min-w-0 break-words">{tag}</span>
      <button
        type="button"
        class="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
        aria-label="{tag} entfernen"
        {disabled}
        onclick={() => remove(tag)}>×</button
      >
    </span>
  {/each}
  <VorschlagFeld
    bind:input
    {id}
    wrapperClass="min-w-[10rem] flex-1"
    class="min-h-11 w-full border-0 bg-transparent px-1 py-1 text-base focus:outline-none"
    {placeholder}
    aria-describedby={describedBy}
    aria-invalid={invalid ? 'true' : undefined}
    options={open}
    listLabel="Merkmal auswählen"
    clearOnPick
    bind:value={draft}
    {disabled}
    onedit={(text) => ondraftchange?.(text)}
    onkeydown={(event) => {
      if (event.key === ',') {
        event.preventDefault();
        add(draft);
      } else if (
        event.key === 'Enter' &&
        !draft.trim() &&
        !input?.getAttribute('aria-activedescendant')
      ) {
        // Enter in the empty field never sends the surrounding form
        event.preventDefault();
      }
    }}
    onpick={(option) => add(option.value)}
    oncommit={add}
    onremovelast={tags.length > 0 ? () => remove(tags[tags.length - 1]) : undefined}
  />
  <button
    type="button"
    class="min-h-11 shrink-0 px-2 text-sm font-semibold text-link disabled:opacity-50"
    disabled={disabled || !draft.trim()}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => add(draft)}>Hinzufügen</button
  >
</div>
