<script lang="ts">
  import { onMount } from 'svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadButton from '../pflege/ReloadButton.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import EssenZutaten from './EssenZutaten.svelte';
  import EssenListe from './EssenListe.svelte';

  /**
   * The central lists all Planungen share: ingredients, categories and allergens. Same data and
   * rights as the Steuerung (teams Admin and Vorstand), on a page of its own.
   */

  const store = essensplanungSteuerung.state;
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');

  function onnotice(text: string | null, kind: 'success' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  onMount(() => {
    essensplanungSteuerung.load();
  });
</script>

<div class="space-y-8">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" popup />
    <ReloadButton resource={essensplanungSteuerung} />
  </div>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Zutatenliste wird geladen …"
    onretry={() => void essensplanungSteuerung.load({ force: true })}
  >
    {#snippet skeleton()}
      <div class="skeleton-element h-96 rounded-[var(--radius-lg)]"></div>
    {/snippet}
    {#snippet children(data)}
      <EssenZutaten {data} {onnotice} />
      <div class="grid gap-8 lg:grid-cols-2">
        <EssenListe
          {onnotice}
          liste="kategorien"
          title="Kategorien"
          intro="Wie im Supermarkt; die Einkaufsliste ist danach sortiert. Eine Kategorie lässt sich erst löschen, wenn keine Zutat mehr dazugehört."
          items={data.kategorien}
        />
        <EssenListe
          {onnotice}
          liste="unvertraeglichkeiten"
          title="Allergene und Unverträglichkeiten"
          intro="Die 14 Hauptallergene der EU sind fest dabei und lassen sich nur umbenennen. Weitere, z. B. Fructose, kannst du ergänzen."
          items={data.unvertraeglichkeiten}
        />
      </div>
    {/snippet}
  </LoadState>
</div>
