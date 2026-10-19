<script lang="ts">
  import { onMount, tick } from 'svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import BeitraegeListe from './BeitraegeListe.svelte';
  import BeitraegeSammlungen from './BeitraegeSammlungen.svelte';
  import { beitraegeStore } from '../../lib/pflegeStore.svelte';
  import { formatDateTime } from '../../lib/format';
  import type { BeitraegeData } from '../../lib/types';

  const CAMPFLOW_URL = 'https://my.campflow.de/dpsg-stamm-phoenix-5629/fees';

  const store = beitraegeStore.state;
  /** `null` for the overview, `alle` for all Beiträge, else the ID of a Sammlung. */
  let view = $state<string | null>(null);
  let refreshed = $state('');
  /** Whether the last load asked CampFlow again, so „Erneut versuchen“ repeats that. */
  let refreshing = false;

  function readUrl(): void {
    const params = new URLSearchParams(window.location.search);
    view = params.get('ansicht') === 'alle' ? 'alle' : params.get('sammlung');
  }

  /** Opens a view without reloading the page; the back button returns to the one before. */
  /** Moves the focus to the heading of the new view, so keyboard and screen reader users land there. */
  async function focusView(): Promise<void> {
    await tick();
    const id = view ? 'beitraege-liste' : 'beitraege-sammlungen';
    document.getElementById(id)?.focus({ preventScroll: true });
  }

  function open(next: string | null): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('ansicht');
    url.searchParams.delete('sammlung');
    if (next === 'alle') url.searchParams.set('ansicht', 'alle');
    else if (next) url.searchParams.set('sammlung', next);
    history.pushState(history.state, '', url);
    view = next;
    refreshed = '';
    window.scrollTo({ top: 0 });
    void focusView();
  }

  async function refresh(): Promise<void> {
    refreshed = '';
    refreshing = true;
    await beitraegeStore.load({ force: true, param: true });
    if (!store.error) refreshed = 'Beiträge neu aus CampFlow geladen.';
  }

  onMount(() => {
    readUrl();
    window.addEventListener('popstate', readUrl);
    void beitraegeStore.load({ param: false });
    return () => window.removeEventListener('popstate', readUrl);
  });

  function sammlung(data: BeitraegeData) {
    return data.batches.find((batch) => batch.id === view) ?? null;
  }
</script>

<div class="space-y-6">
  <div
    class="flex flex-col gap-2 border-b border-neutral-200 pb-4 text-sm text-neutral-700 sm:flex-row sm:items-center sm:justify-between"
  >
    <p>
      Nur zum Nachschauen. Zahlungen zuordnen, Beiträge ändern oder anlegen geht weiterhin in
      <a
        href={CAMPFLOW_URL}
        class="text-link underline underline-offset-4"
        target="_blank"
        rel="noopener">CampFlow</a
      >.
    </p>
    {#if store.data}
      <span class="flex flex-wrap items-center gap-x-2">
        <span data-testid="beitraege-stand"
          >Stand aus CampFlow: {formatDateTime(store.data.loadedAt)} Uhr</span
        >
        <ReloadAction disabled={store.loading} onclick={refresh}>
          {store.loading ? 'Lädt … (bis zu 20 Sekunden)' : 'Neu aus CampFlow laden'}
        </ReloadAction>
      </span>
    {/if}
  </div>
  <p role="status" aria-live="polite" class="text-sm font-semibold text-success empty:hidden">
    {refreshed}
  </p>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Beiträge werden aus CampFlow geladen …"
    onretry={() => (refreshing ? refresh() : beitraegeStore.load({ force: true, param: false }))}
  >
    {#snippet skeleton()}
      <p class="mb-4 text-sm text-neutral-700">
        Beiträge werden aus CampFlow geladen. Das kann bis zu 20 Sekunden dauern.
      </p>
      <div class="space-y-3">
        {#each [1, 2, 3, 4] as n (n)}<div
            class="skeleton-element h-16 rounded-[var(--radius-lg)]"
          ></div>{/each}
      </div>
    {/snippet}
    {#snippet children(data: BeitraegeData)}
      {#if view === 'alle'}
        <BeitraegeListe fees={data.fees} title="Alle Beiträge" onback={() => open(null)} />
      {:else if view && sammlung(data)}
        {@const batch = sammlung(data)!}
        <BeitraegeListe
          fees={data.fees.filter((fee) => fee.batchId === batch.id)}
          title={batch.name}
          onback={() => open(null)}
        />
      {:else}
        {#if view}
          <p role="alert" class="border-l-2 border-danger py-1 pl-4 text-sm text-neutral-700">
            Diese Sammlung gibt es in CampFlow nicht mehr. Wähle unten eine andere.
          </p>
        {/if}
        <BeitraegeSammlungen batches={data.batches} fees={data.fees} onopen={open} />
      {/if}
    {/snippet}
  </LoadState>
</div>
