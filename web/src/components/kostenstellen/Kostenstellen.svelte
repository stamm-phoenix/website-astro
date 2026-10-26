<script lang="ts">
  import { onMount } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import KostenstellenZahlen from './KostenstellenZahlen.svelte';
  import { kostenstellenStore } from '../../lib/pflegeStore.svelte';
  import {
    buchungen,
    gesamt,
    inAnsicht,
    kategorien,
    SORTIERUNGEN,
    SPHAEREN,
    sortiere,
    treffer,
    type KostenstellenAnsicht,
    type KostenstellenSortierung,
  } from '../../lib/kostenstellen';
  import type { KostenstelleStatistik, KostenstellenData } from '../../lib/types';

  const CAMPFLOW_URL = 'https://my.campflow.de/dpsg-stamm-phoenix-5629/finance/reports/expenses';

  const store = kostenstellenStore.state;
  let ansicht = $state<KostenstellenAnsicht>('aktuell');
  let sortierung = $state<KostenstellenSortierung>('name');
  let suche = $state('');
  let refreshed = $state('');
  /** Whether the last load asked CampFlow again, so „Erneut versuchen“ repeats that. */
  let refreshing = false;

  async function refresh(): Promise<void> {
    refreshed = '';
    refreshing = true;
    await kostenstellenStore.load({ force: true, param: true });
    if (!store.error) refreshed = 'Kostenstellen neu aus CampFlow geladen.';
  }

  onMount(() => {
    void kostenstellenStore.load({ param: false });
  });

  function sichtbar(data: KostenstellenData): KostenstelleStatistik[] {
    return sortiere(
      data.costUnits.filter((k) => inAnsicht(k, ansicht) && treffer(k, suche) !== null),
      sortierung
    );
  }

  function tabs(data: KostenstellenData) {
    const count = (value: KostenstellenAnsicht): number =>
      data.costUnits.filter((k) => inAnsicht(k, value)).length;
    return [
      { value: 'aktuell' as const, label: 'Aktuelle', count: count('aktuell') },
      { value: 'archiviert' as const, label: 'Archivierte', count: count('archiviert') },
      { value: 'alle' as const, label: 'Alle', count: count('alle') },
    ];
  }
</script>

