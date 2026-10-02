<script lang="ts">
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
  <div
    class="flex flex-wrap gap-x-5 border-b border-neutral-200 print:hidden"
    role="group"
    aria-label="Ansicht wählen"
  >
    {#each VIEWS as option (option.key)}
      <button
        type="button"
        aria-pressed={view === option.key}
        onclick={() => selectView(option.key)}
        class="-mb-px min-h-11 border-b-2 border-transparent px-1 py-2 text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-[var(--color-dpsg-red)] aria-[pressed=true]:text-brand-900"
      >
        {option.label}
      </button>
    {/each}
  </div>

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
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <h2 class="text-lg font-semibold text-brand-900">Die Daten konnten nicht geladen werden</h2>
      <p class="mt-1 text-sm text-neutral-700">
        Bitte versuche es erneut. Falls das Problem bleibt, melde dich ab und wieder an.
      </p>
      <button
        type="button"
        class="btn-primary mt-4"
        onclick={() => (view === 'helfende' ? fetchHelfende() : fetchEinteilung())}
      >
        Erneut versuchen
      </button>
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
