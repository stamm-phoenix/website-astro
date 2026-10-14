<script lang="ts" module>
  /** A person to offer; `gruppe` is the heading the person is listed under, if any. */
  export interface SuchPerson {
    login: string;
    name: string;
    gruppe?: string;
  }
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  /**
   * Search field with a list of matching people (ARIA combobox with listbox), shared by the
   * Aufgaben and the Protokoll-Editor. The caller shows the chosen people and decides what
   * happens with typed text that matches no one (`oncommit`).
   */
  interface Props extends Omit<
    HTMLInputAttributes,
    'value' | 'onkeydown' | 'oninput' | 'onfocus' | 'onblur' | 'role'
  > {
    id: string;
    /** People that may be picked; those already chosen are left out by the caller. */
    options: SuchPerson[];
    query?: string;
    input?: HTMLInputElement | null;
    /** Most matches shown at once. */
    maxResults?: number;
    listLabel?: string;
    onpick: (person: SuchPerson) => void;
    /**
     * Typed text confirmed by leaving the field, or with Enter while the list is closed (no
     * match, or closed with Escape).
     */
    oncommit?: (text: string) => void;
    /** Backspace in the empty field, to remove the last chosen person. */
    onremovelast?: () => void;
    /** Any typing, before the list updates. */
    onedit?: () => void;
  }
  let {
    id,
    options,
    query = $bindable(''),
    input = $bindable(null),
    maxResults = 8,
    listLabel = 'Person auswählen',
    onpick,
    oncommit,
    onremovelast,
    onedit,
    class: className = 'form-input',
    disabled,
    ...rest
  }: Props = $props();

  let open = $state(false);
  let active = $state(-1);

  const matches = $derived.by(() => {
    const search = query.trim().toLocaleLowerCase('de');
    return options
      .filter((person) => `${person.name} ${person.login}`.toLocaleLowerCase('de').includes(search))
      .slice(0, maxResults);
  });
  /** Matches by heading, in the order the options came in. */
  const groups = $derived.by(() => {
    const result: { label: string; items: { person: SuchPerson; index: number }[] }[] = [];
    matches.forEach((person, index) => {
      const label = person.gruppe ?? '';
      const group = result.find((g) => g.label === label);
      if (group) group.items.push({ person, index });
      else result.push({ label, items: [{ person, index }] });
    });
    return result;
  });
  const expanded = $derived(open && matches.length > 0 && !disabled);

  function pick(person: SuchPerson): void {
    onpick(person);
    query = '';
    active = -1;
    open = false;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    } else if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!expanded) {
        open = true;
        active = down ? 0 : matches.length - 1;
      } else {
        active =
          active < 0
            ? down
              ? 0
              : matches.length - 1
            : (active + (down ? 1 : -1) + matches.length) % matches.length;
      }
    } else if (event.key === 'Enter' && query.trim()) {
      event.preventDefault();
      // The highlighted or first match; with the list closed (Escape) the typed text counts
      if (expanded) pick(matches[Math.max(0, active)]);
      else oncommit?.(query);
    } else if (event.key === 'Backspace' && !query && onremovelast) {
      event.preventDefault();
      onremovelast();
    }
  }
</script>

<div class="relative">
  <input
    bind:this={input}
    {...rest}
    {id}
    class={className}
    bind:value={query}
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={expanded}
    aria-controls="{id}-options"
    aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
    {disabled}
    oninput={() => {
      onedit?.();
      open = true;
      active = -1;
    }}
    onfocus={() => {
      open = true;
      active = -1;
    }}
    onblur={() => {
      if (query.trim()) oncommit?.(query);
      open = false;
    }}
    onkeydown={keydown}
  />
  <ul
    id="{id}-options"
    role="listbox"
    aria-label={listLabel}
    hidden={!expanded}
    class="surface absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg shadow-lg"
  >
    {#each groups as group (group.label)}
      {#snippet items()}
        {#each group.items as { person, index } (`${person.login}|${person.name}`)}
          <li role="none">
            <button
              type="button"
              role="option"
              id="{id}-option-{index}"
              aria-selected={active === index}
              tabindex="-1"
              class="w-full break-words px-3 py-2 text-left hover:bg-neutral-100"
              class:bg-neutral-100={active === index}
              onpointerdown={(event) => event.preventDefault()}
              onclick={() => pick(person)}>{person.name}</button
            >
          </li>
        {/each}
      {/snippet}
      {#if group.label}
        <li role="group" aria-label={group.label}>
          <span
            class="block px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-neutral-700 uppercase"
            aria-hidden="true">{group.label}</span
          >
          <ul role="none">{@render items()}</ul>
        </li>
      {:else}
        {@render items()}
      {/if}
    {/each}
  </ul>
</div>
