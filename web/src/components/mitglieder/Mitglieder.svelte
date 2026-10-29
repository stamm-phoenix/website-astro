<script lang="ts">
  import { onMount } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import PdfDownloadButton from '../ui/PdfDownloadButton.svelte';
  import MitgliedDetails from './MitgliedDetails.svelte';
  import { ageAt, formatDate, formatName } from '../../lib/campflowFields';
  import { todayIso } from '../../lib/format';
  import { isIch } from '../../lib/ichStore.svelte';
  import {
    gruppen,
    inAnsicht,
    matchesSearch,
    mitgliedStatus,
    personGroups,
    sortMitglieder,
    type MitgliederAnsicht,
  } from '../../lib/mitglieder';
  import { mitgliederStore } from '../../lib/pflegeStore.svelte';
  import type { CampflowPerson, MitgliederData } from '../../lib/types';

  const CAMPFLOW_URL = 'https://my.campflow.de/dpsg-stamm-phoenix-5629/members';
  /** Rows shown at first and added per click, so a phone stays quick with long lists. */
  const PAGE = 100;

  const store = mitgliederStore.state;
  let today = $state(todayIso());

  let ansicht = $state<MitgliederAnsicht>('alle');
  let search = $state('');
  let shown = $state(PAGE);
  /** ID of the member whose details are open; resolved in the current data, so a reload updates them. */
  let selectedId = $state<string | null>(null);
  let refreshed = $state('');

  function readUrl(): void {
    const gruppe = new URLSearchParams(window.location.search).get('gruppe');
    ansicht =
      gruppe === 'ohne'
        ? 'ohne-gruppe'
        : gruppe === 'ausgetreten'
          ? 'ausgetreten'
          : gruppe
            ? `gruppe:${gruppe}`
            : 'alle';
  }

  /** Keeps the tab in the address, so a reload or a shared link opens the same group. */
  function select(next: MitgliederAnsicht): void {
    ansicht = next;
    const url = new URL(window.location.href);
    if (next === 'alle') url.searchParams.delete('gruppe');
    else if (next === 'ohne-gruppe') url.searchParams.set('gruppe', 'ohne');
    else if (next === 'ausgetreten') url.searchParams.set('gruppe', 'ausgetreten');
    else url.searchParams.set('gruppe', next.slice('gruppe:'.length));
    history.replaceState(history.state, '', url);
  }

  async function refresh(): Promise<void> {
    refreshed = '';
    today = todayIso();
    await mitgliederStore.load({ force: true, param: true });
    if (!store.error) refreshed = 'Mitgliederliste neu aus CampFlow geladen.';
  }

  onMount(() => {
    readUrl();
    // The store outlives a change of page; a list older than the server's shared minute is
    // asked for again and stays shown until the answer is there
    void mitgliederStore.load({ param: false, maxAge: 60_000 });
    // A page left open overnight would otherwise judge joins and leaves by the day before
    const refreshToday = (): void => {
      today = todayIso();
    };
    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', refreshToday);
    return () => {
      window.removeEventListener('focus', refreshToday);
      document.removeEventListener('visibilitychange', refreshToday);
    };
  });

  function tabs(data: MitgliederData) {
    const count = (value: MitgliederAnsicht) =>
      data.persons.filter((p) => inAnsicht(p, value, today) && matchesSearch(p, search)).length;
    const options: { value: MitgliederAnsicht; label: string; count: number }[] = [
      { value: 'alle', label: 'Alle', count: count('alle') },
      ...gruppen(data.persons).map((gruppe) => ({
        value: `gruppe:${gruppe}` as const,
        label: gruppe,
        count: count(`gruppe:${gruppe}`),
      })),
      { value: 'ohne-gruppe', label: 'Ohne Gruppe', count: count('ohne-gruppe') },
      { value: 'ausgetreten', label: 'Ausgetreten', count: count('ausgetreten') },
    ];
    // A group from an old link that is gone stays as a tab, so the empty list has a visible reason
    if (!options.some((option) => option.value === ansicht)) {
      options.splice(1, 0, { value: ansicht, label: ansicht.slice('gruppe:'.length), count: 0 });
    }
    return options;
  }

  function visible(data: MitgliederData): CampflowPerson[] {
    return sortMitglieder(
      data.persons.filter((p) => inAnsicht(p, ansicht, today) && matchesSearch(p, search))
    );
  }

  $effect(() => {
    // Back to the first rows whenever the filters change.
    void [ansicht, search];
    shown = PAGE;
  });
</script>

