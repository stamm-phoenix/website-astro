<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { inventurPflege } from '../../lib/inventurStore.svelte';
  import {
    INVENTAR_KATEGORIEN,
    INVENTAR_ZUSTAENDE,
    KATEGORIE_LABELS,
    KEIN_FILTER,
    ZUSTAND_LABELS,
    ZUSTAND_TONES,
    filterInventar,
    lagerorte as lagerorteVon,
    letzteZaehlung,
    nameAusLogin,
    variantenText,
  } from '../../lib/inventur';
  import type { InventarArtikel, InventarFilter } from '../../lib/inventur';
  import InventurArtikelDialog from './InventurArtikelDialog.svelte';
  import InventurZaehlenDialog from './InventurZaehlenDialog.svelte';

  /**
   * Inventur (#107): the stock of the Stammesmaterial with size or motif, storage place,
   * condition, missing parts and the last count. Works in the storage room on a phone.
   */
  const store = inventurPflege.state;
  let filter = $state<InventarFilter>({ ...KEIN_FILTER });
  let message = $state<string | null>(null);
  /** The open dialog: an article to change (`null` for a new one) or one to count. */
  let bearbeiten = $state<{ artikel: InventarArtikel | null } | null>(null);
  let zaehlen = $state<InventarArtikel | null>(null);

  const alle = $derived(store.data ?? []);
  const lagerorte = $derived(lagerorteVon(alle));
  const treffer = $derived(filterInventar(alle, filter));
  const gefiltert = $derived(
    filter.suche.trim() !== '' ||
      filter.kategorie !== 'alle' ||
      filter.lagerort !== '' ||
      filter.zustand !== 'alle'
  );

  $effect(() => {
    untrack(() => void inventurPflege.load());
  });

  const KATEGORIE_OPTIONEN = [
    { value: 'alle' as const, label: 'Alle' },
    ...INVENTAR_KATEGORIEN.map((value) => ({ value, label: KATEGORIE_LABELS[value] })),
  ];

  async function reload(): Promise<void> {
    await inventurPflege.load({ force: true });
  }

  /** Loads the articles again and returns the current version of one of them. */
  async function reloadArtikel(id: number): Promise<InventarArtikel | null> {
    await inventurPflege.load({ force: true });
    return store.data?.find((a) => a.id === id) ?? null;
  }

  async function done(text: string): Promise<void> {
    bearbeiten = null;
    zaehlen = null;
    message = text;
    await inventurPflege.load({ force: true });
  }

  function gezaehltText(artikel: InventarArtikel): string {
    const letzte = letzteZaehlung(artikel);
    if (!letzte) return 'Noch nicht gezählt';
    const datum = new Date(letzte.am).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
    return letzte.von
      ? `Gezählt am ${datum} von ${nameAusLogin(letzte.von)}`
      : `Gezählt am ${datum}`;
  }

  function zuruecksetzen(): void {
    filter = { ...KEIN_FILTER };
  }
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full sm:max-w-sm">
      <label for="inventur-suche" class="form-label">Material suchen</label>
      <input
        id="inventur-suche"
        type="search"
        class="form-input"
        placeholder="z. B. Pulli, Kohte, Gaskocher"
        bind:value={filter.suche}
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <ReloadAction type="button" disabled={store.loading} onclick={() => void reload()}
        >Neu laden</ReloadAction
      >
      <ActionButton
        variant="primary"
        type="button"
        disabled={!store.data}
        onclick={() => (bearbeiten = { artikel: null })}>Neuer Artikel</ActionButton
      >
    </div>
  </div>

  <div class="space-y-3">
    <FilterTabs
      label="Kategorie"
      options={KATEGORIE_OPTIONEN}
      value={filter.kategorie}
      onselect={(value) => (filter.kategorie = value)}
      countNouns={['Artikel', 'Artikel']}
    />
    <div class="grid max-w-xl grid-cols-2 gap-3">
      <div>
        <label for="inventur-lagerort" class="form-label">Lagerort</label>
        <select id="inventur-lagerort" class="form-input" bind:value={filter.lagerort}>
          <option value="">Alle Lagerorte</option>
          {#each lagerorte as ort (ort)}
            <option value={ort}>{ort}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="inventur-zustand" class="form-label">Zustand</label>
        <select id="inventur-zustand" class="form-input" bind:value={filter.zustand}>
          <option value="alle">Alle Zustände</option>
          {#each INVENTAR_ZUSTAENDE as zustand (zustand)}
            <option value={zustand}>{ZUSTAND_LABELS[zustand]}</option>
          {/each}
          <option value="fehlt">Teile fehlen oder defekt</option>
        </select>
      </div>
    </div>
  </div>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Material wird geladen …"
    onretry={() => void reload()}
    isEmpty={() => treffer.length === 0}
  >
    {#snippet empty()}
      {#if alle.length === 0}
        <div class="border-t border-neutral-200 pt-5">
          <h2 class="font-serif text-xl text-brand-900">Noch kein Material erfasst</h2>
          <ActionButton
            variant="primary"
            type="button"
            class="mt-3"
            onclick={() => (bearbeiten = { artikel: null })}>Ersten Artikel anlegen</ActionButton
          >
        </div>
      {:else}
        <div class="border-t border-neutral-200 pt-5" role="status">
          <p>Kein Artikel passt zu deiner Auswahl.</p>
          <ActionButton variant="secondary" type="button" class="mt-3" onclick={zuruecksetzen}
            >Auswahl zurücksetzen</ActionButton
          >
        </div>
      {/if}
    {/snippet}
    {#if gefiltert}
      <p class="text-sm text-neutral-700" role="status">
        {treffer.length} von {alle.length} Artikeln
      </p>
    {/if}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each treffer as artikel (artikel.id)}
        {@const varianten = variantenText(artikel)}
        <li class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-1">
            <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
              {artikel.bezeichnung}
            </p>
            <p class="text-sm text-neutral-700">
              {KATEGORIE_LABELS[artikel.kategorie]}{artikel.lagerort
                ? ` · ${artikel.lagerort}`
                : ''}
            </p>
            <p class="text-neutral-900">
              <span class="font-semibold">{artikel.bestand} {artikel.einheit}</span>
              {#if varianten}<span class="text-neutral-700"> · {varianten}</span>{/if}
            </p>
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              {#if artikel.zustand !== 'gut'}
                <StatusLabel
                  label={ZUSTAND_LABELS[artikel.zustand]}
                  tone={ZUSTAND_TONES[artikel.zustand]}
                  dot
                />
              {/if}
              {#if artikel.fehlend}
                <StatusLabel label="Teile fehlen oder defekt" tone="warning" dot />
              {/if}
            </div>
            {#if artikel.fehlend}
              <p class="text-sm text-neutral-900 [overflow-wrap:anywhere]">{artikel.fehlend}</p>
            {/if}
            <p class="text-sm text-neutral-700">{gezaehltText(artikel)}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <ActionButton
              variant="secondary"
              type="button"
              aria-label={`Zählen: ${artikel.bezeichnung}`}
              onclick={() => (zaehlen = artikel)}>Zählen</ActionButton
            >
            <ActionButton
              variant="secondary"
              type="button"
              aria-label={`Bearbeiten: ${artikel.bezeichnung}`}
              onclick={() => (bearbeiten = { artikel })}>Bearbeiten</ActionButton
            >
          </div>
        </li>
      {/each}
    </ul>
  </LoadState>
</div>

{#if bearbeiten}
  {#key bearbeiten.artikel?.id ?? 'neu'}
    <InventurArtikelDialog
      artikel={bearbeiten.artikel}
      {lagerorte}
      onreload={reloadArtikel}
      ondone={done}
      onclose={() => (bearbeiten = null)}
    />
  {/key}
{/if}
{#if zaehlen}
  {#key zaehlen.id}
    <InventurZaehlenDialog
      artikel={zaehlen}
      onreload={reloadArtikel}
      ondone={done}
      onclose={() => (zaehlen = null)}
    />
  {/key}
{/if}
