<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    taskPeople,
    taskAssigneeName,
    taskAssigneeLogin,
    type SharePointSiteUser,
  } from '../../../api/lib/aufgaben-zuordnung';
  import type { TaskPerson } from '../../../api/lib/aufgaben-model';
  import FormField from './pflege/FormField.svelte';

  interface Props {
    id: string;
    value: string;
    people?: TaskPerson[];
    users: SharePointSiteUser[];
    loading: boolean;
    unavailable: boolean;
    error?: string;
    onedit?: () => void;
  }
  let {
    id,
    value = $bindable(),
    people = $bindable(),
    users,
    loading,
    unavailable,
    error,
    onedit,
  }: Props = $props();
  let input = $state<HTMLInputElement | null>(null);
  let query = $state('');
  let rejected = $state<string | undefined>();
  let open = $state(false);
  let active = $state(-1);
  const selected = $derived(taskPeople({ assignee: value, assignees: people }, users));
  const matches = $derived(
    users
      .filter(
        (user) =>
          !selected.some((person) => person.login.toLowerCase() === user.login.toLowerCase()) &&
          `${user.name} ${user.login}`
            .toLocaleLowerCase('de')
            .includes(query.trim().toLocaleLowerCase('de'))
      )
      .slice(0, 8)
  );
  const expanded = $derived(open && matches.length > 0 && selected.length < 20);

  /** Keep the compatibility field in sync while saving all selected identities. */
  function update(next: TaskPerson[]): void {
    onedit?.();
    people = taskPeople({ assignee: '', assignees: next }, users);
    value = people[0]?.login || people[0]?.name || '';
    void tick().then(() => input?.dispatchEvent(new Event('change', { bubbles: true })));
  }
  /** Add a person as a removable tag, leaving the search ready for another selection. */
  function choose(user: TaskPerson): void {
    if (selected.length >= 20) return;
    update([...selected, user]);
    rejected = undefined;
    query = '';
    active = -1;
    open = false;
  }
  /** Preserve manual input when the directory is unavailable, without guessing a first-name match. */
  function commit(): void {
    rejected = undefined;
    const text = query.trim();
    if (!text) return;
    const user = users.find(
      (user) =>
        user.login.toLowerCase() === text.toLowerCase() ||
        user.name.toLocaleLowerCase('de') === text.toLocaleLowerCase('de')
    );
    const login = taskAssigneeLogin(text);
    if (!user && !login.includes('@')) {
      rejected = 'Bitte eine Person auswählen oder den vollständigen Namen bzw. Login eingeben.';
      return;
    }
    choose(
      user ?? { name: taskAssigneeName(text, users), login: login.includes('@') ? login : '' }
    );
  }
  // EditDialog validates on the server, so unresolved local text must stop submission here.
  onMount(() => {
    const form = input?.form;
    function validate(event: SubmitEvent): void {
      commit();
      if (!rejected) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input?.focus();
    }
    form?.addEventListener('submit', validate, true);
    return () => form?.removeEventListener('submit', validate, true);
  });
  /** Support keyboard selection and removing the last tag from an empty search. */
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    } else if (matches.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open = true;
      active =
        active < 0
          ? event.key === 'ArrowDown'
            ? 0
            : matches.length - 1
          : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    } else if (event.key === 'Enter' && query.trim()) {
      event.preventDefault();
      if (expanded) choose(matches[Math.max(0, active)]);
      else commit();
    } else if (event.key === 'Backspace' && !query && selected.length) {
      event.preventDefault();
      update(selected.slice(0, -1));
    }
  }
</script>

<FormField
  {id}
  label="Zuständigkeit"
  optional
  error={error ?? rejected}
  hint="Personen suchen und auswählen. Mehrere Personen sind möglich."
>
  {#snippet children(attrs)}
    <div class="space-y-2">
      <input type="hidden" name="{id}-people" value={JSON.stringify(selected)} />
      {#if selected.length}
        <ul aria-label="Zugewiesene Personen" class="flex flex-wrap gap-2">
          {#each selected as person (person.login || person.name)}
            <li
              class="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 pl-3 pr-1 text-sm"
            >
              <span class="min-w-0 break-words">{person.name}</span>
              <button
                type="button"
                class="shrink-0 min-h-9 min-w-9 rounded-full text-neutral-700 hover:text-danger"
                aria-label="{person.name} entfernen"
                onclick={() => update(selected.filter((item) => item !== person))}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <div class="relative">
        <input
          bind:this={input}
          {...attrs}
          class="form-input"
          bind:value={query}
          maxlength="254"
          autocomplete="off"
          placeholder="Person hinzufügen …"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls="{id}-options"
          aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
          oninput={() => {
            rejected = undefined;
            onedit?.();
            open = true;
            active = -1;
          }}
          onfocus={() => {
            open = true;
            active = -1;
          }}
          onblur={() => {
            commit();
            open = false;
          }}
          onkeydown={keydown}
          disabled={selected.length >= 20}
        />
        <ul
          id="{id}-options"
          role="listbox"
          aria-label="Person auswählen"
          hidden={!expanded}
          class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto surface rounded-lg shadow-lg"
        >
          {#each matches as user, index (user.login)}
            <li role="none">
              <button
                type="button"
                role="option"
                id="{id}-option-{index}"
                aria-selected={active === index}
                tabindex="-1"
                class="w-full px-3 py-2 text-left break-words hover:bg-neutral-100"
                class:bg-neutral-100={active === index}
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => choose(user)}>{user.name}</button
              >
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/snippet}
</FormField>
{#if loading}<p role="status" class="text-sm text-neutral-700">
    Personenvorschläge werden geladen …
  </p>
{:else if unavailable}<p role="status" class="text-sm text-neutral-700">
    Personenvorschläge sind gerade nicht verfügbar. Du kannst vollständige Namen eingeben.
  </p>{/if}
