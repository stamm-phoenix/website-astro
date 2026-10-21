<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { formatIsoDate } from '../../lib/belege';
  import { formatEuro } from '../../lib/format';
  import {
    campflowKostenstellen,
    campflowStatusLabel,
    inCampflowSelection,
    isOwnCampflowBeleg,
    matchesCampflowSearch,
    sortCampflowBelege,
    type CampflowBelegFilter,
  } from '../../lib/campflowBelege';
  import { isIch } from '../../lib/ichStore.svelte';
  import type { CampflowBeleg, CampflowBelegeData } from '../../lib/types';

  interface Props {
    data: CampflowBelegeData;
    search: string;
    onlyMine: boolean;
    onopen: (beleg: CampflowBeleg) => void;
  }
  let { data, search, onlyMine, onopen }: Props = $props();

  /** Rows shown at first and added per click, so a phone stays quick with hundreds of them. */
  const PAGE = 60;
  const ALL = '';

  let costUnitId = $state(ALL);
  let categoryId = $state(ALL);
  let filter = $state<CampflowBelegFilter>('alle');
  let shown = $state(PAGE);

  const units = $derived(campflowKostenstellen(data));
  const categories = $derived(
    costUnitId === ALL ? [] : (units.find((unit) => unit.id === costUnitId)?.categories ?? [])
  );

  $effect(() => {
    // A Kostenstelle or Kategorie gone after reloading would hide receipts without a visible filter
    if (costUnitId !== ALL && !units.some((unit) => unit.id === costUnitId)) costUnitId = ALL;
    if (categoryId !== ALL && !categories.some((category) => category.id === categoryId))
      categoryId = ALL;
  });

  const selected = $derived(
    sortCampflowBelege(
      data.belege.filter(
        (beleg) =>
          inCampflowSelection(beleg, { costUnitId, categoryId }) &&
          matchesCampflowSearch(beleg, search) &&
          (!onlyMine || isOwnCampflowBeleg(beleg, isIch))
      )
    )
  );
  const visible = $derived(
    filter === 'alle' ? selected : selected.filter((beleg) => beleg.status === filter)
  );
  const count = (value: CampflowBelegFilter) =>
    value === 'alle' ? selected.length : selected.filter((beleg) => beleg.status === value).length;

  $effect(() => {
    // Back to the first rows whenever the filters change
    void [filter, costUnitId, categoryId, search, onlyMine];
    shown = PAGE;
  });

  function selectCostUnit(id: string): void {
    costUnitId = id;
    categoryId = ALL;
  }

  const where = (beleg: CampflowBeleg) =>
    [
      beleg.costUnits.map((unit) => unit.name).join(', '),
      beleg.categories.map((category) => category.name).join(', '),
    ]
      .filter(Boolean)
      .join(' · ');
</script>

<div class="space-y-4">
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Kostenstelle</span>
      <select
        class="form-input mt-1 w-full"
        value={costUnitId}
        onchange={(event) => selectCostUnit(event.currentTarget.value)}
      >
        <option value={ALL}>Alle Kostenstellen</option>
        {#each units as unit (unit.id)}
          <option value={unit.id}>{unit.name}{unit.archived ? ' (archiviert)' : ''}</option>
        {/each}
      </select>
    </label>
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Kategorie</span>
      <select class="form-input mt-1 w-full" bind:value={categoryId} disabled={costUnitId === ALL}>
        <option value={ALL}>Alle Kategorien</option>
        {#each categories as category (category.id)}
          <option value={category.id}>{category.name}</option>
        {/each}
      </select>
    </label>
  </div>
  <FilterTabs
    label="Nach Stand in CampFlow filtern"
    options={[
      { value: 'alle', label: 'Alle', count: count('alle') },
      { value: 'unbooked', label: 'Noch nicht gebucht', count: count('unbooked') },
      { value: 'open', label: 'Zahlung offen', count: count('open') },
      { value: 'settled', label: 'Bezahlt', count: count('settled') },
    ]}
    value={filter}
    onselect={(value) => (filter = value)}
    countNouns={['Beleg', 'Belege']}
  />

  {#if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">
      {data.belege.length === 0
        ? 'In CampFlow gibt es noch keine Belege.'
        : 'Keine Belege in CampFlow für diese Auswahl.'}
    </p>
  {:else}
    <ul
      class="divide-y divide-neutral-200 border-y border-neutral-200"
      aria-label="Belege in CampFlow"
    >
      {#each visible.slice(0, shown) as beleg (beleg.id)}
        {@const state = campflowStatusLabel(beleg)}
        <li>
          <button
            type="button"
            class="flex w-full flex-col gap-1 py-3 text-left hover:bg-neutral-50 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            onclick={() => onopen(beleg)}
          >
            <span class="min-w-0">
              <span class="block break-words font-semibold text-brand-900">
                {beleg.description || beleg.fileName || 'Ohne Beschreibung'}
              </span>
              <span class="block text-sm text-neutral-700">
                {[
                  beleg.number ? `Nr. ${beleg.number}` : '',
                  beleg.date ? formatIsoDate(beleg.date) : '',
                  where(beleg),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {#if beleg.paidBy}
                <span class="block text-sm text-neutral-700">
                  Ausgelegt von {beleg.paidBy}{#if isIch({ name: beleg.paidBy })}&nbsp;(ich){/if}
                </span>
              {/if}
            </span>
            <span class="shrink-0 sm:text-right">
              {#if beleg.status !== 'unbooked'}
                <span class="block font-semibold tabular-nums text-brand-900">
                  {formatEuro(Math.abs(beleg.amountCent))}
                </span>
              {/if}
              <StatusLabel label={state.label} tone={state.tone} dot />
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if visible.length > shown}
      <button type="button" class="btn-secondary" onclick={() => (shown += PAGE)}>
        Weitere {Math.min(PAGE, visible.length - shown)} von {visible.length - shown} anzeigen
      </button>
    {/if}
  {/if}
</div>
