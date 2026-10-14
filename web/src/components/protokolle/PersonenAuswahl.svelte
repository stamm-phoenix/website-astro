<script lang="ts">
  import type { ProtokollPerson } from '../../lib/types';

  interface Props {
    /** ID of the text input, for its label. */
    id: string;
    selected: ProtokollPerson[];
    personen: ProtokollPerson[];
    max?: number;
  }
  let { id, selected = $bindable(), personen, max = 10 }: Props = $props();

  let query = $state('');
  const listId = $derived(`${id}-liste`);
  const options = $derived(
    personen.filter((p) => !selected.some((s) => s.name === p.name && s.login === p.login))
  );

  /** Adds the typed name; a name from the directory brings its login along. */
  function add(): void {
    const name = query.trim().replace(/\s+/g, ' ');
    if (!name || selected.length >= max) return;
    const match = personen.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const person = match ?? { login: '', name };
    if (!selected.some((s) => s.name.toLowerCase() === person.name.toLowerCase())) {
      selected.push({ ...person });
    }
    query = '';
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !query && selected.length > 0) {
      selected.pop();
    }
  }
</script>

<div class="flex flex-wrap items-center gap-1.5">
  {#each selected as person, index (index)}
    <span
      class="inline-flex items-center gap-1 rounded-full border border-neutral-300 py-0.5 pr-1 pl-2.5 text-sm"
    >
      {person.name}
      <button
        type="button"
        class="grid h-6 w-6 place-items-center rounded-full text-neutral-700 hover:bg-neutral-100"
        aria-label="{person.name} entfernen"
        onclick={() => selected.splice(index, 1)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18" /></svg
        >
      </button>
    </span>
  {/each}
  {#if selected.length < max}
    <input
      {id}
      type="text"
      class="form-input min-w-40 flex-1 py-1"
      list={listId}
      autocomplete="off"
      placeholder="Name eingeben und Enter"
      bind:value={query}
      {onkeydown}
      onchange={add}
    />
    <datalist id={listId}>
      {#each options as person (person.login || person.name)}
        <option value={person.name}></option>
      {/each}
    </datalist>
  {/if}
</div>