<div class="space-y-5">
  <div
    class="flex flex-col gap-2 border-b border-neutral-200 pb-4 text-sm text-neutral-700 sm:flex-row sm:items-center sm:justify-between"
  >
    <a
      href={CAMPFLOW_URL}
      class="inline-flex min-h-11 items-center text-link underline underline-offset-4"
      target="_blank"
      rel="noopener">Auswertungen in CampFlow öffnen</a
    >
    {#if store.data}
      <ReloadAction
        loadedAt={Date.parse(store.data.loadedAt)}
        disabled={store.loading}
        onclick={refresh}
      >
        {store.loading ? 'Lädt … (bis zu 20 Sekunden)' : 'Neu aus CampFlow laden'}
      </ReloadAction>
    {/if}
  </div>
  <p role="status" aria-live="polite" class="text-sm font-semibold text-success empty:hidden">
    {refreshed}
  </p>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Kostenstellen werden aus CampFlow geladen …"
    onretry={() =>
      refreshing ? refresh() : kostenstellenStore.load({ force: true, param: false })}
  >
    {#snippet skeleton()}
      <p class="mb-4 text-sm text-neutral-700">
        Kostenstellen werden aus CampFlow geladen. Das kann bis zu 20 Sekunden dauern.
      </p>
      <div class="space-y-3">
        {#each [1, 2, 3, 4] as n (n)}<div
            class="skeleton-element h-20 rounded-[var(--radius-lg)]"
          ></div>{/each}
      </div>
    {/snippet}
    {#snippet children(data: KostenstellenData)}
      {@const liste = sichtbar(data)}
      {@const summe = gesamt(liste)}
      <section aria-labelledby="kostenstellen-gesamt" class="surface-muted space-y-2 p-4">
        <h2 id="kostenstellen-gesamt" class="font-semibold text-brand-900">
          Summe aus {liste.length}
          {liste.length === 1 ? 'Kostenstelle' : 'Kostenstellen'}
        </h2>
        <KostenstellenZahlen summen={summe} gross />
      </section>

      <div class="space-y-3">
        <FilterTabs
          label="Kostenstellen zeigen"
          options={tabs(data)}
          value={ansicht}
          onselect={(value) => (ansicht = value)}
          countNouns={['Kostenstelle', 'Kostenstellen']}
        />
        <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label class="block w-full text-sm sm:w-72">
            <span class="font-semibold text-neutral-700">Suche</span>
            <input
              type="search"
              bind:value={suche}
              placeholder="Kostenstelle oder Kategorie"
              class="form-input mt-1 w-full"
            />
          </label>
          <label class="block w-full text-sm sm:w-56">
            <span class="font-semibold text-neutral-700">Sortieren nach</span>
            <select bind:value={sortierung} class="form-input mt-1 w-full">
              {#each SORTIERUNGEN as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>

      {#if liste.length === 0}
        <p class="surface p-6 text-sm text-neutral-700">
          {suche.trim()
            ? 'Keine Kostenstelle und keine Kategorie passt zur Suche.'
            : ansicht === 'archiviert'
              ? 'In CampFlow ist keine Kostenstelle archiviert.'
              : 'In CampFlow gibt es noch keine Kostenstellen.'}
        </p>
      {:else}
        <ul class="space-y-3" aria-label="Kostenstellen">
          {#each liste as kostenstelle (kostenstelle.id ?? `name:${kostenstelle.name}`)}
            {@const nurKategorie = treffer(kostenstelle, suche) === 'kategorie'}
            <li class="surface">
              <details open={nurKategorie || undefined} class="group">
                <summary
                  class="flex min-h-11 cursor-pointer list-none flex-col gap-3 p-4 [&::-webkit-details-marker]:hidden"
                >
                  <span class="flex items-start gap-2">
                    <span
                      class="mt-1.5 size-3 shrink-0 rounded-full border border-neutral-300"
                      style:background={kostenstelle.color ?? 'transparent'}
                      aria-hidden="true"
                    ></span>
                    <span class="min-w-0 flex-1">
                      <span class="block font-semibold break-words text-brand-900"
                        >{kostenstelle.name}</span
                      >
                      <span class="block text-sm text-neutral-700">
                        {buchungen(kostenstelle.bookings)} · {kostenstelle.categories.length}
                        {kostenstelle.categories.length === 1 ? 'Kategorie' : 'Kategorien'}
                        {#if kostenstelle.archived}· Archiviert{/if}
                        {#if kostenstelle.id === null}· nicht mehr in CampFlow{/if}
                      </span>
                    </span>
                    <svg
                      class="mt-1 size-5 shrink-0 text-neutral-700 transition-transform group-open:rotate-180"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
                    >
                  </span>
                  <KostenstellenZahlen summen={kostenstelle} />
                </summary>

                <div class="border-t border-neutral-200 px-4 pb-4">
                  <h3 class="sr-only">Kategorien von {kostenstelle.name}</h3>
                  {#if kostenstelle.categories.length === 0}
                    <p class="pt-3 text-sm text-neutral-700">Keine Kategorien.</p>
                  {:else}
                    <ul class="divide-y divide-neutral-200">
                      {#each kategorien(kostenstelle, sortierung) as kategorie (kategorie.id ?? `name:${kategorie.name}`)}
                        <li class="space-y-2 py-3">
                          <p class="text-sm">
                            <span class="font-semibold text-brand-900">{kategorie.name}</span>
                            <span class="text-neutral-700"
                              >· {[
                                buchungen(kategorie.bookings),
                                kategorie.sphere && SPHAEREN[kategorie.sphere],
                              ]
                                .filter(Boolean)
                                .join(' · ')}</span
                            >
                          </p>
                          <KostenstellenZahlen summen={kategorie} />
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              </details>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </LoadState>
</div>