<div class="space-y-5">
  <div
    class="flex flex-col gap-2 border-b border-neutral-200 pb-4 text-sm text-neutral-700 sm:flex-row sm:items-center sm:justify-between"
  >
    <a
      href={CAMPFLOW_URL}
      class="inline-flex min-h-11 items-center text-link underline underline-offset-4"
      target="_blank"
      rel="noopener">Mitglieder in CampFlow öffnen</a
    >
    {#if store.data}
      <ReloadAction
        loadedAt={Date.parse(store.data.loadedAt)}
        disabled={store.loading}
        onclick={refresh}
      >
        {store.loading ? 'Lädt …' : 'Neu aus CampFlow laden'}
      </ReloadAction>
    {/if}
  </div>
  <p role="status" aria-live="polite" class="text-sm font-semibold text-success empty:hidden">
    {refreshed}
  </p>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Mitgliederliste wird aus CampFlow geladen …"
    onretry={() => mitgliederStore.load({ force: true, param: false })}
  >
    {#snippet children(data: MitgliederData)}
      {@const list = visible(data)}
      {@const options = tabs(data)}
      <section aria-labelledby="mitglieder-liste" class="space-y-4">
        <h2 id="mitglieder-liste" class="sr-only">Mitglieder</h2>
        <label class="block w-full text-sm sm:w-80">
          <span class="font-semibold text-neutral-700">Suche</span>
          <input
            type="search"
            bind:value={search}
            placeholder="Name, Mitgliedsnummer oder E-Mail"
            class="form-input mt-1 w-full"
          />
        </label>
        <!-- On a phone the many groups collapse into a list, so the members stay near the top -->
        <label class="block w-full text-sm sm:hidden">
          <span class="font-semibold text-neutral-700">Gruppe</span>
          <select
            class="form-input mt-1 w-full"
            value={ansicht}
            onchange={(event) => select(event.currentTarget.value as MitgliederAnsicht)}
          >
            {#each options as option (option.value)}
              <option value={option.value}>{option.label} ({option.count})</option>
            {/each}
          </select>
        </label>
        <div class="hidden sm:block">
          <FilterTabs
            label="Nach Gruppe filtern"
            {options}
            value={ansicht}
            onselect={select}
            countNouns={['Mitglied', 'Mitglieder']}
          />
        </div>

        {#if list.length === 0}
          <p class="surface p-6 text-sm text-neutral-700">
            {search.trim()
              ? 'Kein Mitglied passt zur Suche.'
              : ansicht === 'ausgetreten'
                ? 'Niemand ist ausgetreten.'
                : 'In dieser Gruppe ist niemand.'}
          </p>
        {:else}
          <PdfDownloadButton
            download={async () => {
              const shown = { persons: list, columns: data.columns, ansicht, search, today };
              await (await import('../../lib/mitgliederPdf')).downloadMitgliederPdf(shown);
            }}
          />
          <ul
            class="divide-y divide-neutral-200 border-y border-neutral-200"
            aria-label="Mitglieder"
          >
            {#each list.slice(0, shown) as person (person.id)}
              {@const status = mitgliedStatus(person, today)}
              {@const age = ageAt(person, today)}
              {@const groups = personGroups(person)}
              <li>
                <button
                  type="button"
                  class="group flex min-h-11 w-full flex-col gap-1 py-3 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                  onclick={() => (selectedId = person.id)}
                >
                  <span class="min-w-0">
                    <span class="block font-semibold text-brand-900 group-hover:underline"
                      >{formatName(
                        person
                      )}{#if isIch({ id: person.id, name: formatName(person), mitglied: true })}
                        <span class="font-normal text-neutral-700">(ich)</span>{/if}</span
                    >
                    <span class="block text-sm text-neutral-700">
                      {[groups.join(', ') || 'Ohne Gruppe', age !== null && `${age} Jahre`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {#if status === 'ausgetreten'}
                    <span class="shrink-0 text-sm"
                      ><StatusLabel
                        label={typeof person.leave_date === 'string'
                          ? `Ausgetreten am ${formatDate(person.leave_date)}`
                          : 'Ausgetreten'}
                      /></span
                    >
                  {:else if status === 'kuenftig'}
                    <span class="shrink-0 text-sm"
                      ><StatusLabel
                        label={`Tritt am ${formatDate(String(person.join_date))} ein`}
                        tone="warning"
                        dot
                      /></span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if list.length > shown}
            <button type="button" class="btn-secondary" onclick={() => (shown += PAGE)}>
              Weitere {Math.min(PAGE, list.length - shown)} von {list.length - shown} anzeigen
            </button>
          {/if}
        {/if}
      </section>

      <MitgliedDetails
        person={data.persons.find((p) => p.id === selectedId) ?? null}
        columns={data.columns}
        {today}
        onclose={() => (selectedId = null)}
      />
    {/snippet}
  </LoadState>
</div>
