<script lang="ts">
  import { untrack } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatDate, formatEventRange } from '../lib/campflowFields';
  import { isLikelyMatch } from '../lib/aktionMatch';
  import { aktionenPflege } from '../lib/pflegeStore.svelte';
  import type { AktionTarget, CampflowEvent, StaffAktion } from '../lib/types';
  import AktionDialog from './pflege/AktionDialog.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  /** A CampFlow event with its calendar entry, or a calendar entry without CampFlow event. */
  interface Row {
    key: string;
    event: CampflowEvent | null;
    entry: StaffAktion | null;
    title: string;
    start: string | null;
    end: string | null;
  }

  const ALL = 'alle';
  const currentYear = String(new Date().getFullYear());
  const today = new Date().toISOString().slice(0, 10);
  const calendar = aktionenPflege.state;

  let year = $state(currentYear);
  let folder = $state(ALL);
  let search = $state('');
  let target = $state<AktionTarget | null>(null);
  let message = $state<string | null>(null);

  const monthFormatter = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const badgeMonth = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });

  function rowYear(row: Row): string | null {
    return (row.start ?? row.end)?.slice(0, 4) ?? null;
  }

  function isPast(row: Row): boolean {
    const end = row.end ?? row.start;
    return end !== null && end < today;
  }

  function isLeitendeOnly(entry: StaffAktion): boolean {
    return entry.stufen.length === 1 && entry.stufen[0] === 'Leitende';
  }

  function formatRange(row: Row): string {
    if (row.event) return formatEventRange(row.event);
    const start = formatDate(row.start);
    const end = formatDate(row.end);
    if (!start || !end || start === end) return start || end || 'Ohne Datum';
    return `${start} – ${end}`;
  }

  const events = $derived(campflowEventsStore.data ?? []);
  const loaded = $derived(campflowEventsStore.data !== null || calendar.data !== null);

  const rows = $derived.by((): Row[] => {
    const entries = calendar.data?.items ?? [];
    const byEvent = new Map(entries.flatMap((e) => (e.campflowId ? [[e.campflowId, e]] : [])));
    const eventIds = new Set(events.map((e) => e.id));
    // Without CampFlow data linked entries cannot be matched; show them on their own meanwhile
    const matchable = campflowEventsStore.data !== null;
    return [
      ...events.map((event) => ({
        key: event.id,
        event,
        entry: byEvent.get(event.id) ?? null,
        title: event.title,
        start: event.start_date,
        end: event.end_date,
      })),
      ...entries
        .filter((e) => !e.campflowId || !matchable || !eventIds.has(e.campflowId))
        .map((entry) => ({
          key: `sp-${entry.id}`,
          event: null,
          entry,
          title: entry.title,
          start: entry.start || null,
          end: entry.end || null,
        })),
    ];
  });

  /** CampFlow events not yet in the calendar; existing entries can be linked to them. */
  const linkable = $derived(rows.flatMap((r) => (r.event && !r.entry ? [r.event] : [])));
  /** Calendar entries without CampFlow event, e.g. planned before the event was created. */
  const adoptable = $derived(
    campflowEventsStore.data ? rows.flatMap((r) => (!r.event && r.entry ? [r.entry] : [])) : []
  );

  /** Whether a row has a likely partner on the other side that it can be linked to. */
  function hasLikelyPartner(row: Row): boolean {
    if (row.event && !row.entry) return adoptable.some((e) => isLikelyMatch(row.event!, e));
    if (!row.event && row.entry && campflowEventsStore.data)
      return linkable.some((e) => isLikelyMatch(e, row.entry!));
    return false;
  }

  const years = $derived(
    [...new Set([currentYear, ...rows.map(rowYear).filter((y): y is string => y !== null)])]
      .sort()
      .reverse()
  );

  const folders = $derived(
    Object.values(
      Object.fromEntries(
        events.flatMap((e) => (e.collection ? [[e.collection.id, e.collection] as const] : []))
      )
    ).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  );

  /** Newest first; rows without date come last. */
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((r) => year === ALL || rowYear(r) === year)
      .filter((r) => folder === ALL || r.event?.collection?.id === folder)
      .filter((r) => !query || r.title.toLowerCase().includes(query))
      .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  });

  /** Rows grouped by the month they start in; rows without date come last. */
  const groups = $derived.by(() => {
    const result: { label: string; rows: Row[] }[] = [];
    for (const row of visible) {
      const label = row.start
        ? monthFormatter.format(new Date(`${row.start.slice(0, 7)}-01T00:00:00Z`))
        : 'Ohne Datum';
      const group = result.at(-1);
      if (group && group.label === label) group.rows.push(row);
      else result.push({ label, rows: [row] });
    }
    return result;
  });

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('jahr');
      if (param && (param === ALL || /^\d{4}$/.test(param))) year = param;
      fetchCampflowEvents();
      aktionenPflege.load();
    });
  });

  function selectYear(value: string): void {
    year = value;
    const url = new URL(window.location.href);
    if (value === currentYear) url.searchParams.delete('jahr');
    else url.searchParams.set('jahr', value);
    history.replaceState(history.state, '', url);
  }

  function reload(): void {
    fetchCampflowEvents({ force: true });
    aktionenPflege.load({ force: true });
  }

  async function saved(text: string): Promise<void> {
    message = text;
    target = null;
    await aktionenPflege.load({ force: true });
  }
