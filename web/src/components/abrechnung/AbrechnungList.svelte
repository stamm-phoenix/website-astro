<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { formatEventRange } from '../../lib/campflowFields';
  import { countNights } from '../../lib/kjrZuschuss';
  import type { CampflowEvent } from '../../lib/types';

  const today = new Date().toISOString().slice(0, 10);

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
        className: 'bg-[var(--color-dpsg-pfadfinder)]/15 text-[var(--color-dpsg-pfadfinder)]',
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

{#if !campflowEventsStore.data && campflowEventsStore.loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Aktionen werden geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-16 w-full rounded"></div>
    <div class="skeleton-element mt-3 h-16 w-full rounded"></div>
  </div>
{:else if !campflowEventsStore.data}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Aktionen konnten nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">{campflowEventsStore.error}</p>
    <ActionButton
      variant="primary"
      type="button"
      class="mt-4"
      onclick={() => fetchCampflowEvents({ force: true })}
    >
      Erneut versuchen
    </ActionButton>
  </div>
{:else}
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-wrap gap-2" role="group" aria-label="Aktionen auswählen">
        {#each [{ archived: false, label: 'Aktuell' }, { archived: true, label: 'Archiviert' }] as tab (tab.label)}
          <button
            type="button"
            class="rounded-sm border px-4 py-2 text-sm font-semibold {showArchive === tab.archived
              ? 'border-brand-900 bg-action text-white'
              : 'border-neutral-300 bg-surface text-brand-900 hover:border-brand-900'}"
            aria-pressed={showArchive === tab.archived}
            onclick={() => changeArchive(tab.archived)}
          >
            {tab.label} ({events.filter((e) => e.archived === tab.archived).length})
          </button>
        {/each}
      </div>
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
{/if}
