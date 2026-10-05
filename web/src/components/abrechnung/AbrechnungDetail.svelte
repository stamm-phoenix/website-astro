<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import {
    abrechnungKey,
    abrechnungPersonen,
    abrechnungSession,
    abrechnungSessionChanged,
    abrechnungStore,
    fetchAbrechnung,
    fetchKostenstellen,
    kostenstellenStore,
    resetAbrechnungSession,
  } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { formatEuro } from '../../lib/belege';
  import { formatEventRange } from '../../lib/campflowFields';
  import { countKjrPersons, countNights, kjrZuschuss } from '../../lib/kjrZuschuss';
  import {
    bilanzMitLeihgebuehren,
    leihgebuehren,
    nachweiseMitLeihgebuehren,
  } from '../../lib/abrechnungRechnung';
  import AbrechnungUebersicht from './AbrechnungUebersicht.svelte';
  import AbrechnungTeilnehmende from './AbrechnungTeilnehmende.svelte';
  import AbrechnungNachweise from './AbrechnungNachweise.svelte';
  import AbrechnungLeihgebuehren from './AbrechnungLeihgebuehren.svelte';

  const TABS = [
    { id: 'uebersicht', label: 'Übersicht' },
    { id: 'teilnehmende', label: 'Teilnehmende' },
    { id: 'nachweise', label: 'Einzelnachweise' },
    { id: 'leihgebuehren', label: 'Leihgebühren' },
  ] as const;
  type TabId = (typeof TABS)[number]['id'];

  const SELECT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none';

  // Read once: the page is opened for exactly one Aktion
  const eventId =
    window.location.pathname.match(
      /^\/leitendenbereich\/abrechnung\/(evt_[A-Za-z0-9]+)\/?$/
    )?.[1] ?? '';
  const initialParams = new URLSearchParams(window.location.search);
  const session: AbrechnungSession | null = eventId ? abrechnungSession(eventId) : null;

  let kostenstelle = $state(initialParams.get('kostenstelle')?.trim() ?? '');
  let tab = $state<TabId>(
    TABS.some((t) => t.id === initialParams.get('tab'))
      ? (initialParams.get('tab') as TabId)
      : 'uebersicht'
  );
  let pickKostenstelle = $state(false);

  const key = $derived(abrechnungKey(eventId, kostenstelle));
  const abrechnung = $derived(eventId ? abrechnungStore.data[key] : undefined);
  const loadError = $derived(eventId ? abrechnungStore.errors[key] : undefined);
  const loading = $derived(eventId !== '' && abrechnungStore.loading[key] === true);
  const costUnitMissing = $derived(loadError?.code === 'KOSTENSTELLE_NOT_FOUND');

  /** Registrations plus persons added on the page, without the ones left out. */
  const activePersons = $derived(
    abrechnung && session
      ? abrechnungPersonen(abrechnung, session).filter((p) => !session.excluded[p.id])
      : []
  );
  const counts = $derived(countKjrPersons(activePersons));
  const today = new Date().toISOString().slice(0, 10);

  const nights = $derived(
    abrechnung ? countNights(abrechnung.event.start_date, abrechnung.event.end_date) : 0
  );
  /** Days of the KJR grant (overnight stays plus Zusatztag, one for a single day). */
  const kjrDays = $derived(
    kjrZuschuss({ persons: 0, nights, zusatztag: session?.zusatztag ?? false, resultCent: 0 }).days
  );
  const leihgebuehrenResult = $derived(
    abrechnung
      ? leihgebuehren(abrechnung.leihgebuehren, session?.leihgebuehren ?? {}, kjrDays)
      : { positions: [], totalCent: 0 }
  );
  const bilanz = $derived(
    abrechnung ? bilanzMitLeihgebuehren(abrechnung.bilanz, leihgebuehrenResult.totalCent) : null
  );
  /** Income − expenses − Leihgebühren + KJR grant, the figure to bring to about 0 €. */
  const endergebnisCent = $derived(
    bilanz
      ? kjrZuschuss({
          persons: counts.subsidised,
          nights,
          zusatztag: session?.zusatztag ?? false,
          resultCent: bilanz.resultCent,
        }).resultAfterCent
      : 0
  );
  const nachweise = $derived(
    abrechnung
      ? nachweiseMitLeihgebuehren(abrechnung.nachweise, leihgebuehrenResult.totalCent, today)
      : []
  );

  onMount(() => {
    if (!session) return;
    // Nothing on this page is stored: ask before leaving it with entries
    const stopGuard = guardUnsavedChanges(() => abrechnungSessionChanged(session));
    return () => {
      stopGuard();
      // Left the page (confirmed if there were entries): start empty next time, as announced
      resetAbrechnungSession(eventId);
    };
  });

  $effect(() => {
    untrack(() => {
      if (eventId) fetchAbrechnung(eventId, kostenstelle);
    });
  });

  $effect(() => {
    if (costUnitMissing) untrack(() => fetchKostenstellen());
  });

  function updateUrl(): void {
    const url = new URL(window.location.href);
    if (kostenstelle) url.searchParams.set('kostenstelle', kostenstelle);
    else url.searchParams.delete('kostenstelle');
    if (tab !== 'uebersicht') url.searchParams.set('tab', tab);
    else url.searchParams.delete('tab');
    history.replaceState(history.state, '', url);
  }

  function selectKostenstelle(value: string): void {
    kostenstelle = value;
    pickKostenstelle = false;
    updateUrl();
    fetchAbrechnung(eventId, value);
  }

  function showKostenstellen(): void {
    pickKostenstelle = true;
    fetchKostenstellen();
  }

  function selectTab(id: TabId): void {
    tab = id;
    updateUrl();
  }

  /** Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern). */
  async function onTabKey(event: KeyboardEvent): Promise<void> {
    const index = TABS.findIndex((t) => t.id === tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(TABS[next].id);
    await tick();
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  }
</script>

{#snippet kostenstellenPicker()}
  {#if kostenstellenStore.data}
    <label class="block max-w-xl text-sm">
      <span class="font-semibold text-neutral-700">Kostenstelle</span>
      <select
        value={kostenstelle}
        onchange={(event) => selectKostenstelle(event.currentTarget.value)}
        class={SELECT_CLASS}
      >
        <option value="" disabled={!kostenstelle}>Kostenstelle wählen …</option>
        {#each kostenstellenStore.data.filter((k) => !k.archived) as option (option.id)}
          <option value={option.id}>{option.name}</option>
        {/each}
        {#if kostenstellenStore.data.some((k) => k.archived)}
          <optgroup label="Archiviert">
            {#each kostenstellenStore.data.filter((k) => k.archived) as option (option.id)}
              <option value={option.id}>{option.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
    </label>
  {:else if kostenstellenStore.loading}
    <p role="status" aria-live="polite" class="text-sm text-neutral-700">
      Kostenstellen werden geladen …
    </p>
  {:else if kostenstellenStore.error}
    <p class="text-sm text-[var(--color-dpsg-red)]">
      {kostenstellenStore.error}
      <button
        type="button"
        class="ml-2 font-semibold underline"
        onclick={() => fetchKostenstellen({ force: true })}
      >
        Erneut versuchen
      </button>
    </p>
  {/if}
{/snippet}

{#if !eventId || !session}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h1 class="text-lg font-semibold text-brand-900">Ungültiger Link</h1>
    <p class="mt-1 text-sm text-neutral-700">
      Öffne die Aktion bitte über die <a href="/leitendenbereich/abrechnung" class="underline"
        >Übersicht der Abrechnung</a
      >.
    </p>
  </div>
{:else if loading && !abrechnung}
  <div role="status" aria-live="polite" class="surface p-6">
    <p class="text-sm text-neutral-700">
      Die Einzelnachweise werden aus CampFlow exportiert. Das dauert einige Sekunden …
    </p>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-56 rounded"></div>
  </div>
{:else if loadError && costUnitMissing}
  <div role="alert" class="surface space-y-4 p-6 border-l-4! border-l-[#8a4a00]!">
    <div>
      <h1 class="text-lg font-semibold text-brand-900">Kostenstelle nicht gefunden</h1>
      <p class="mt-1 text-sm text-neutral-700">
        {loadError.message} Wähle die Kostenstelle, auf die diese Aktion in CampFlow gebucht wird.
      </p>
    </div>
    {@render kostenstellenPicker()}
  </div>
{:else if loadError}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h1 class="text-lg font-semibold text-brand-900">Abrechnung konnte nicht geladen werden</h1>
    <p class="mt-1 text-sm text-neutral-700">{loadError.message}</p>
    <button
      type="button"
      class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
      onclick={() => fetchAbrechnung(eventId, kostenstelle, { force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else if abrechnung}
  <div class="space-y-6">
    <header class="surface p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-serif text-3xl text-brand-900">{abrechnung.event.title}</h1>
          <p class="mt-1 text-sm text-neutral-700">
            {formatEventRange(abrechnung.event)} · Kostenstelle „{abrechnung.costUnit.name}“
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:border-brand-900"
            aria-expanded={pickKostenstelle}
            onclick={() => (pickKostenstelle ? (pickKostenstelle = false) : showKostenstellen())}
          >
            Andere Kostenstelle
          </button>
          <button
            type="button"
            class="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:border-brand-900 disabled:opacity-60"
            disabled={loading}
            title="Teilnehmende und Einzelnachweise neu aus CampFlow laden"
            onclick={() => fetchAbrechnung(eventId, kostenstelle, { refresh: true })}
          >
            {loading ? 'Wird neu geladen …' : 'Neu laden'}
          </button>
        </div>
      </div>
      {#if pickKostenstelle}
        <div class="mt-4">{@render kostenstellenPicker()}</div>
      {/if}
      <p class="mt-4 text-xs text-neutral-600">
        Eingaben auf dieser Seite (Teilnehmende, Rollen, Zusatztag, Leihgebühren, Deckblatt) gelten
        nur, solange sie geöffnet ist. „Neu laden“ holt die Daten neu aus CampFlow und behält sie.
      </p>
    </header>

    <div
      role="tablist"
      aria-label="Bereiche der Abrechnung"
      class="flex gap-1 overflow-x-auto border-b border-neutral-300"
    >
      {#each TABS as item (item.id)}
        <button
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls={`panel-${item.id}`}
          tabindex={tab === item.id ? 0 : -1}
          class="-mb-px shrink-0 border-b-2 px-2.5 py-2 text-sm font-semibold sm:px-4 {tab ===
          item.id
            ? 'border-brand-900 text-brand-900'
            : 'border-transparent text-neutral-700 hover:text-brand-900'}"
          onclick={() => selectTab(item.id)}
          onkeydown={onTabKey}
        >
          {item.label}
          {#if item.id === 'teilnehmende'}
            <span class="ml-1 text-xs font-normal">({counts.total})</span>
          {:else if item.id === 'nachweise'}
            <span class="ml-1 text-xs font-normal">({nachweise.length})</span>
          {:else if item.id === 'leihgebuehren' && leihgebuehrenResult.totalCent > 0}
            <span class="ml-1 text-xs font-normal" data-testid="tab-leihgebuehren-summe"
              >({formatEuro(leihgebuehrenResult.totalCent)})</span
            >
          {/if}
        </button>
      {/each}
    </div>

    <div
      role="tabpanel"
      id={`panel-${tab}`}
      aria-labelledby={`tab-${tab}`}
      tabindex="-1"
      class="focus:outline-none"
    >
      {#if tab === 'uebersicht'}
        <AbrechnungUebersicht
          {abrechnung}
          {session}
          persons={activePersons}
          {counts}
          bilanz={bilanz ?? abrechnung.bilanz}
          leihgebuehrenCent={leihgebuehrenResult.totalCent}
          onShowTab={selectTab}
        />
      {:else if tab === 'teilnehmende'}
        <AbrechnungTeilnehmende {abrechnung} {session} />
      {:else if tab === 'nachweise'}
        <AbrechnungNachweise {abrechnung} {nachweise} leihgebuehren={leihgebuehrenResult} />
      {:else}
        <AbrechnungLeihgebuehren
          {abrechnung}
          {session}
          defaultDays={kjrDays}
          result={leihgebuehrenResult}
          {endergebnisCent}
        />
      {/if}
    </div>
  </div>
{/if}
