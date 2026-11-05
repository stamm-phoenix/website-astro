<script lang="ts">
  import { untrack } from 'svelte';
  import FormField from './FormField.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { personenPflege } from '../../lib/pflegeStore.svelte';
  import { filterVorschlaege } from '../../lib/vorschlaege';

  interface Props {
    value: string;
    error?: string;
    suggest: boolean;
  }
  let { value = $bindable(), error, suggest }: Props = $props();
  const store = personenPflege.state;
  const options = $derived(
    (store.data?.personen ?? [])
      .filter((person) => person.aktiv)
      .map((person) => ({ value: person.name, key: String(person.id) }))
  );
  const noMatches = $derived(
    suggest &&
      store.data !== null &&
      !store.loading &&
      value.trim() !== '' &&
      filterVorschlaege(options, value, 1).total === 0
  );
  $effect(() => {
    if (suggest) untrack(() => void personenPflege.load());
  });
</script>

<FormField id="ld-name" label="Name" {error}>
  {#snippet children(attrs)}
    {#if suggest}
      <VorschlagFeld
        {...attrs}
        bind:value
        {options}
        loading={store.loading}
        maxlength="100"
        listLabel="Person aus Personen auswählen"
        pickFirstOnEnter
      />
    {:else}
      <input {...attrs} class="form-input" maxlength="100" autocomplete="off" bind:value />
    {/if}
  {/snippet}
</FormField>
{#if suggest && store.error}
  <div role="status" class="text-sm text-danger">
    <p>Personenvorschläge konnten nicht geladen werden. Du kannst den Namen selbst eintragen.</p>
    <ActionButton type="button" onclick={() => void personenPflege.load({ force: true })}>
      Vorschläge erneut laden
    </ActionButton>
  </div>
{:else if noMatches}
  <p role="status" class="text-sm text-neutral-700">Keine passende Person gefunden.</p>
{/if}
