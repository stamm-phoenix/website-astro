<script lang="ts">
  import FilterTabs from './ui/FilterTabs.svelte';
  import LoadState from './ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { fetchPrincipal } from '../lib/authStore.svelte';
  import { confirmAction } from '../lib/confirm';
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
  /** Switching the view unmounts the Einteilung together with its unsaved draft. */
  let einteilungDirty = $state(false);

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('ansicht');
      if (param === 'einteilung' || param === 'helfende' || param === 'stufen') view = param;
      void fetchPrincipal();
      void fetchHelfende();
      void fetchEinteilung();
    });
  });

  async function selectView(next: View): Promise<void> {
    if (
      view === 'einteilung' &&
      next !== view &&
      einteilungDirty &&
      !(await confirmAction({
        title: 'Ansicht wechseln?',
        message:
          'Die Einteilung ist noch nicht gespeichert. Ansicht trotzdem wechseln? Die Änderungen gehen dabei verloren.',
        confirmLabel: 'Änderungen verwerfen',
      }))
    ) {
      return;
    }
    view = next;
    const url = new URL(window.location.href);
    url.searchParams.set('ansicht', next);
    history.replaceState(history.state, '', url);
  }

  /** Reloads helpers and Einteilung after a change that affects both. */
  async function reloadAll(): Promise<void> {
    await Promise.all([fetchHelfende(), fetchEinteilung()]);
  }

  const store = $derived(view === 'helfende' ? helfendeStore : einteilungStore);
</script>

<div class="space-y-6">
  <FilterTabs
    label="Ansicht wählen"
    variant="segmented"
    options={VIEWS.map((option) => ({ value: option.key, label: option.label }))}
    value={view}
    onselect={selectView}
    class="border-b border-neutral-200"
  />

  {#if view === 'stufen'}
    <NikolausStufenAbgleich onchanged={reloadAll} />
  {:else}
    <LoadState
      data={store.data}
      loading={store.loading}
      error={store.error}
      onretry={() => void (view === 'helfende' ? fetchHelfende() : fetchEinteilung())}
    >
      {#snippet skeleton()}
        <div class="surface p-6">
          <div class="skeleton-element h-6 w-56 rounded"></div>
          <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
        </div>
      {/snippet}
      {#if view === 'helfende' && helfendeStore.data}
        <NikolausHelfendeList data={helfendeStore.data} onchanged={reloadAll} />
      {:else if view === 'einteilung' && einteilungStore.data}
        <NikolausEinteilung data={einteilungStore.data} bind:dirty={einteilungDirty} />
      {/if}
    </LoadState>
  {/if}
</div>
