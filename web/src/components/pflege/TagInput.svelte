<script lang="ts">
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
  }

  let {
    id,
    tags,
    suggestions = [],
    tone = 'neutral',
    placeholder = 'Tag eingeben, Enter zum Hinzufügen',
    describedBy,
    invalid = false,
    onchange,
  }: Props = $props();

  let draft = $state('');

  const TONE_CLASS = {
    neutral: 'border-neutral-300 text-brand-900',
    positive: 'border-success/50 text-success',
    negative: 'border-danger/50 text-danger',
  };

  const normalize = (tag: string): string =>
    tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
  const listId = $derived(`${id}-suggestions`);
  const open = $derived(
    suggestions.filter((s) => !tags.some((t) => normalize(t) === normalize(s)))
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
    if (next.length !== tags.length) onchange(next);
  }

  function remove(tag: string): void {
    onchange(tags.filter((t) => t !== tag));
  }
</script>

<div
  class="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] {invalid
    ? 'border-danger'
    : 'border-neutral-300'}"
>
  {#each tags as tag (tag)}
    <span
      class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-sm {TONE_CLASS[
        tone
      ]}"
    >
      {tag}
      <button
        type="button"
        class="rounded-sm px-1 leading-none text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
        aria-label="Tag {tag} entfernen"
        onclick={() => remove(tag)}>×</button
      >
    </span>
  {/each}
  <input
    {id}
    type="text"
    list={listId}
    class="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-1 text-base focus:outline-none"
    {placeholder}
    aria-describedby={describedBy}
    aria-invalid={invalid ? 'true' : undefined}
    bind:value={draft}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        add(draft);
      } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
        remove(tags[tags.length - 1]);
      }
    }}
    onchange={() => {
      // Choosing a suggestion from the list fires change without Enter
      if (open.some((s) => s === draft)) add(draft);
    }}
    onblur={() => {
      if (draft.trim()) add(draft);
    }}
  />
  <datalist id={listId}>
    {#each open as suggestion (suggestion)}
      <option value={suggestion}></option>
    {/each}
  </datalist>
</div>
