<script lang="ts">
  import PersonSuche from '../ui/PersonSuche.svelte';
  import type { SuchPerson } from '../ui/PersonSuche.svelte';
  import { PERSON_GRUPPE_LABELS, personKey } from '../../lib/protokollEditor';
  import type { PersonOption, ProtokollPerson } from '../../lib/types';

  /**
   * Names in the minutes (#301): search Leitende, Altleitende and others like the Zuständigkeit
   * of the Aufgaben, or type any name for guests. A picked person keeps the login, a typed one
   * only the name.
   */
  interface Props {
    /** ID of the search input, for its label. */
    id: string;
    selected: ProtokollPerson[];
    personen: PersonOption[];
    max?: number;
    /** Name of the list of chosen people, for screen readers. */
    listLabel?: string;
    placeholder?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: 'true' | undefined;
  }
  let {
    id,
    selected = $bindable(),
    personen,
    max = 10,
    listLabel = 'Ausgewählte Personen',
    placeholder,
    ...attrs
  }: Props = $props();

  let query = $state('');
  const single = $derived(max === 1);
  const options = $derived<SuchPerson[]>(
    personen
      .filter((p) => !selected.some((s) => personKey(s) === personKey(p)))
      .map((p) => ({ login: p.login, name: p.name, gruppe: PERSON_GRUPPE_LABELS[p.gruppe] }))
  );

  function add(person: ProtokollPerson): void {
    if (selected.some((s) => personKey(s) === personKey(person))) return;
    // One person only: the new one replaces the old one
    if (single) selected.splice(0, selected.length, { ...person });
    else if (selected.length < max) selected.push({ ...person });
  }

  /** A typed name; one of the list brings its login along. */
  function commit(text: string): void {
    const name = text.trim().replace(/\s+/g, ' ');
    query = '';
    if (!name) return;
    const match = personen.find(
      (p) => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')
    );
    add(match ? { login: match.login, name: match.name } : { login: '', name });
  }
</script>

<div class="space-y-1.5">
  {#if selected.length > 0}
    <ul class="flex flex-wrap gap-1.5" aria-label={listLabel}>
      {#each selected as person, index (personKey(person))}
        <li
          class="inline-flex max-w-full items-center gap-1 border border-neutral-300 bg-neutral-100 pl-2.5 text-sm"
        >
          <span class="min-w-0 break-words">{person.name}</span>
          <button
            type="button"
            class="grid min-h-11 min-w-11 shrink-0 place-items-center border-l border-neutral-300 text-neutral-700 hover:text-danger"
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
        </li>
      {/each}
    </ul>
  {/if}
  {#if single || selected.length < max}
    <PersonSuche
      {...attrs}
      {id}
      class="form-input py-1"
      bind:query
      {options}
      maxlength={200}
      placeholder={placeholder ??
        (single && selected.length ? 'Andere Person wählen …' : 'Name suchen oder eingeben …')}
      onpick={(person) => add({ login: person.login, name: person.name })}
      oncommit={commit}
      onremovelast={single || selected.length === 0 ? undefined : () => selected.pop()}
    />
  {/if}
</div>
