<script lang="ts">
  import {
    ACTIVE_STATUSES,
    PROBLEM_LABEL,
    STATUS_CLASS,
    STATUS_LABEL,
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
  }

  type SortKey = 'slot' | 'name' | 'city' | 'children' | 'status';

  let { bookings, dates, problems = {}, onselect }: Props = $props();

  let day = $state('alle');
  let statuses = $state<NikolausBookingStatus[]>([...ACTIVE_STATUSES]);
  let krampus = $state<'alle' | 'ja' | 'nein'>('alle');
  let search = $state('');
  let onlyProblems = $state(false);
  const problemCount = $derived(Object.keys(problems).length);
  let sortKey = $state<SortKey>('slot');
  let sortAsc = $state(true);

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
  <span
    class="pill mt-1 border border-[var(--color-dpsg-red)] bg-[#f7e3e5] text-xs text-[var(--color-dpsg-red)]"
  >
    <span aria-hidden="true">⚠</span>
    {PROBLEM_LABEL[problem]}
  </span>
{/snippet}

<div class="space-y-4">
  <form
    class="surface grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end"
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
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
      />
    </label>

    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Tag</span>
      <select
        bind:value={day}
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
      >
        <option value="alle">Alle Tage</option>
        {#each dates as date (date)}
          <option value={date}>{formatShortDate(date)}</option>
        {/each}
      </select>
    </label>

    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Krampus</span>
      <select
        bind:value={krampus}
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
      >
        <option value="alle">Egal</option>
        <option value="ja">Mit Krampus</option>
        <option value="nein">Ohne Krampus</option>
      </select>
    </label>

    <fieldset class="text-sm md:col-span-2 lg:col-span-1">
      <legend class="font-semibold text-neutral-700">Status</legend>
      <div class="mt-1 flex flex-wrap gap-1.5">
        {#each STATUS_ORDER as status (status)}
          <button
            type="button"
            aria-pressed={statuses.includes(status)}
            onclick={() => toggleStatus(status)}
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition aria-[pressed=false]:border-neutral-300 aria-[pressed=false]:bg-white aria-[pressed=false]:text-neutral-700 {statuses.includes(
              status
            )
              ? STATUS_CLASS[status]
              : ''}"
          >
            {STATUS_LABEL[status]}
          </button>
        {/each}
      </div>
    </fieldset>

    {#if problemCount > 0 || onlyProblems}
      <label
        class="flex items-center gap-2 text-sm font-semibold text-[var(--color-dpsg-red)] md:col-span-2 lg:col-span-4"
      >
        <input
          type="checkbox"
          bind:checked={onlyProblems}
          class="size-4 accent-[var(--color-dpsg-red)]"
        />
        Nur Buchungen mit Problemen ({problemCount})
      </label>
    {/if}
  </form>

  <p class="text-sm text-neutral-700" aria-live="polite">
    {visible.length}
    {visible.length === 1 ? 'Anmeldung' : 'Anmeldungen'} · {childrenTotal} Kinder
  </p>

  {#if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">Keine Anmeldungen für diese Filter.</p>
  {:else}
    <!-- Desktop: table -->
    <div class="surface hidden overflow-x-auto md:block">
      <table class="w-full text-left text-sm">
        <thead
          class="border-b border-neutral-200 text-xs uppercase tracking-[0.06em] text-neutral-700"
        >
          <tr>
            {#each COLUMNS as column (column.key)}
              <th scope="col" class="px-4 py-3" aria-sort={ariaSort(column.key)}>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 font-semibold uppercase hover:text-brand-900"
                  onclick={() => sortBy(column.key)}
                >
                  {column.label}
                  <span aria-hidden="true" class="w-3 text-brand-800">
                    {sortKey === column.key ? (sortAsc ? '▲' : '▼') : ''}
                  </span>
                </button>
              </th>
            {/each}
            <th scope="col" class="px-4 py-3">Krampus</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Aktionen</span></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as booking (booking.id)}
            <tr
              class="border-b border-neutral-100 last:border-0 {problems[booking.id]
                ? 'bg-[#f7e3e5]/60 hover:bg-[#f7e3e5]'
                : 'hover:bg-[var(--color-brand-50)]/60'}"
            >
              <td class="whitespace-nowrap px-4 py-3 font-semibold text-brand-900">
                {formatSlotKey(booking.slotKey)}
              </td>
              <td class="px-4 py-3">{booking.familyName}</td>
              <td class="px-4 py-3">
                {booking.street}<br />
                <span class="text-neutral-700">{booking.postalCode} {booking.city}</span>
              </td>
              <td class="px-4 py-3 tabular-nums">{booking.childrenCount}</td>
              <td class="px-4 py-3">
                <span class="pill border text-xs {STATUS_CLASS[booking.status]}">
                  {STATUS_LABEL[booking.status]}
                </span>
                {#if problems[booking.id]}
                  {@render problemBadge(problems[booking.id])}
                {/if}
              </td>
              <td class="px-4 py-3">{booking.withKrampus ? 'Ja' : 'Nein'}</td>
              <td class="px-4 py-3 text-right">
                <button
                  type="button"
                  class="rounded-full border border-[var(--color-brand-300)] bg-white px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-[var(--color-brand-50)]"
                  onclick={() => onselect(booking)}
                >
                  Details<span class="sr-only"> zu Familie {booking.familyName}</span>
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Mobile: cards -->
    <div class="md:hidden">
      <label class="mb-3 flex items-center gap-2 text-sm">
        <span class="font-semibold text-neutral-700">Sortieren nach</span>
        <select
          bind:value={sortKey}
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 focus:border-brand-900 focus:outline-none"
        >
          {#each COLUMNS as column (column.key)}
            <option value={column.key}>{column.label}</option>
          {/each}
        </select>
        <button
          type="button"
          class="rounded-md border border-neutral-300 bg-white px-2 py-1"
          aria-label={sortAsc ? 'Absteigend sortieren' : 'Aufsteigend sortieren'}
          onclick={() => (sortAsc = !sortAsc)}
        >
          <span aria-hidden="true">{sortAsc ? '▲' : '▼'}</span>
        </button>
      </label>
      <ul class="space-y-3">
        {#each visible as booking (booking.id)}
          <li>
            <button
              type="button"
              class="card w-full text-left hover:border-[var(--color-brand-300)] {problems[
                booking.id
              ]
                ? 'border-[var(--color-dpsg-red)]!'
                : ''}"
              onclick={() => onselect(booking)}
            >
              <span class="flex items-start justify-between gap-3">
                <span class="font-semibold text-brand-900">{formatSlotKey(booking.slotKey)}</span>
                <span class="pill border text-xs {STATUS_CLASS[booking.status]}">
                  {STATUS_LABEL[booking.status]}
                </span>
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
