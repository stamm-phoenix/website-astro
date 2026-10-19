<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { formatDate } from '../../lib/campflowFields';
  import { formatEuro } from '../../lib/format';
  import {
    kostenstellen,
    matchesFilter,
    matchesSearch,
    statusLabel,
    summen,
    type BeitragFilter,
  } from '../../lib/beitraege';
  import type { Beitrag } from '../../lib/types';

  interface Props {
    fees: Beitrag[];
    title: string;
    onback: () => void;
  }
  let { fees, title, onback }: Props = $props();

  /** Rows shown at first and added per click, so a phone stays quick with hundreds of them. */
  const PAGE = 100;
  const ALL = '';

  let filter = $state<BeitragFilter>('alle');
  let kostenstelle = $state(ALL);
  let search = $state('');
  let shown = $state(PAGE);

  const units = $derived(kostenstellen(fees));
  const inUnit = $derived(
    kostenstelle === ALL ? fees : fees.filter((fee) => fee.costUnit?.id === kostenstelle)
  );
  const searched = $derived(inUnit.filter((fee) => matchesSearch(fee, search)));
  const visible = $derived(searched.filter((fee) => matchesFilter(fee, filter)));
  const sums = $derived(summen(visible));
  const count = (value: BeitragFilter) =>
    searched.filter((fee) => matchesFilter(fee, value)).length;

  $effect(() => {
    // Back to the first rows whenever the filters change.
    void [filter, kostenstelle, search];
    shown = PAGE;
  });

  function back(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onback();
  }
</script>

<section aria-labelledby="beitraege-liste" class="space-y-4">
  <a
    href="?"
    class="inline-flex min-h-11 items-center text-sm text-link underline underline-offset-4"
    onclick={back}>← Alle Sammlungen</a
  >
  <h2 id="beitraege-liste" tabindex="-1" class="outline-none font-serif text-2xl text-brand-900">
    {title}
  </h2>

  <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
    <label class="block w-full text-sm sm:w-72">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input
        type="search"
        bind:value={search}
        placeholder="Name oder Verwendungszweck"
        class="form-input mt-1 w-full"
      />
    </label>
    {#if units.length > 1}
      <label class="block w-full text-sm sm:w-72">
        <span class="font-semibold text-neutral-700">Kostenstelle</span>
        <select bind:value={kostenstelle} class="form-input mt-1 w-full">
          <option value={ALL}>Alle Kostenstellen</option>
          {#each units as unit (unit.id)}<option value={unit.id}>{unit.name}</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  <FilterTabs
    label="Nach Zahlungsstand filtern"
    options={[
      { value: 'alle', label: 'Alle', count: count('alle') },
      { value: 'offen', label: 'Noch offen', count: count('offen') },
      { value: 'bezahlt', label: 'Bezahlt', count: count('bezahlt') },
      { value: 'erstatten', label: 'Zu erstatten', count: count('erstatten') },
      { value: 'storniert', label: 'Storniert', count: count('storniert') },
    ]}
    value={filter}
    onselect={(value) => (filter = value)}
    countNouns={['Beitrag', 'Beiträge']}
  />

  {#if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">
      {search.trim() ? 'Kein Beitrag passt zur Suche.' : 'Keine Beiträge mit diesem Zahlungsstand.'}
    </p>
  {:else}
    <p class="text-sm text-neutral-700" data-testid="beitraege-summe">
      {visible.length}
      {visible.length === 1 ? 'Beitrag' : 'Beiträge'} · fällig {formatEuro(sums.dueCent)} · bezahlt
      {formatEuro(sums.paidCent)}{#if sums.openCent > 0}&nbsp;· offen {formatEuro(
          sums.openCent
        )}{/if}{#if sums.refundCent > 0}&nbsp;· zu erstatten {formatEuro(sums.refundCent)}{/if}
    </p>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Beiträge">
      {#each visible.slice(0, shown) as fee (fee.id)}
        {@const state = statusLabel(fee)}
        <li class="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div class="min-w-0">
            <p class="font-semibold text-brand-900">{fee.payer || 'Ohne Namen'}</p>
            <p class="text-sm text-neutral-700">
              {[fee.costUnit?.name, fee.description].filter(Boolean).join(' · ')}
            </p>
            <p class="text-sm text-neutral-700">
              {#if fee.reference}Verwendungszweck {fee.reference} ·{/if}
              angelegt am {formatDate(fee.date)}
            </p>
          </div>
          <div class="shrink-0 sm:text-right">
            <p class="font-semibold tabular-nums text-brand-900">
              {#if fee.status === 'cancelled'}<s>{formatEuro(fee.amountCent)}</s>{:else}{formatEuro(
                  fee.dueCent
                )}{/if}
            </p>
            <StatusLabel label={state.label} tone={state.tone} dot />
            {#if fee.paidAt && fee.status !== 'unpaid'}
              <p class="text-sm text-neutral-700">Zahlung am {formatDate(fee.paidAt)}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if visible.length > shown}
      <button type="button" class="btn-secondary" onclick={() => (shown += PAGE)}>
        Weitere {Math.min(PAGE, visible.length - shown)} von {visible.length - shown} anzeigen
      </button>
    {/if}
  {/if}
</section>
