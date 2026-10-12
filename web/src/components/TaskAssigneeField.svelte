<script lang="ts">
  import { taskAssigneeLogin, type SharePointSiteUser } from '../../../api/lib/aufgaben-zuordnung';
  import FormField from './pflege/FormField.svelte';

  interface Props {
    id: string;
    value: string;
    users: SharePointSiteUser[];
    loading: boolean;
    unavailable: boolean;
    error?: string;
  }
  let { id, value = $bindable(), users, loading, unavailable, error }: Props = $props();
  let open = $state(false);
  let active = $state(-1);
  const query = $derived(value.trim().toLocaleLowerCase('de'));
  const matches = $derived(
    users
      .filter((user) => `${user.name} ${user.login}`.toLocaleLowerCase('de').includes(query))
      .slice(0, 8)
  );
  const expanded = $derived(open && matches.length > 0);
  /** Store the selected login rather than the displayed name. */
  function choose(user: SharePointSiteUser): void {
    value = user.login;
    open = false;
    active = -1;
  }
  /** Keep selection usable with arrow keys, Enter and Escape inside the edit dialog. */
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
    } else if (expanded && event.key === 'Enter') {
      event.preventDefault();
      choose(matches[Math.max(0, active)]);
    }
  }
</script>

<FormField
  {id}
  label="Zuständigkeit"
  optional
  {error}
  hint="Name suchen und Person auswählen. Ein einzelner Vorname ohne Auswahl wird nicht automatisch zugeordnet."
>
  {#snippet children(attrs)}
    <div class="relative">
      <input
        {...attrs}
        class="form-input"
        bind:value
        maxlength="254"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls="{id}-options"
        aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
        oninput={() => {
          open = true;
          active = -1;
        }}
        onfocus={() => {
          open = true;
          active = -1;
        }}
        onblur={() => (open = false)}
        onkeydown={keydown}
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
              onclick={() => choose(user)}>{user.name}{' '}&lt;{user.login}&gt;</button
            >
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
</FormField>
{#if loading}<p role="status" class="text-sm text-neutral-700">
    Personenvorschläge werden geladen …
  </p>
{:else if unavailable}<p role="status" class="text-sm text-neutral-700">
    Personenvorschläge sind gerade nicht verfügbar. Du kannst den vollständigen Namen oder Login
    eingeben.
  </p>{/if}
{#if value && taskAssigneeLogin(value) !== value.trim()}
  <p class="text-sm text-neutral-700">Wird {taskAssigneeLogin(value)} zugewiesen.</p>
{/if}