</script>

{#if !loaded && (campflowEventsStore.loading || calendar.loading)}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Aktionen werden geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
  </div>
{:else if !loaded}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Aktionen konnten nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">
      {campflowEventsStore.error ?? calendar.error}
    </p>
    <button
      type="button"
      class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
      onclick={reload}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
  <div class="space-y-6">
    <div class="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        class="btn-secondary"
        disabled={campflowEventsStore.loading || calendar.loading}
        onclick={reload}>Neu laden</button
      >
      <button
        type="button"
        class="btn-primary"
        disabled={!calendar.data}
        onclick={() => (target = { event: null, entry: null })}>Neue Aktion ohne CampFlow</button
      >
    </div>

    <StatusNotice {message} />

    {#each [{ error: campflowEventsStore.error, label: 'Die Aktionen aus CampFlow' }, { error: calendar.error, label: 'Der öffentliche Kalender' }] as problem (problem.label)}
      {#if problem.error}
        <div role="alert" class="surface border-l-4! border-l-[var(--color-dpsg-red)]! p-5">
          <p class="text-sm text-neutral-700">
            {problem.label} konnte nicht geladen werden: {problem.error}
          </p>
          <button
            type="button"
            class="btn-secondary mt-3"
            disabled={campflowEventsStore.loading || calendar.loading}
            onclick={reload}>Erneut versuchen</button
          >
        </div>
      {/if}
    {/each}

    <form
      class="surface grid gap-4 p-4 sm:grid-cols-[auto_auto_1fr] sm:items-end"
      role="search"
      aria-label="Aktionen filtern"
      onsubmit={(event) => event.preventDefault()}
    >
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Jahr</span>
        <select
          value={year}
          onchange={(event) => selectYear(event.currentTarget.value)}
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
        >
          {#each years as option (option)}
            <option value={option}>{option}</option>
          {/each}
          <option value={ALL}>Alle Jahre</option>
        </select>
      </label>

      {#if folders.length > 0}
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Ordner</span>
          <select
            bind:value={folder}
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
          >
            <option value={ALL}>Alle Ordner</option>
            {#each folders as option (option.id)}
              <option value={option.id}>{option.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label class="block text-sm sm:col-start-3">
        <span class="font-semibold text-neutral-700">Suche</span>
        <input
          type="search"
          bind:value={search}
          placeholder="Titel der Aktion …"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
        />
      </label>
    </form>

    <p class="text-sm text-neutral-700" aria-live="polite">
      {visible.length}
      {visible.length === 1 ? 'Aktion' : 'Aktionen'}
      {year === ALL ? 'insgesamt' : `in ${year}`}
    </p>

    {#if visible.length === 0}
      <p class="surface p-6 text-sm text-neutral-700">Keine Aktionen für diese Auswahl.</p>
    {:else}
      {#each groups as group (group.label)}
        <section aria-label={group.label}>
          <h2 class="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-brand-900">
            <span class="size-1.5 rounded-full bg-[var(--color-accent-500)]" aria-hidden="true"
            ></span>
            {group.label}
          </h2>
          <ul class="grid gap-3">
            {#each group.rows as row (row.key)}
              <li
                class="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                class:opacity-70={isPast(row)}
              >
                <div class="flex min-w-0 flex-1 items-start gap-4">
                  <span
                    class="flex size-14 shrink-0 flex-col items-center justify-center rounded-md border border-[var(--color-neutral-200)] bg-gradient-to-br from-[var(--color-brand-50)] to-white"
                    aria-hidden="true"
                  >
                    {#if row.start}
                      <span class="text-xs font-semibold uppercase text-[var(--color-accent-500)]">
                        {badgeMonth.format(new Date(`${row.start}T00:00:00Z`))}
                      </span>
                      <span class="text-xl font-bold leading-none text-brand-900">
                        {Number(row.start.slice(8, 10))}
                      </span>
                    {:else}
                      <span class="text-xl font-bold text-brand-900">?</span>
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    {#if row.event}
                      <a
                        href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(
                          row.event.id
                        )}"
                        class="block font-semibold leading-snug text-brand-900 underline-offset-2 hover:underline"
                      >
                        {row.title}<span aria-hidden="true" class="ml-1 text-brand-700">→</span>
                      </a>
                    {:else}
                      <span class="block font-semibold leading-snug text-brand-900">
                        {row.title || 'Aktion ohne Titel'}
                      </span>
                    {/if}
                    <span class="mt-1 block text-sm text-neutral-700">
                      {formatRange(row)}{row.event?.max_persons
                        ? ` · max. ${row.event.max_persons} Plätze`
                        : ''}
                    </span>
                    <span class="mt-2 flex flex-wrap gap-1.5">
                      {#if row.entry}
                        <span
                          class="inline-flex items-center rounded bg-[var(--color-dpsg-blue)] px-2 py-0.5 text-xs font-medium text-white"
                        >
                          {isLeitendeOnly(row.entry)
                            ? 'Leitenden-Kalender'
                            : row.event
                              ? 'Öffentlich im Kalender'
                              : 'Öffentlich · ohne CampFlow'}
                        </span>
                        {#each row.entry.stufen as stufe (stufe)}
                          <span
                            class="inline-flex items-center rounded bg-[var(--color-brand-50)] px-2 py-0.5 text-xs font-medium text-brand-800"
                          >
                            {stufe}
                          </span>
                        {/each}
                      {/if}
                      {#if row.event}
                        <span
                          class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium {row
                            .event.published
                            ? 'bg-[#e3f1e8] text-[var(--color-dpsg-pfadfinder)]'
                            : 'bg-[var(--color-neutral-100)] text-neutral-700'}"
                        >
                          {row.event.published ? 'Anmeldung offen' : 'Anmeldung geschlossen'}
                        </span>
                        {#if row.event.collection}
                          <span
                            class="inline-flex items-center rounded bg-[var(--color-brand-50)] px-2 py-0.5 text-xs font-medium text-brand-800"
                          >
                            {row.event.collection.name}
                          </span>
                        {/if}
                        {#if row.event.archived}
                          <span
                            class="inline-flex items-center rounded bg-[var(--color-neutral-100)] px-2 py-0.5 text-xs font-medium text-neutral-700"
                          >
                            Archiviert
                          </span>
                        {/if}
                      {:else if row.entry?.campflowId && campflowEventsStore.data}
                        <span
                          class="inline-flex items-center rounded bg-[#fff1e0] px-2 py-0.5 text-xs font-medium text-[#8a4a00]"
                        >
                          CampFlow-Aktion gelöscht
                        </span>
                      {/if}
                      {#if hasLikelyPartner(row)}
                        <span
                          class="inline-flex items-center rounded bg-[#fff1e0] px-2 py-0.5 text-xs font-medium text-[#8a4a00]"
                        >
                          {row.event
                            ? 'Vorab angelegter Eintrag gefunden – beim Veröffentlichen übernehmen'
                            : 'Passende CampFlow-Aktion gefunden – jetzt verknüpfen'}
                        </span>
                      {/if}
                    </span>
                  </span>
                </div>
                {#if calendar.data && (row.event || !row.entry?.campflowId || campflowEventsStore.data)}
                  <button
                    type="button"
                    class="{row.entry
                      ? 'btn-secondary'
                      : 'btn-primary'} shrink-0 self-start sm:self-center"
                    aria-label="{row.entry
                      ? 'Kalendereintrag bearbeiten'
                      : 'Im öffentlichen Kalender veröffentlichen'}: {row.title}"
                    disabled={calendar.loading}
                    onclick={() => (target = { event: row.event, entry: row.entry })}
                  >
                    {row.entry ? 'Bearbeiten' : 'Veröffentlichen'}
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
{/if}

<AktionDialog
  {target}
  stufen={calendar.data?.stufen ?? []}
  {linkable}
  {adoptable}
  onsaved={saved}
  onclose={() => (target = null)}
/>
