<script lang="ts">
  import ReloadAction from '../ui/ReloadAction.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import {
    abrechnungAblage,
    adoptStoredAbrechnungSession,
    abrechnungKey,
    abrechnungPersonen,
    abrechnungSession,
    abrechnungSessionChanged,
    abrechnungStore,
    clearAbrechnungSession,
    fetchAbrechnung,
    fetchKostenstellen,
    isAbrechnungStorageKey,
    kostenstellenStore,
    resetAbrechnungSession,
    storeAbrechnungSession,
  } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { confirmAction } from '../../lib/confirm';
  import { fetchPrincipal } from '../../lib/authStore.svelte';
  import { formatDateTime, formatEuro, todayIso } from '../../lib/format';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { HELP_CONTACTS } from '../../lib/helpContacts';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import {
    KJR_ABGABE_MONATE,
    kjrAbgabefrist,
    kjrFristStand,
    kjrRestzeit,
  } from '../../lib/kjrFristen';
  import {
    ABRECHNUNG_AUFBEWAHRUNG_MONATE,
    abrechnungLoeschdatum,
  } from '../../lib/abrechnungAblage';
  import { localDate } from '../../lib/dateUtils';
  import { countKjrPersons, countNights, kjrZuschuss } from '../../lib/kjrZuschuss';
  import {
    bilanzMitBetraegen,
    bilanzMitLeihgebuehren,
    leihgebuehren,
    nachweiseMitBetraegen,
    nachweiseMitLeihgebuehren,
  } from '../../lib/abrechnungRechnung';
  import AbrechnungUebersicht from './AbrechnungUebersicht.svelte';
  import AbrechnungTeilnehmende from './AbrechnungTeilnehmende.svelte';
  import AbrechnungNachweise from './AbrechnungNachweise.svelte';
  import AbrechnungLeihgebuehren from './AbrechnungLeihgebuehren.svelte';
  import AktionZuschussSchalter from '../AktionZuschussSchalter.svelte';

  const TABS = [
    { id: 'uebersicht', label: 'Übersicht' },
    { id: 'teilnehmende', label: 'Teilnehmende' },
    { id: 'nachweise', label: 'Einzelnachweise' },
    { id: 'leihgebuehren', label: 'Leihgebühren' },
  ] as const;
  type TabId = (typeof TABS)[number]['id'];

  const SELECT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 focus:border-brand-900 focus:outline-none';

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
  const today = todayIso();

  const nights = $derived(
    abrechnung ? countNights(abrechnung.event.start_date, abrechnung.event.end_date) : 0
  );
  /** Without KJR grant only income and expenses count: no grant, Zusatztag or KJR list. */
  const zuschussfaehig = $derived(abrechnung?.event.zuschussfaehig ?? true);
  const zusatztag = $derived(zuschussfaehig && (session?.zusatztag ?? false));
  /**
   * Days of the KJR grant (overnight stays plus Zusatztag, one for a single day); without the
   * grant the overnight stays (one for a single day). The Leihgebühren start with them.
   */
  const kjrDays = $derived(kjrZuschuss({ persons: 0, nights, zusatztag, resultCent: 0 }).days);
  const leihgebuehrenResult = $derived(
    abrechnung
      ? leihgebuehren(abrechnung.leihgebuehren, session?.leihgebuehren ?? {}, kjrDays)
      : { positions: [], totalCent: 0 }
  );
  /** CampFlow's Einzelnachweise with the amounts changed on the page. */
  const gebucht = $derived(
    abrechnung ? nachweiseMitBetraegen(abrechnung.nachweise, session?.betraege ?? {}) : []
  );
  const bilanz = $derived(
    abrechnung
      ? bilanzMitLeihgebuehren(
          bilanzMitBetraegen(abrechnung.bilanz, gebucht),
          leihgebuehrenResult.totalCent
        )
      : null
  );
  /**
   * Income − expenses − Leihgebühren + KJR grant, the figure to bring to about 0 €; without the
   * grant income − expenses − Leihgebühren.
   */
  const endergebnisCent = $derived(
    !bilanz
      ? 0
      : zuschussfaehig
        ? kjrZuschuss({
            persons: counts.subsidised,
            nights,
            zusatztag,
            resultCent: bilanz.resultCent,
          }).resultAfterCent
        : bilanz.resultCent
  );
  const nachweise = $derived(
    abrechnung ? nachweiseMitLeihgebuehren(gebucht, leihgebuehrenResult.totalCent, today) : []
  );

  /** Whether the entries are kept on this device, and when they were last changed. */
  const ablage = $derived(
    abrechnungAblage[eventId] ?? { available: false, savedAt: null, deleteAfter: null }
  );
  /** Result of the last „Eingaben zurücksetzen“, shown next to the button. */
  let resetResult = $state<'done' | 'failed' | null>(null);
  let ablageText = $state<HTMLElement | null>(null);

  onMount(() => {
    // The name of the logged-in user marks own entries with „(ich)“
    void fetchPrincipal();
    if (!session) return;
    // Only entries the browser could not keep on this device get lost when leaving
    const stopGuard = guardUnsavedChanges(
      () =>
        (aufbewahrungVorbei || !abrechnungAblage[eventId]?.available) &&
        abrechnungSessionChanged(session)
    );
    return () => {
      stopGuard();
      // The next visit restores what this device kept (nothing if it could not keep anything)
      resetAbrechnungSession(eventId);
    };
  });

  /** Last day the entries are kept on this device: one month after the KJR deadline. */
  const loeschdatum = $derived(
    abrechnung
      ? abrechnungLoeschdatum(
          kjrFristStand(abrechnung.event, localDate())?.frist ?? kjrAbgabefrist(localDate())
        )
      : null
  );

  /** Months from the end of the Aktion until the entries are deleted from this device. */
  const aufbewahrungMonate = KJR_ABGABE_MONATE + ABRECHNUNG_AUFBEWAHRUNG_MONATE;

  /** The Aktion is past its last day: new entries are no longer kept on this device. */
  const aufbewahrungVorbei = $derived(loeschdatum !== null && loeschdatum < localDate());

  // Keeps every change on this device
  $effect(() => {
    if (session) storeAbrechnungSession(eventId, loeschdatum);
  });

  async function resetEntries(title: string): Promise<void> {
    const confirmed = await confirmAction({
      title: 'Eingaben zurücksetzen?',
      message: `Alle Eingaben zur Abrechnung „${title}“ auf diesem Gerät löschen? Die Daten aus CampFlow bleiben erhalten.`,
      confirmLabel: 'Eingaben zurücksetzen',
    });
    if (!confirmed) return;
    clearAbrechnungSession(eventId);
    resetResult = abrechnungAblage[eventId]?.savedAt ? 'failed' : 'done';
    // The button disappears with the entries: keep the focus next to it
    await tick();
    ablageText?.focus();
  }

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

  /** Switches to the Übersicht and moves to the KJR's Teilnahmeliste. */
  async function showKjrListe(): Promise<void> {
    selectTab('uebersicht');
    await tick();
    const heading = document.getElementById('kjr-liste-titel');
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading?.focus({ preventScroll: true });
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

<svelte:window
  onstorage={(event) => {
    if (session && isAbrechnungStorageKey(eventId, event.key))
      adoptStoredAbrechnungSession(eventId);
  }}
/>

{#snippet kostenstellenPicker()}
  <LoadState
    data={kostenstellenStore.data}
    loading={kostenstellenStore.loading}
    error={kostenstellenStore.error}
    loadingText="Kostenstellen werden geladen …"
    onretry={() => fetchKostenstellen({ force: true })}
  >
    {#snippet skeleton()}
      <p aria-hidden="true" class="text-sm text-neutral-700">Kostenstellen werden geladen …</p>
    {/snippet}
    {#snippet children(kostenstellen)}
      <label class="block max-w-xl text-sm">
        <span class="font-semibold text-neutral-700">Kostenstelle</span>
        <select
          value={kostenstelle}
          onchange={(event) => selectKostenstelle(event.currentTarget.value)}
          class={SELECT_CLASS}
        >
          <option value="" disabled={!kostenstelle}>Kostenstelle wählen …</option>
          {#each kostenstellen.filter((k) => !k.archived) as option (option.id)}
            <option value={option.id}>{option.name}</option>
          {/each}
          {#if kostenstellen.some((k) => k.archived)}
            <optgroup label="Archiviert">
              {#each kostenstellen.filter((k) => k.archived) as option (option.id)}
                <option value={option.id}>{option.name}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>
    {/snippet}
  </LoadState>
{/snippet}

{#if !eventId || !session}
  <div role="alert" class="surface p-6 border-l-4! border-l-danger!">
    <h1 class="text-lg font-semibold text-brand-900">Ungültiger Link</h1>
    <p class="mt-1 text-sm text-neutral-700">
      Öffne die Aktion bitte über die <a href="/leitendenbereich/abrechnung" class="underline"
        >Übersicht der Abrechnung</a
      >.
    </p>
  </div>
{:else if loadError && costUnitMissing}
  <div role="alert" class="surface space-y-4 p-6 border-l-4! border-l-warning!">
    <div>
      <h1 class="text-lg font-semibold text-brand-900">Kostenstelle nicht gefunden</h1>
      <p class="mt-1 text-sm text-neutral-700">
        {loadError.message} Wähle die Kostenstelle, auf die diese Aktion in CampFlow gebucht wird.
      </p>
    </div>
    {@render kostenstellenPicker()}
  </div>
{:else}
  <LoadState
    data={abrechnung ?? null}
    {loading}
    error={loadError?.message ?? null}
    loadingText="Die Einzelnachweise werden aus CampFlow exportiert. Das dauert einige Sekunden …"
    onretry={() => fetchAbrechnung(eventId, kostenstelle, { force: true })}
  >
    {#snippet skeleton()}
      <div class="surface p-6">
        <p aria-hidden="true" class="text-sm text-neutral-700">
          Die Einzelnachweise werden aus CampFlow exportiert. Das dauert einige Sekunden …
        </p>
        <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
        <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
        <div class="skeleton-element mt-2 h-4 w-56 rounded"></div>
      </div>
    {/snippet}
    {#snippet children(abrechnung)}
      {@const frist = kjrFristStand(abrechnung.event, localDate())}
      <div class="space-y-6">
        <header class="surface p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 class="font-serif text-3xl text-brand-900">{abrechnung.event.title}</h1>
              <p class="mt-1 text-sm text-neutral-700">
                {formatEventRange(abrechnung.event)} · Kostenstelle „{abrechnung.costUnit.name}“
              </p>
              {#if frist && abrechnung.event.zuschussfaehig}
                <p
                  class="mt-1 text-sm {frist.bald
                    ? 'font-semibold text-warning'
                    : 'text-neutral-700'}"
                  data-testid="kjr-frist"
                >
                  {#if !frist.vorbei}
                    Abgabe beim KJR bis {formatDate(frist.frist)} ({KJR_ABGABE_MONATE} Monate nach Ende)
                  {:else if frist.tage >= 0}
                    Abgabe beim KJR bis {formatDate(frist.frist)}, {kjrRestzeit(frist.tage)}
                  {:else}
                    Frist für die Abgabe beim KJR am {formatDate(frist.frist)} abgelaufen
                  {/if}
                </p>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2">
              <ActionButton
                variant="secondary"
                type="button"
                aria-expanded={pickKostenstelle}
                onclick={() =>
                  pickKostenstelle ? (pickKostenstelle = false) : showKostenstellen()}
              >
                Andere Kostenstelle
              </ActionButton>
              <ReloadAction
                type="button"
                disabled={loading}
                title="Teilnehmende und Einzelnachweise neu aus CampFlow laden"
                onclick={() => fetchAbrechnung(eventId, kostenstelle, { refresh: true })}
              >
                {loading ? 'Wird neu geladen …' : 'Neu laden'}
              </ReloadAction>
            </div>
          </div>
          {#if pickKostenstelle}
            <div class="mt-4">{@render kostenstellenPicker()}</div>
          {/if}
          <AktionZuschussSchalter
            class="mt-4 max-w-xl"
            eventId={abrechnung.event.id}
            title={abrechnung.event.title}
            zuschussfaehig={abrechnung.event.zuschussfaehig}
          />
          <div class="mt-4 space-y-3 text-base text-neutral-800" data-testid="eingaben-ablage">
            <p bind:this={ablageText} tabindex="-1" class="focus:outline-none">
              {#if aufbewahrungVorbei}
                <span class="font-semibold text-warning">
                  {abrechnung.event.zuschussfaehig
                    ? 'Die Abgabefrist beim KJR ist seit über einem Monat vorbei.'
                    : `Die Aktion ist seit über ${aufbewahrungMonate} Monaten vorbei.`}
                  Deine Eingaben werden deshalb nicht mehr auf diesem Gerät gespeichert.
                </span>
                Sie bleiben nur erhalten, solange diese Seite geöffnet ist.
              {:else if !ablage.available}
                <span class="font-semibold text-warning">
                  Deine Eingaben können auf diesem Gerät nicht gespeichert werden, zum Beispiel im
                  privaten Modus.
                </span>
                Sie bleiben nur erhalten, solange diese Seite geöffnet ist.
              {:else if ablage.savedAt}
                Deine Eingaben werden auf diesem Gerät gespeichert. Zuletzt bearbeitet am
                {formatDateTime(ablage.savedAt)} Uhr.
                {#if ablage.deleteAfter}
                  Nach dem {formatDate(ablage.deleteAfter)} werden sie gelöscht, {abrechnung.event
                    .zuschussfaehig
                    ? 'einen Monat nach der Abgabefrist beim KJR'
                    : `${aufbewahrungMonate} Monate nach dem Ende der Aktion`}.
                {/if}
              {:else}
                Deine Eingaben (Teilnehmende, Rollen, Zusatztag, Beträge der Einzelnachweise,
                Leihgebühren, Deckblatt) werden auf diesem Gerät gespeichert, auch wenn du die Seite
                schließt. {abrechnung.event.zuschussfaehig
                  ? 'Einen Monat nach der Abgabefrist beim KJR'
                  : `${aufbewahrungMonate} Monate nach dem Ende der Aktion`} werden sie gelöscht.
              {/if}
              „Neu laden“ holt die Daten neu aus CampFlow und behält deine Eingaben.
            </p>
            {#if ablage.savedAt}
              <ActionButton
                variant="secondary"
                type="button"
                onclick={() => resetEntries(abrechnung.event.title)}
              >
                Eingaben zurücksetzen
              </ActionButton>
            {/if}
            <StatusNotice
              message={resetResult === 'done' && !ablage.savedAt
                ? 'Eingaben zurückgesetzt.'
                : resetResult === 'failed' && !ablage.available
                  ? `Die Eingaben konnten auf diesem Gerät nicht gelöscht werden. Lösche die Websitedaten im Browser oder schreib an ${HELP_CONTACTS.technik}.`
                  : null}
              kind={resetResult === 'failed' ? 'error' : 'success'}
            />
          </div>
        </header>

        <div
          role="tablist"
          aria-label="Bereiche der Abrechnung"
          class="grid grid-cols-2 gap-1 border-b border-neutral-300 sm:flex"
        >
          {#each TABS as item (item.id)}
            <button
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabindex={tab === item.id ? 0 : -1}
              class="-mb-px min-h-11 shrink-0 border-b-2 px-3 py-2 text-left text-sm font-semibold sm:px-4 sm:text-center {tab ===
              item.id
                ? 'border-brand-900 bg-surface text-brand-900 sm:bg-transparent'
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
              nachweise={gebucht}
              leihgebuehrenCent={leihgebuehrenResult.totalCent}
              onShowTab={selectTab}
            />
          {:else if tab === 'teilnehmende'}
            <AbrechnungTeilnehmende {abrechnung} {session} onShowKjrListe={showKjrListe} />
          {:else if tab === 'nachweise'}
            <AbrechnungNachweise
              {abrechnung}
              {session}
              {nachweise}
              leihgebuehren={leihgebuehrenResult}
            />
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
    {/snippet}
  </LoadState>
{/if}
