<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { abrechnungGroups } from '../../lib/abrechnungList';
  import LoadState from '../ui/LoadState.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { onMount } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import { kjrFristStand, kjrRestzeit } from '../../lib/kjrFristen';
  import { todayIso } from '../../lib/format';
  import { countNights } from '../../lib/kjrZuschuss';
  import type { CampflowEvent } from '../../lib/types';

  const today = todayIso();

  let showArchive = $state(false);
  let search = $state('');

  const events = $derived(campflowEventsStore.data ?? []);
  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return events
      .filter((e) => e.archived === showArchive)
      .filter((e) => !query || e.title.toLowerCase().includes(query));
  });

  const groups = $derived(abrechnungGroups(visible, today, showArchive));

  function status(event: CampflowEvent): { label: string; tone: 'neutral' | 'success' } {
    const start = event.start_date?.slice(0, 10);
    const end = event.end_date?.slice(0, 10) ?? start;
    if (!start || !end) return { label: 'Ohne Datum', tone: 'neutral' };
    if (end < today) return { label: 'Vorbei', tone: 'neutral' };
    if (start <= today) return { label: 'Läuft', tone: 'success' };
    return { label: 'Geplant', tone: 'neutral' };
  }

  function duration(event: CampflowEvent): string {
    if (!event.start_date) return '';
    const nights = countNights(event.start_date, event.end_date ?? event.start_date);
    if (nights === 0) return 'Eintägig';
    return nights === 1 ? '1 Übernachtung' : `${nights} Übernachtungen`;
  }

  onMount(() => {
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
          class="form-input mt-1 w-full"
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
      {#each groups as group (group.id)}
        <section aria-labelledby={`abrechnung-gruppe-${group.id}`} class="space-y-3">
          <h2 id={`abrechnung-gruppe-${group.id}`} class="font-serif text-xl text-brand-900">
            {group.title}
          </h2>
          <ul
            class="divide-y divide-neutral-200 border-y border-neutral-200"
            aria-label={group.title}
          >
            {#each group.events as event (event.id)}
              {@const state = status(event)}
              {@const fristStand = kjrFristStand(event, today)}
              <li>
                <div
                  class="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center"
                >
                  <span class="min-w-0">
                    <a
                      href={`/leitendenbereich/abrechnung/${event.id}`}
                      class="block min-h-11 content-center font-semibold text-link underline-offset-4 hover:underline"
                      >{event.title}</a
                    >
                    <span class="mt-1 block text-sm text-neutral-700">
                      {formatEventRange(event)}
                      {#if duration(event)}· {duration(event)}{/if}
                      {#if event.collection}· {event.collection.name}{/if}
                    </span>
                    {#if !event.zuschussfaehig}
                      <span
                        class="mt-1 block text-sm text-neutral-700"
                        data-testid="ohne-kjr-zuschuss"
                      >
                        {event.keineAktion
                          ? 'Keine Aktion (Bestellung oder Anmeldung), ohne KJR-Zuschuss'
                          : 'Ohne KJR-Zuschuss'}
                      </span>
                    {:else if fristStand?.vorbei}
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
                  <StatusLabel label={state.label} tone={state.tone} />
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
</LoadState>
