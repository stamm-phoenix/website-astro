<script lang="ts">
  import FilterTabs from './ui/FilterTabs.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { fetchPrincipal } from '../lib/authStore.svelte';
  import {
    einteilungStore,
    fetchEinteilung,
    fetchHelfende,
    helfendeStore,
  } from '../lib/nikolausHelfendeStore.svelte';
  import NikolausHelfendeList from './NikolausHelfendeList.svelte';
  import NikolausEinteilung from './NikolausEinteilung.svelte';
  import NikolausStufenAbgleich from './NikolausStufenAbgleich.svelte';

  type View = 'helfende' | 'einteilung' | 'stufen';
  const VIEWS: { key: View; label: string }[] = [
    { key: 'helfende', label: 'Helfende' },
    { key: 'einteilung', label: 'Einteilung' },
    { key: 'stufen', label: 'Stufen-Abgleich' },
  ];

  let view = $state<View>('helfende');

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('ansicht');
      if (param === 'einteilung' || param === 'helfende' || param === 'stufen') view = param;
      void fetchPrincipal();
      void fetchHelfende();
      void fetchEinteilung();
    });
  });

  function selectView(next: View): void {
    view = next;
    const url = new URL(window.location.href);
    url.searchParams.set('ansicht', next);
    history.replaceState(history.state, '', url);
  }

  const store = $derived(view === 'helfende' ? helfendeStore : einteilungStore);
</script>

<div class="space-y-6">
  <FilterTabs
    label="Ansicht wählen"
    options={VIEWS.map((option) => ({ value: option.key, label: option.label }))}
    value={view}
    onselect={selectView}
    class="border-b border-neutral-200 print:hidden"
  />

  {#if view === 'stufen'}
    <NikolausStufenAbgleich
      onchanged={async () => {
        await Promise.all([fetchHelfende(), fetchEinteilung()]);
      }}
    />
  {:else if !store.data && (store.loading || !store.error)}
    <div role="status" aria-live="polite" class="surface p-6">
      <span class="sr-only">Wird geladen …</span>
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    </div>
  {:else if !store.data}
    <div role="alert" class="surface p-6 border-l-4! border-l-danger!">
      <h2 class="text-lg font-semibold text-brand-900">Die Daten konnten nicht geladen werden</h2>
      <p class="mt-1 text-sm text-neutral-700">
        Bitte versuche es erneut. Falls das Problem bleibt, melde dich ab und wieder an.
      </p>
      <ActionButton
        variant="primary"
        type="button"
        class="mt-4"
        onclick={() => (view === 'helfende' ? fetchHelfende() : fetchEinteilung())}
      >
        Erneut versuchen
      </ActionButton>
    </div>
  {:else if view === 'helfende' && helfendeStore.data}
    <NikolausHelfendeList
      data={helfendeStore.data}
      onchanged={async () => {
        await Promise.all([fetchHelfende(), fetchEinteilung()]);
      }}
    />
  {:else if einteilungStore.data}
    <NikolausEinteilung data={einteilungStore.data} />
  {/if}
</div>
