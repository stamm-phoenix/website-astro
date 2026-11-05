<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import MessageText from '../ui/MessageText.svelte';
  import type { Vorschlag } from '../../lib/vorschlaege';
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
  const options = $derived.by(() => {
    const result = new SvelteMap<string, Vorschlag>();
    const key = (login: string, fallback: string): string =>
      login.trim() ? login.trim().toLocaleLowerCase('de') : fallback;
    for (const konto of store.data?.leitende ?? []) {
      const id = key(konto.login, `name:${konto.name}`);
      if (!result.has(id)) result.set(id, { value: konto.name, key: id });
    }
    for (const person of store.data?.personen ?? []) {
      if (!person.aktiv || person.gruppe === 'leitende') continue;
      const id = key(person.login, `person:${person.id}`);
      if (!result.has(id)) result.set(id, { value: person.name, key: id });
    }
    return [...result.values()];
  });
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
        maxlength={100}
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
    <p><MessageText text={store.error} /></p>
    <ActionButton type="button" onclick={() => void personenPflege.load({ force: true })}>
      Vorschläge erneut laden
    </ActionButton>
  </div>
{:else if noMatches}
  <p role="status" class="text-sm text-neutral-700">Keine passende Person gefunden.</p>
{/if}
