<script lang="ts">
  import StatusLabel from './ui/StatusLabel.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import {
    ACTIVE_STATUSES,
    PROBLEM_LABEL,
    STATUS_LABEL,
    STATUS_TONE,
    STATUS_ORDER,
    formatShortDate,
    formatSlotKey,
  } from '../lib/nikolausAdmin';
  import type { BookingProblem } from '../lib/nikolausAdmin';
  import type { NikolausBookingStatus, StaffNikolausBooking } from '../lib/types';

  interface Props {
    bookings: StaffNikolausBooking[];
    dates: string[];
    /** Bookings that need attention, e.g. in an overbooked slot. */
    problems?: Record<string, BookingProblem>;
    onselect: (booking: StaffNikolausBooking) => void;
    /** Told the bookings the list shows and its active filters in words, e.g. for the PDF. */
    onshown?: (shown: { bookings: StaffNikolausBooking[]; filters: string[] }) => void;
  }

  type SortKey = 'slot' | 'name' | 'city' | 'children' | 'status';

  let { bookings, dates, problems = {}, onselect, onshown }: Props = $props();

  let day = $state('alle');
  let statuses = $state<NikolausBookingStatus[]>([...ACTIVE_STATUSES]);
  let krampus = $state<'alle' | 'ja' | 'nein'>('alle');
  let search = $state('');
  let onlyProblems = $state(false);
  const problemCount = $derived(Object.keys(problems).length);
  let sortKey = $state<SortKey>('slot');
  let sortAsc = $state(true);
  const allStatuses = $derived(
    statuses.length === STATUS_ORDER.length &&
      STATUS_ORDER.every((status) => statuses.includes(status))
  );
  const activeFilters = $derived(
    Number(search.trim() !== '') +
      Number(day !== 'alle') +
      Number(krampus !== 'alle') +
      Number(onlyProblems) +
      Number(!allStatuses)
  );
  /** The active filters in words, in the summary and in the PDF. */
  const filterWords = $derived(
    [
      search.trim() ? `Suche „${search.trim()}“` : '',
      day !== 'alle' ? formatShortDate(day) : '',
      krampus !== 'alle' ? (krampus === 'ja' ? 'Mit Krampus' : 'Ohne Krampus') : '',
      onlyProblems ? 'Nur mit Problemen' : '',
      allStatuses
        ? ''
        : STATUS_ORDER.filter((status) => statuses.includes(status))
            .map((status) => STATUS_LABEL[status])
            .join(', ') || 'Kein Status',
    ].filter(Boolean)
  );

  function resetFilters(): void {
    search = '';
    day = 'alle';
    statuses = [...STATUS_ORDER];
    krampus = 'alle';
    onlyProblems = false;
  }

  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: 'slot', label: 'Termin' },
    { key: 'name', label: 'Familie' },
    { key: 'city', label: 'Adresse' },
    { key: 'children', label: 'Kinder' },
    { key: 'status', label: 'Status' },
  ];

  const collator = new Intl.Collator('de');

  function compare(a: StaffNikolausBooking, b: StaffNikolausBooking): number {
    switch (sortKey) {
      case 'name':
        return collator.compare(a.familyName, b.familyName);
      case 'city':
        return (
          collator.compare(`${a.postalCode} ${a.city}`, `${b.postalCode} ${b.city}`) ||
          collator.compare(a.street, b.street)
        );
      case 'children':
        return a.childrenCount - b.childrenCount;
      case 'status':
        return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      default:
        return a.slotKey.localeCompare(b.slotKey);
    }
  }

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return bookings
      .filter((b) => day === 'alle' || b.slotKey.startsWith(day))
      .filter((b) => statuses.includes(b.status))
      .filter((b) => !onlyProblems || b.id in problems)
      .filter((b) => krampus === 'alle' || b.withKrampus === (krampus === 'ja'))
      .filter(
        (b) =>
          !query ||
          [b.familyName, b.street, b.postalCode, b.city, b.email, b.phone]
            .join(' ')
            .toLowerCase()
            .includes(query)
      )
      .sort((a, b) => {
        const result = compare(a, b) || a.slotKey.localeCompare(b.slotKey);
        return sortAsc ? result : -result;
      });
  });

  const childrenTotal = $derived(visible.reduce((sum, b) => sum + b.childrenCount, 0));

  $effect(() => {
    onshown?.({ bookings: visible, filters: filterWords });
  });

  function toggleStatus(status: NikolausBookingStatus): void {
    statuses = statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status];
  }

  function sortBy(key: SortKey): void {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  }
