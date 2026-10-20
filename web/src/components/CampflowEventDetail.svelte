<script lang="ts">
  import StatusLabel from './ui/StatusLabel.svelte';
  import type { StatusTone } from '../lib/status';
  import ReloadAction from './ui/ReloadAction.svelte';
  import CopyCode from './ui/CopyCode.svelte';
  import MessageText from './ui/MessageText.svelte';
  import LoadState from './ui/LoadState.svelte';
  import { onMount } from 'svelte';
  import {
    aktionBeitraegeStore,
    campflowDetailStore,
    fetchCampflowEvent,
  } from '../lib/campflowStore.svelte';
  import {
    NEW_COLUMN_KEYS,
    PERSON_STATUS_LABEL,
    defaultColumnKeys,
    formatEventRange,
    formatName,
    getPersonColumns,
    personStatus,
  } from '../lib/campflowFields';
  import type { PersonStatus } from '../lib/campflowFields';
  import {
    beitragBetrag,
    beitragColumns,
    beitragZahlen,
    beitraegeOf,
    kenntAlle,
  } from '../lib/aktionBeitraege';
  import { statusLabel } from '../lib/beitraege';
  import { formatDateTime, formatEuro } from '../lib/format';
  import type { CampflowPerson } from '../lib/types';
  import CampflowPersonDetails from './CampflowPersonDetails.svelte';
  import AktionZuschussSchalter from './AktionZuschussSchalter.svelte';
  import AktionArtSchalter from './AktionArtSchalter.svelte';

  const STATUS_ORDER: PersonStatus[] = ['confirmed', 'registered', 'cancelled'];

  const STATUS_TONE: Record<PersonStatus, StatusTone> = {
    confirmed: 'success',
    registered: 'neutral',
    cancelled: 'danger',
  };

  let id = $state('');
  let statuses = $state<PersonStatus[]>(['confirmed', 'registered']);
  let search = $state('');
  let sortKey = $state('name');
  let sortAsc = $state(true);
  let visibleKeys = $state<string[] | null>(null);
  let selected = $state<CampflowPerson | null>(null);

  const detail = $derived(id ? (campflowDetailStore.data[id] ?? null) : null);
  const persons = $derived(detail?.persons ?? []);
  const beitraege = aktionBeitraegeStore.state;
  /** The store is shared across page visits; only the Beiträge of this Aktion count. */
  const beitraegeDaten = $derived(beitraege.data?.eventId === id ? beitraege.data : null);
  /** Whether the Beiträge were read again because a participant was missing in them. */
  let beitraegeNachgeladen = false;
  const available = $derived.by(() => {
    if (!detail) return [];
    const [name, status, ...rest] = getPersonColumns(detail.persons, detail.columns, detail.event);
    return [name, status, ...beitragColumns(beitraegeDaten), ...rest];
  });
  const shownColumns = $derived.by(() => {
    const keys = visibleKeys ?? (detail ? defaultColumnKeys(available, detail.columns) : []);
    return available.filter((c) => keys.includes(c.key));
  });

  const active = $derived(persons.filter((p) => personStatus(p) !== 'cancelled'));
  const stats = $derived({
    active: active.length,
    confirmed: persons.filter((p) => personStatus(p) === 'confirmed').length,
    cancelled: persons.filter((p) => personStatus(p) === 'cancelled').length,
    vegetarian: active.filter((p) => Array.isArray(p.diet) && p.diet.includes('vegetarian')).length,
    vegan: active.filter((p) => Array.isArray(p.diet) && p.diet.includes('vegan')).length,
    intolerances: active.filter((p) => Array.isArray(p.intolerances) && p.intolerances.length > 0)
      .length,
    nonSwimmers: active.filter((p) => p.swimming === false).length,
  });
  // Everyone: a cancelled registration can still owe a Beitrag or be due a refund
  const zahlen = $derived(beitraegeDaten ? beitragZahlen(beitraegeDaten, persons) : null);

  $effect(() => {
    // Someone who registered after the last read has no Beiträge yet; read CampFlow once more.
    if (!detail || !beitraegeDaten || beitraege.loading || beitraegeNachgeladen) return;
    if (kenntAlle(beitraegeDaten, detail.persons)) return;
    beitraegeNachgeladen = true;
    void loadBeitraege(true);
  });

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const sortColumn = available.find((c) => c.key === sortKey) ?? available[0];
    return persons
      .filter((p) => statuses.includes(personStatus(p)))
      .filter((p) => !query || available.some((c) => c.text(p).toLowerCase().includes(query)))
      .sort((a, b) => {
        if (!sortColumn) return 0;
        const va = sortColumn.sortValue(a);
        const vb = sortColumn.sortValue(b);
        const result =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'de');
        return sortAsc ? result : -result;
      });
  });

  function storageKey(): string {
    return `campflow-columns:${id}`;
  }

  function loadBeitraege(refresh: boolean): Promise<void> {
    // Another Aktion's Beiträge are dropped, so they neither show nor count as loaded
    if (beitraege.data && beitraege.data.eventId !== id) beitraege.data = null;
    return aktionBeitraegeStore.load({ force: refresh, param: { id, refresh } });
  }

  function reload(): void {
    fetchCampflowEvent(id, { force: true });
    void loadBeitraege(true);
  }

  onMount(() => {
    id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!id) return;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
      // A plain list was saved before the Beitrag columns existed; show them once anyway
      if (Array.isArray(stored)) visibleKeys = [...(stored as string[]), ...NEW_COLUMN_KEYS];
      else if (stored && typeof stored === 'object' && 'keys' in stored)
        visibleKeys = (stored as { keys: string[] }).keys;
    } catch {
      // Storage unavailable, use the default columns
    }
    fetchCampflowEvent(id);
    void loadBeitraege(false);
  });

  function toggleColumn(key: string): void {
    const current = shownColumns.map((c) => c.key);
    visibleKeys = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ keys: visibleKeys }));
    } catch {
      // Not persisted, fine
    }
  }

  function resetColumns(): void {
    visibleKeys = null;
    try {
      localStorage.removeItem(storageKey());
    } catch {
      // Ignore
    }
  }

  function toggleStatus(status: PersonStatus): void {
    statuses = statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status];
  }

  function sortBy(key: string): void {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  }
