<script lang="ts">
  import LoadState from '../ui/LoadState.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { untrack } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import { kjrFristStand, kjrRestzeit } from '../../lib/kjrFristen';
  import { localDate } from '../../lib/dateUtils';
  import { countNights } from '../../lib/kjrZuschuss';
  import type { CampflowEvent } from '../../lib/types';

  const today = localDate();

  let showArchive = $state(false);
  let search = $state('');

  const byStartDesc = (a: CampflowEvent, b: CampflowEvent): number =>
    (b.start_date ?? '').localeCompare(a.start_date ?? '') || a.title.localeCompare(b.title, 'de');
  const events = $derived(campflowEventsStore.data ?? []);
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return events
      .filter((e) => e.archived === showArchive)
      .filter((e) => !query || e.title.toLowerCase().includes(query))
      .sort(byStartDesc);
  });

  function status(event: CampflowEvent): { label: string; className: string } {
    const start = event.start_date;
    const end = event.end_date ?? start;
    if (!start || !end)
      return { label: 'Ohne Datum', className: 'bg-neutral-100 text-neutral-700' };
    if (end < today) return { label: 'Vorbei', className: 'bg-action/10 text-brand-900' };
    if (start <= today) {
      return {
        label: 'Läuft',
        className: 'bg-success/15 text-success',
      };
    }
    return { label: 'Geplant', className: 'bg-warning-soft text-warning' };
  }

  function duration(event: CampflowEvent): string {
    if (!event.start_date) return '';
    const nights = countNights(event.start_date, event.end_date ?? event.start_date);
    if (nights === 0) return 'Eintägig';
    return nights === 1 ? '1 Übernachtung' : `${nights} Übernachtungen`;
  }

  $effect(() => {
    untrack(() => {
      const params = new URLSearchParams(window.location.search);
      // Links from before the Aktionen had their own page
      const legacy = params.get('aktion') ?? '';
      if (/^evt_[A-Za-z0-9]+$/.test(legacy)) {
        const kostenstelle = params.get('kostenstelle');
        window.location.replace(
          `/leitendenbereich/abrechnung/${legacy}${
            kostenstelle ? `?kostenstelle=${encodeURIComponent(kostenstelle)}` : ''
          }`
        );
        return;
      }
      showArchive = params.get('archiv') === '1';
      fetchCampflowEvents();
    });
  });

  function changeArchive(archived: boolean): void {
    showArchive = archived;
    const url = new URL(window.location.href);
    if (archived) url.searchParams.set('archiv', '1');
    else url.searchParams.delete('archiv');
    history.replaceState(history.state, '', url);
  }
</script>

<LoadState
  data={campflowEventsStore.data}
  loading={campflowEventsStore.loading}
  error={campflowEventsStore.error}
  loadingText="Aktionen werden geladen …"
  onretry={() => fetchCampflowEvents({ force: true })}
>
  {#snippet skeleton()}
    <div class="surface p-6">
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-16 w-full rounded"></div>
      <div class="skeleton-element mt-3 h-16 w-full rounded"></div>
    </div>
  {/snippet}
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <FilterTabs
        label="Aktionen auswählen"
        options={[
          { value: 'aktuell', label: 'Aktuell', count: events.filter((e) => !e.archived).length },
          { value: 'archiv', label: 'Archiviert', count: events.filter((e) => e.archived).length },
        ]}
        value={showArchive ? 'archiv' : 'aktuell'}
        onselect={(value) => changeArchive(value === 'archiv')}
        countNouns={['Aktion', 'Aktionen']}
      />
      <label class="block w-full text-sm sm:w-72">
        <span class="font-semibold text-neutral-700">Suche</span>
        <input
          type="search"
          bind:value={search}
          placeholder="Name der Aktion"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 focus:border-brand-900 focus:outline-none"
        />
      </label>
    </div>

    {#if visible.length === 0}
      <p class="surface p-6 text-sm text-neutral-700">
        {search.trim()
          ? 'Keine Aktion passt zur Suche.'
          : showArchive
            ? 'Keine archivierten Aktionen.'
            : 'Keine Aktionen in CampFlow.'}
      </p>
    {:else}
      <ul class="grid gap-3" aria-label="Aktionen">
        {#each visible as event (event.id)}
          {@const state = status(event)}
          {@const fristStand = kjrFristStand(event, today)}
          <li>
            <a
              href={`/leitendenbereich/abrechnung/${event.id}`}
              class="surface flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-brand-900 focus-visible:outline-2 focus-visible:outline-brand-900"
            >
              <span class="min-w-0">
                <span class="block font-semibold text-brand-900">{event.title}</span>
                <span class="mt-1 block text-sm text-neutral-700">
                  {formatEventRange(event)}
                  {#if duration(event)}· {duration(event)}{/if}
                  {#if event.collection}· {event.collection.name}{/if}
                </span>
                {#if fristStand?.vorbei}
                  <span
                    class="mt-1 block text-sm {fristStand.tage < 0
                      ? 'text-neutral-600'
                      : fristStand.bald
                        ? 'font-semibold text-warning'
                        : 'text-neutral-700'}"
                    data-testid="kjr-frist"
                  >
                    {fristStand.tage < 0
                      ? `KJR-Frist am ${formatDate(fristStand.frist)} abgelaufen`
                      : `KJR-Abgabe bis ${formatDate(fristStand.frist)}, ${kjrRestzeit(fristStand.tage)}`}
                  </span>
                {/if}
              </span>
              <span class="flex items-center gap-3">
                <span class="rounded-sm px-3 py-1 text-xs font-semibold {state.className}">
                  {state.label}
                </span>
                <span aria-hidden="true" class="text-brand-900">→</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</LoadState>
