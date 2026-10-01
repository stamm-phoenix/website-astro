<script lang="ts">
  import { untrack } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatEventRange } from '../lib/campflowFields';
  import type { CampflowEvent } from '../lib/types';

  const ALL = 'alle';
  const currentYear = String(new Date().getFullYear());
  const today = new Date().toISOString().slice(0, 10);

  let year = $state(currentYear);
  let folder = $state(ALL);
  let search = $state('');

  const monthFormatter = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const badgeMonth = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });

  function eventYear(event: CampflowEvent): string | null {
    return (event.start_date ?? event.end_date)?.slice(0, 4) ?? null;
  }

  function isPast(event: CampflowEvent): boolean {
    const end = event.end_date ?? event.start_date;
    return end !== null && end < today;
  }

  const events = $derived(campflowEventsStore.data ?? []);

  const years = $derived(
    [...new Set([currentYear, ...events.map(eventYear).filter((y): y is string => y !== null)])]
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

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return events
      .filter((e) => year === ALL || eventYear(e) === year)
      .filter((e) => folder === ALL || e.collection?.id === folder)
      .filter((e) => !query || e.title.toLowerCase().includes(query))
      .sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
  });

  /** Events grouped by the month they start in; events without date come last. */
  const groups = $derived.by(() => {
    const result: { label: string; events: CampflowEvent[] }[] = [];
    for (const event of visible) {
      const label = event.start_date
        ? monthFormatter.format(new Date(`${event.start_date.slice(0, 7)}-01T00:00:00Z`))
        : 'Ohne Datum';
      const group = result.at(-1);
      if (group && group.label === label) group.events.push(event);
      else result.push({ label, events: [event] });
    }
    return result;
  });

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('jahr');
      if (param && (param === ALL || /^\d{4}$/.test(param))) year = param;
      fetchCampflowEvents();
    });
  });

  function selectYear(value: string): void {
    year = value;
    const url = new URL(window.location.href);
    if (value === currentYear) url.searchParams.delete('jahr');
    else url.searchParams.set('jahr', value);
    history.replaceState(history.state, '', url);
  }
</script>

{#if !campflowEventsStore.data && campflowEventsStore.loading}
  <div role="status" aria-live="polite" class="border-t border-neutral-200 pt-5">
    <span class="sr-only">Aktionen werden geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
  </div>
{:else if !campflowEventsStore.data}
  <div role="alert" class="border-l-2 border-[var(--color-dpsg-red)] py-1 pl-4">
    <h2 class="text-lg font-semibold text-brand-900">Aktionen konnten nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">{campflowEventsStore.error}</p>
    <button
      type="button"
      class="btn-primary mt-4"
      onclick={() => fetchCampflowEvents({ force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
  <div class="space-y-8">
    <form
      class="grid gap-4 border-b border-neutral-200 pb-5 sm:grid-cols-[auto_auto_1fr] sm:items-end"
      role="search"
      aria-label="Aktionen filtern"
      onsubmit={(event) => event.preventDefault()}
    >
      <label class="block text-sm">
        <span class="form-label">Jahr</span>
        <select
          value={year}
          onchange={(event) => selectYear(event.currentTarget.value)}
          class="form-input"
        >
          {#each years as option (option)}
            <option value={option}>{option}</option>
          {/each}
          <option value={ALL}>Alle Jahre</option>
        </select>
      </label>

      {#if folders.length > 0}
        <label class="block text-sm">
          <span class="form-label">Ordner</span>
          <select bind:value={folder} class="form-input">
            <option value={ALL}>Alle Ordner</option>
            {#each folders as option (option.id)}
              <option value={option.id}>{option.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label class="block text-sm sm:col-start-3">
        <span class="form-label">Suche</span>
        <input
          type="search"
          bind:value={search}
          placeholder="Titel der Aktion …"
          class="form-input"
        />
      </label>
      <p class="text-sm text-neutral-700 sm:col-span-3" aria-live="polite">
        {visible.length}
        {visible.length === 1 ? 'Aktion' : 'Aktionen'}
        {year === ALL ? 'insgesamt' : `in ${year}`}
      </p>
    </form>

    {#if visible.length === 0}
      <p class="text-sm text-neutral-700">Keine Aktionen für diese Auswahl.</p>
    {:else}
      {#each groups as group (group.label)}
        <section aria-label={group.label}>
          <h2 class="font-serif text-xl font-semibold text-brand-900">
            {group.label}
          </h2>
          <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
            {#each group.events as event (event.id)}
              <li>
                <a
                  href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(event.id)}"
                  class="group flex items-start gap-4 py-4 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
                  class:opacity-70={isPast(event)}
                >
                  <span
                    class="flex w-12 shrink-0 flex-col items-center pt-0.5 text-center"
                    aria-hidden="true"
                  >
                    {#if event.start_date}
                      <span class="text-2xl font-semibold leading-none tabular-nums text-brand-900">
                        {Number(event.start_date.slice(8, 10))}
                      </span>
                      <span class="mt-1 text-xs font-semibold text-[var(--color-dpsg-red)]">
                        {badgeMonth.format(new Date(`${event.start_date}T00:00:00Z`))}
                      </span>
                    {:else}
                      <span class="text-2xl font-semibold leading-none text-neutral-500">–</span>
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span
                      class="block font-semibold leading-snug text-brand-900 group-hover:underline"
                    >
                      {event.title}
                    </span>
                    <span class="mt-1 block text-sm text-neutral-700">
                      {formatEventRange(event)}{event.max_persons
                        ? ` · max. ${event.max_persons} Plätze`
                        : ''}
                    </span>
                    <span
                      class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700"
                    >
                      <span
                        class="inline-flex items-center gap-1.5 font-semibold {event.published
                          ? 'text-[var(--color-dpsg-pfadfinder)]'
                          : 'text-neutral-700'}"
                      >
                        <span
                          aria-hidden="true"
                          class="size-2 rounded-full {event.published
                            ? 'bg-[var(--color-dpsg-pfadfinder)]'
                            : 'border border-neutral-500'}"
                        ></span>
                        {event.published ? 'Anmeldung offen' : 'Anmeldung geschlossen'}
                      </span>
                      {#if event.collection}
                        <span aria-hidden="true">·</span>
                        <span>{event.collection.name}</span>
                      {/if}
                      {#if event.archived}
                        <span aria-hidden="true">·</span>
                        <span>Archiviert</span>
                      {/if}
                    </span>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
{/if}