</script>

{#snippet problemBadge(problem: BookingProblem)}
  <span class="mt-1 flex items-center gap-1 text-xs font-semibold text-danger">
    <span aria-hidden="true">⚠</span>
    {PROBLEM_LABEL[problem]}
  </span>
{/snippet}

{#snippet statusLabel(value: NikolausBookingStatus)}
  <StatusLabel label={STATUS_LABEL[value]} tone={STATUS_TONE[value]} dot />
{/snippet}

<div class="space-y-4">
  <form
    class="space-y-3"
    role="search"
    aria-label="Anmeldungen filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input
        type="search"
        bind:value={search}
        placeholder="Name, Adresse, E-Mail …"
        class="form-input"
      />
    </label>
    <details class="border-y border-neutral-200 py-2">
      <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand-900"
        >Filter ({activeFilters} aktiv){activeFilters
          ? `: ${filterWords.join(' · ')}`
          : ''}</summary
      >
      <div class="grid gap-4 py-3 md:grid-cols-2 lg:grid-cols-[auto_auto_1fr] lg:items-end">
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Tag</span>
          <select bind:value={day} class="form-input">
            <option value="alle">Alle Tage</option>
            {#each dates as date (date)}
              <option value={date}>{formatShortDate(date)}</option>
            {/each}
          </select>
        </label>

        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Krampus</span>
          <select bind:value={krampus} class="form-input">
            <option value="alle">Egal</option>
            <option value="ja">Mit Krampus</option>
            <option value="nein">Ohne Krampus</option>
          </select>
        </label>

        <fieldset class="text-sm md:col-span-2 lg:col-span-1">
          <legend class="font-semibold text-neutral-700">Status</legend>
          <div class="mt-1 flex flex-wrap gap-x-4">
            {#each STATUS_ORDER as value (value)}
              <button
                type="button"
                aria-pressed={statuses.includes(value)}
                onclick={() => toggleStatus(value)}
                class="inline-flex min-h-11 items-center gap-1.5 border-b-2 border-transparent text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-accent-500 aria-[pressed=true]:text-brand-900"
              >
                <StatusLabel label={STATUS_LABEL[value]} tone={STATUS_TONE[value]} dot />
              </button>
            {/each}
          </div>
        </fieldset>

        {#if problemCount > 0 || onlyProblems}
          <label
            class="flex items-center gap-2 text-sm font-semibold text-danger md:col-span-2 lg:col-span-3"
          >
            <input type="checkbox" bind:checked={onlyProblems} class="size-4 accent-action" />
            Nur Buchungen mit Problemen ({problemCount})
          </label>
        {/if}
      </div>
      <div class="md:hidden">
        <div class="mb-3 flex items-end gap-2 text-sm">
          <label class="flex-1">
            <span class="font-semibold text-neutral-700">Sortieren nach</span>
            <select bind:value={sortKey} class="form-input">
              {#each COLUMNS as column (column.key)}
                <option value={column.key}>{column.label}</option>
              {/each}
            </select>
          </label>
          <ActionButton
            variant="secondary"
            type="button"
            aria-label={sortAsc ? 'Absteigend sortieren' : 'Aufsteigend sortieren'}
            onclick={() => (sortAsc = !sortAsc)}
          >
            <span aria-hidden="true">{sortAsc ? '▲' : '▼'}</span>
          </ActionButton>
        </div>
      </div>
      {#if activeFilters > 0}
        <ActionButton type="button" variant="secondary" class="mb-3" onclick={resetFilters}
          >Filter zurücksetzen</ActionButton
        >
      {/if}
    </details>
  </form>

  <p class="text-sm text-neutral-700" aria-live="polite">
    {visible.length}
    {visible.length === 1 ? 'Anmeldung' : 'Anmeldungen'} · {childrenTotal} Kinder
  </p>

  {#if visible.length === 0}
    <p class="border-t border-neutral-200 py-6 text-sm text-neutral-700">
      Keine Anmeldungen für diese Filter.
    </p>
    {#if activeFilters > 0}
      <ActionButton type="button" variant="secondary" onclick={resetFilters}
        >Filter zurücksetzen</ActionButton
      >
    {/if}
  {:else}
    <!-- Desktop: table -->
    <div class="hidden overflow-x-auto md:block">
      <table class="w-full text-left text-sm">
        <thead class="border-b-2 border-neutral-300 text-neutral-700">
          <tr>
            {#each COLUMNS as column (column.key)}
              <th scope="col" class="px-3 py-2" aria-sort={ariaSort(column.key)}>
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center gap-1 font-semibold hover:text-brand-900"
                  onclick={() => sortBy(column.key)}
                >
                  {column.label}
                  <span aria-hidden="true" class="w-3 text-brand-800">
                    {sortKey === column.key ? (sortAsc ? '▲' : '▼') : ''}
                  </span>
                </button>
              </th>
            {/each}
            <th scope="col" class="px-3 py-2 font-semibold">Krampus</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200">
          {#each visible as booking (booking.id)}
            <tr
              class="hover:bg-[var(--color-brand-50)]/60 {problems[booking.id]
                ? 'shadow-[inset_3px_0_0_var(--color-danger)]'
                : ''}"
            >
              <td class="whitespace-nowrap px-3 py-3 font-semibold text-brand-900">
                {formatSlotKey(booking.slotKey)}
              </td>
              <td class="px-3 py-3">
                <ActionButton
                  type="button"
                  variant="secondary"
                  class="border-0! bg-transparent! px-0! text-left! text-link! hover:underline"
                  onclick={() => onselect(booking)}
                >
                  Familie {booking.familyName}
                </ActionButton>
              </td>
              <td class="px-3 py-3">
                {booking.street}<br />
                <span class="text-neutral-700">{booking.postalCode} {booking.city}</span>
              </td>
              <td class="px-3 py-3 tabular-nums">{booking.childrenCount}</td>
              <td class="px-3 py-3">
                {@render statusLabel(booking.status)}
                {#if problems[booking.id]}
                  {@render problemBadge(problems[booking.id])}
                {/if}
              </td>
              <td class="px-3 py-3">{booking.withKrampus ? 'Ja' : 'Nein'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Mobile: ruled list -->
    <div class="md:hidden">
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each visible as booking (booking.id)}
          <li>
            <button
              type="button"
              class="block w-full px-2 py-3 text-left hover:bg-[var(--color-brand-50)] active:bg-[var(--color-brand-50)] {problems[
                booking.id
              ]
                ? 'shadow-[inset_3px_0_0_var(--color-danger)]'
                : ''}"
              onclick={() => onselect(booking)}
            >
              <span class="flex items-start justify-between gap-3">
                <span class="font-semibold text-brand-900">{formatSlotKey(booking.slotKey)}</span>
                {@render statusLabel(booking.status)}
              </span>
              {#if problems[booking.id]}
                <span class="mt-1 block">{@render problemBadge(problems[booking.id])}</span>
              {/if}
              <span class="mt-1 block font-semibold">Familie {booking.familyName}</span>
              <span class="block text-sm text-neutral-700">
                {booking.street}, {booking.postalCode}
                {booking.city}
              </span>
              <span class="mt-1 block text-sm text-neutral-700">
                {booking.childrenCount}
                {booking.childrenCount === 1 ? 'Kind' : 'Kinder'}{booking.withKrampus
                  ? ' · mit Krampus'
                  : ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