</script>

{#if !id}
  <div role="alert" class="border-t border-neutral-200 pt-5">
    <p class="text-sm text-neutral-700">
      Keine Aktion ausgewählt. <a
        class="font-semibold text-link underline"
        href="/leitendenbereich/aktionen">Zur Übersicht</a
      >
    </p>
  </div>
{:else}
  <LoadState
    data={detail}
    loading={campflowDetailStore.loading}
    error={campflowDetailStore.error}
    loadingText="Aktion wird geladen …"
    onretry={() => fetchCampflowEvent(id, { force: true })}
  >
    {#snippet skeleton()}
      <div class="skeleton-element h-8 w-72 max-w-full rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-56 rounded"></div>
      <div class="skeleton-element mt-8 h-40 w-full rounded"></div>
    {/snippet}
    {#snippet children(detail)}
      {@const event = detail.event}
      <div class="space-y-8">
        <section
          class="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6"
          aria-labelledby="event-heading"
        >
          <div>
            <h1
              id="event-heading"
              class="font-serif text-3xl font-semibold text-brand-900 md:text-4xl"
            >
              {event.title}
            </h1>
            <p class="mt-2 font-semibold text-brand-800">{formatEventRange(event)}</p>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
              <span
                class="inline-flex items-center gap-1.5 font-semibold {event.published
                  ? 'text-success'
                  : 'text-neutral-700'}"
              >
                <span
                  aria-hidden="true"
                  class="size-2 rounded-full {event.published
                    ? 'bg-success'
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
            </p>
            <AktionArtSchalter class="mt-3 max-w-xl" {event} />
            <AktionZuschussSchalter
              class="mt-3 max-w-xl"
              eventId={event.id}
              title={event.title}
              zuschussfaehig={event.zuschussfaehig}
              keineAktion={event.keineAktion}
              aktionLink={false}
              savesNote={false}
            />
            <p class="mt-2 text-sm text-neutral-700">Häkchen werden sofort gespeichert.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if event.url}
              <a href={event.url} target="_blank" rel="noopener noreferrer" class="btn-secondary">
                Anmeldeformular<span class="sr-only"> (öffnet in neuem Tab)</span>
              </a>
            {/if}
            {#if !event.keineAktion}
              <a
                href={`/leitendenbereich/aktionen/fahrten?id=${encodeURIComponent(id)}`}
                class="btn-secondary"
              >
                Fahrten planen
              </a>
            {/if}
            <a
              href={`/leitendenbereich/aufgaben?aktion=${encodeURIComponent(id)}`}
              class="btn-secondary">Aufgaben und Checklisten</a
            >
            <span data-testid={beitraegeDaten ? 'aktion-beitraege-stand' : undefined}>
              <ReloadAction
                type="button"
                loadedAt={beitraegeDaten ? Date.parse(beitraegeDaten.loadedAt) : null}
                disabled={campflowDetailStore.loading || beitraege.loading}
                onclick={reload}
              >
                {campflowDetailStore.loading || beitraege.loading ? 'Lädt …' : 'Neu laden'}
              </ReloadAction>
            </span>
          </div>
        </section>

        <section aria-labelledby="event-stats-heading">
          <h2 id="event-stats-heading" class="sr-only">Überblick</h2>
          <dl
            class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-4 border-b border-neutral-200 pb-6"
          >
            {#snippet stat(label: string, value: string | number, hint?: string)}
              <div>
                <dt class="text-sm text-neutral-700">{label}</dt>
                <dd class="mt-0.5 text-2xl font-semibold tabular-nums text-brand-900">
                  {value}{#if hint}<span class="text-sm font-normal text-neutral-700">{hint}</span
                    >{/if}
                </dd>
              </div>
            {/snippet}
            {@render stat(
              'Angemeldet',
              stats.active,
              event.max_persons ? ` / ${event.max_persons}` : undefined
            )}
            {@render stat('Bestätigt', stats.confirmed)}
            {@render stat('Storniert', stats.cancelled)}
            {@render stat('Vegetarisch', stats.vegetarian)}
            {@render stat('Vegan', stats.vegan)}
            {@render stat('Unverträglichkeiten', stats.intolerances)}
            {#if stats.nonSwimmers > 0}
              {@render stat('Nichtschwimmer*innen', stats.nonSwimmers)}
            {/if}
            {#if zahlen}
              {@render stat(
                'Beitrag offen',
                zahlen.offen,
                zahlen.offenCent > 0 ? ` · ${formatEuro(zahlen.offenCent)}` : undefined
              )}
              {#if zahlen.erstatten > 0}
                {@render stat('Zu viel bezahlt', zahlen.erstatten)}
              {/if}
            {/if}
          </dl>
        </section>

        <section aria-labelledby="participants-heading" class="space-y-4">
          <h2 id="participants-heading" class="font-serif text-2xl font-semibold text-brand-900">
            Teilnehmende
          </h2>

          <form
            class="relative z-30 grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end"
            role="search"
            aria-label="Teilnehmende filtern"
            onsubmit={(e) => e.preventDefault()}
          >
            <label class="block text-sm">
              <span class="form-label">Suche</span>
              <input type="search" bind:value={search} placeholder="Suchen …" class="form-input" />
            </label>

            <fieldset class="text-sm">
              <legend class="form-label">Status</legend>
              <div class="mt-1 flex flex-wrap gap-x-5">
                {#each STATUS_ORDER as status (status)}
                  <button
                    type="button"
                    aria-pressed={statuses.includes(status)}
                    onclick={() => toggleStatus(status)}
                    class="py-2 font-semibold decoration-2 underline-offset-[6px] {statuses.includes(
                      status
                    )
                      ? 'underline text-brand-900'
                      : 'text-neutral-700 hover:text-brand-900 hover:underline'}"
                  >
                    {PERSON_STATUS_LABEL[status]}
                  </button>
                {/each}
              </div>
            </fieldset>

            <details class="relative text-sm">
              <summary class="btn-secondary cursor-pointer list-none tabular-nums">
                Spalten ({shownColumns.length}/{available.length})
              </summary>
              <div
                class="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-surface p-3 shadow-lift"
              >
                <ul class="space-y-1">
                  {#each available as column (column.key)}
                    <li>
                      <label class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={shownColumns.some((c) => c.key === column.key)}
                          onchange={() => toggleColumn(column.key)}
                        />
                        <span>{column.label}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
                <button
                  type="button"
                  class="mt-3 border-t border-neutral-200 pt-2 text-sm font-semibold text-brand-800 underline"
                  onclick={resetColumns}
                >
                  Standardauswahl
                </button>
              </div>
            </details>
          </form>

          <p class="text-sm text-neutral-700" aria-live="polite">
            {visible.length}
            {visible.length === 1 ? 'Person' : 'Personen'} angezeigt
          </p>

          {#if beitraege.error && !beitraege.loading}
            <div role="alert" class="surface-muted space-y-2 p-4 text-sm">
              <p class="text-danger font-semibold">
                {beitraegeDaten ? 'Beiträge nicht neu geladen' : 'Beiträge fehlen'}
              </p>
              <p class="text-neutral-700"><MessageText text={beitraege.error} /></p>
              {#if beitraegeDaten}
                <p class="text-neutral-700" data-testid="aktion-beitraege-alter-stand">
                  Angezeigt wird der Stand von {formatDateTime(beitraegeDaten.loadedAt)}.
                </p>
              {/if}
              <button
                type="button"
                class="btn-secondary"
                onclick={() => loadBeitraege(beitraegeDaten !== null)}>Beiträge erneut laden</button
              >
            </div>
          {:else if beitraege.loading}
            <p class="text-sm text-neutral-700" role="status">Beiträge werden geladen …</p>
          {/if}

          {#if visible.length === 0}
            <p class="border-t border-neutral-200 pt-4 text-sm text-neutral-700">
              {persons.length === 0
                ? 'Für diese Aktion gibt es noch keine Anmeldungen.'
                : 'Keine Teilnehmenden für diese Filter.'}
            </p>
          {:else}
            <!-- Desktop: table -->
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-b border-neutral-200 text-left text-sm">
                <thead class="border-b-2 border-neutral-300 text-neutral-700">
                  <tr>
                    {#each shownColumns as column (column.key)}
                      <th
                        scope="col"
                        class="whitespace-nowrap px-3 py-2 first:pl-0"
                        aria-sort={ariaSort(column.key)}
                      >
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 font-semibold hover:text-brand-900"
                          onclick={() => sortBy(column.key)}
                        >
                          {column.label}
                          <span aria-hidden="true" class="w-3 text-brand-800">
                            {sortKey === column.key ? (sortAsc ? '▲' : '▼') : ''}
                          </span>
                        </button>
                      </th>
                    {/each}
                    <th scope="col" class="px-3 py-2"><span class="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-neutral-200">
                  {#each visible as person (person.id)}
                    {@const status = personStatus(person)}
                    <tr class="hover:bg-[var(--color-brand-50)]/60">
                      {#each shownColumns as column (column.key)}
                        <td class="max-w-[18rem] px-3 py-3 align-top first:pl-0">
                          {#if column.key === 'status'}
                            <StatusLabel
                              label={PERSON_STATUS_LABEL[status]}
                              tone={STATUS_TONE[status]}
                              dot
                            />
                          {:else if column.key === 'name'}
                            <span class="font-semibold text-brand-900">{column.text(person)}</span>
                          {:else if column.key === 'beitrag'}
                            {@const fees = beitraegeOf(beitraegeDaten, person)}
                            {#if fees && fees.length > 0}
                              {#each fees as fee (fee.id)}
                                {@const state = statusLabel(fee)}
                                <span class="flex items-center gap-2 whitespace-nowrap">
                                  <span class="tabular-nums">{beitragBetrag(fee)}</span>
                                  <StatusLabel label={state.label} tone={state.tone} dot />
                                </span>
                              {/each}
                            {:else}
                              <span class="text-neutral-700">{column.text(person)}</span>
                            {/if}
                          {:else if column.key === 'verwendungszweck'}
                            {#each beitraegeOf(beitraegeDaten, person) ?? [] as fee (fee.id)}
                              {#if fee.reference}
                                <span class="my-1 block"
                                  ><CopyCode code={fee.reference} compact /></span
                                >
                              {/if}
                            {/each}
                          {:else}
                            <span class="line-clamp-3">{column.text(person)}</span>
                          {/if}
                        </td>
                      {/each}
                      <td class="px-3 py-3 pr-0 text-right align-top">
                        <button
                          type="button"
                          class="font-semibold text-brand-800 underline underline-offset-2 hover:text-brand-900"
                          onclick={() => (selected = person)}
                        >
                          Details<span class="sr-only"> zu {formatName(person)}</span>
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Mobile: list -->
            <ul class="divide-y divide-neutral-200 border-y border-neutral-200 md:hidden">
              {#each visible as person (person.id)}
                {@const status = personStatus(person)}
                <li>
                  <button
                    type="button"
                    class="group block w-full py-4 text-left"
                    onclick={() => (selected = person)}
                  >
                    <span class="flex items-start justify-between gap-3">
                      <span class="font-semibold text-brand-900 group-hover:underline"
                        >{formatName(person)}</span
                      >
                      <span class="text-sm"
                        ><StatusLabel
                          label={PERSON_STATUS_LABEL[status]}
                          tone={STATUS_TONE[status]}
                          dot
                        /></span
                      >
                    </span>
                    <span class="mt-1 block space-y-0.5 text-sm text-neutral-700">
                      {#each shownColumns.filter((c) => !['name', 'status', 'verwendungszweck'].includes(c.key) && c.text(person)) as column (column.key)}
                        <span class="block">
                          <span class="font-semibold">{column.label}:</span>
                          {column.text(person)}
                        </span>
                      {/each}
                    </span>
                  </button>
                  <!-- Outside the row's button: a button inside a button is not allowed -->
                  {#if shownColumns.some((c) => c.key === 'verwendungszweck')}
                    {#each beitraegeOf(beitraegeDaten, person) ?? [] as fee (fee.id)}
                      {#if fee.reference}
                        <p
                          class="-mt-2 flex flex-wrap items-center gap-x-2 pb-4 text-sm text-neutral-700"
                        >
                          <span class="font-semibold">Verwendungszweck:</span>
                          <CopyCode code={fee.reference} />
                        </p>
                      {/if}
                    {/each}
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>

      <CampflowPersonDetails
        person={selected}
        {event}
        columns={detail.columns}
        beitraege={selected ? beitraegeOf(beitraegeDaten, selected) : undefined}
        onclose={() => (selected = null)}
      />
    {/snippet}
  </LoadState>
{/if}
