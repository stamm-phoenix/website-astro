<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import {
    taskPeople,
    taskAssigneeName,
    type SharePointSiteUser,
  } from '../../../api/lib/aufgaben-zuordnung';
  import type { TaskPerson } from '../../../api/lib/aufgaben-model';
  import FormField from './pflege/FormField.svelte';
  import PersonSuche from './ui/PersonSuche.svelte';

  interface Props {
    id: string;
    people?: TaskPerson[];
    users: SharePointSiteUser[];
    loading: boolean;
    unavailable: boolean;
    configurationError?: boolean;
    error?: string;
    onedit?: () => void;
  }
  let {
    id,
    people = $bindable(),
    users,
    loading,
    unavailable,
    configurationError = false,
    error,
    onedit,
  }: Props = $props();
  const notifyEdited = getContext<(() => void) | undefined>('form-edited');
  let input = $state<HTMLInputElement | null>(null);
  let query = $state('');
  let rejected = $state<string | undefined>();
  const selected = $derived(taskPeople({ assignee: '', assignees: people }, users));
  const options = $derived(
    users.filter(
      (user) => !selected.some((person) => person.login.toLowerCase() === user.login.toLowerCase())
    )
  );

  /** Save selected identities and notify the enclosing form of composite-field edits. */
  function update(next: TaskPerson[]): void {
    onedit?.();
    people = taskPeople({ assignee: '', assignees: next }, users);
    notifyEdited?.();
  }
  /** Add a person as a removable tag, leaving the search ready for another selection. */
  function choose(user: TaskPerson): void {
    if (selected.length >= 20) return;
    update([...selected, user]);
    rejected = undefined;
    query = '';
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
    const login = text.includes('@') ? text.toLowerCase() : '';
    const fullName = /^[\p{L}][\p{L} .’'-]*\s+[\p{L}][\p{L} .’'-]*$/u.test(text);
    if (!user && !login && !fullName) {
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
      <PersonSuche
        {...attrs}
        bind:input
        bind:query
        options={options.map((user) => ({ login: user.login, name: user.name }))}
        maxlength={254}
        placeholder="Person hinzufügen …"
        disabled={selected.length >= 20}
        onedit={() => {
          rejected = undefined;
          onedit?.();
        }}
        onpick={(person) => choose(person)}
        oncommit={commit}
        onremovelast={selected.length ? () => update(selected.slice(0, -1)) : undefined}
      />
    </div>
  {/snippet}
</FormField>
{#if loading}<p role="status" class="text-sm text-neutral-700">
    Personenvorschläge werden geladen …
  </p>
{:else if unavailable}<p role="status" class="text-sm text-neutral-700">
    {configurationError
      ? 'Die Personenliste ist nicht vollständig eingerichtet. Bitte die Administration informieren.'
      : 'Personenvorschläge sind gerade nicht verfügbar.'} Du kannst vollständige Namen eingeben.
  </p>{/if}
