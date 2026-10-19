<script lang="ts">
  import ReloadAction from './ui/ReloadAction.svelte';
  import { onMount } from 'svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import LoadState from './ui/LoadState.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';
  import Toast from './ui/Toast.svelte';
  import ModalDialog from './ui/ModalDialog.svelte';
  import {
    campflowDetailStore,
    campflowEventsStore,
    fetchCampflowEvent,
    fetchCampflowEvents,
  } from '../lib/campflowStore.svelte';
  import { nurAktionen } from '../lib/aktionArt';
  import { formatEventRange } from '../lib/campflowFields';
  import { localDate } from '../lib/dateUtils';
  import { mapGroupToStufe } from '../lib/campflowGroups';
  import {
    FAHRTEN,
    FAHRT_LABEL,
    KEINE_ANPASSUNGEN,
    fahrtPersonen,
    fahrtenRows,
    freiePlaetze,
    guessSeatColumn,
    planFahrt,
    readAnpassungen,
    withDriver,
    withMove,
    withRemoved,
    writeAnpassungen,
  } from '../lib/fahrtenPlan';
  import type { Auto, Fahrt, FahrtAnpassungen, FahrtPerson } from '../lib/fahrtenPlan';
  import { sammelCsv } from '../lib/sammelExport';
  import { GROUP_CONFIG, STUFE_TO_KEY } from '../lib/types';
  import { confirmAction } from '../lib/confirm';

  /** A person picked in the plan, with the car they sit in (`null` without a seat). */
  interface Auswahl {
    person: FahrtPerson;
    auto: Auto | null;
    isDriver: boolean;
  }

  /** The URL holds the whole plan, so reloading keeps it and a link shares it. */
  let search = $state(window.location.search);
  let auswahl = $state<Auswahl | null>(null);
  let toast = $state<{ message: string; kind: 'success' | 'error' } | null>(null);

  const params = $derived(new URLSearchParams(search));
  const id = $derived(params.get('id') ?? '');
  const fahrt = $derived<Fahrt>(params.get('fahrt') === 'rueck' ? 'rueck' : 'hin');
  const detail = $derived(id ? (campflowDetailStore.data[id] ?? null) : null);
  const columns = $derived(detail?.columns ?? []);
  const seatColumns = $derived<Record<Fahrt, string>>({
    hin: params.get('spalte-hin') ?? guessSeatColumn(columns, 'hin'),
    rueck: params.get('spalte-rueck') ?? guessSeatColumn(columns, 'rueck'),
  });
  const personen = $derived(detail ? fahrtPersonen(detail.persons, columns, seatColumns) : []);
  const anpassungen = $derived<Record<Fahrt, FahrtAnpassungen>>({
    hin: readAnpassungen(params, 'hin'),
    rueck: readAnpassungen(params, 'rueck'),
  });
  const plans = $derived({
    hin: planFahrt(personen, 'hin', anpassungen.hin),
    rueck: planFahrt(personen, 'rueck', anpassungen.rueck),
  });
  const plan = $derived(plans[fahrt]);
  const changed = $derived(
    FAHRTEN.some(
      (f) => params.has(`spalte-${f}`) || Object.values(anpassungen[f]).some((list) => list.length)
    )
  );

  const today = localDate();
  const upcoming = $derived(
    nurAktionen(campflowEventsStore.data ?? [])
      .filter((event) => !event.archived && (event.end_date ?? event.start_date ?? today) >= today)
      .sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'))
  );

  onMount(() => {
    if (id) fetchCampflowEvent(id);
    else fetchCampflowEvents();
  });

  function update(change: (next: URLSearchParams) => void): void {
    const next = new URLSearchParams(search);
    change(next);
    search = `?${next.toString()}`;
    history.replaceState(history.state, '', `${window.location.pathname}${search}`);
  }

  function setAnpassungen(next: FahrtAnpassungen): void {
    update((p) => writeAnpassungen(p, fahrt, next));
    auswahl = null;
  }

  function setSeatColumn(f: Fahrt, column: string): void {
    update((p) => p.set(`spalte-${f}`, column));
  }

  async function reset(): Promise<void> {
    if (
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Spaltenwahl und alle Änderungen an Hin- und Rückfahrt verwerfen?',
        confirmLabel: 'Änderungen verwerfen',
      }))
    )
      return;
    update((p) => {
      for (const f of FAHRTEN) {
        p.delete(`spalte-${f}`);
        writeAnpassungen(p, f, KEINE_ANPASSUNGEN);
      }
    });
    toast = { message: 'Die automatische Planung gilt wieder.', kind: 'success' };
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast = { message: 'Link zur Planung kopiert.', kind: 'success' };
    } catch {
      toast = {
        message: 'Kopieren ging nicht. Kopiere die Adresse aus der Adresszeile.',
        kind: 'error',
      };
    }
  }

  function downloadCsv(title: string): void {
    const url = URL.createObjectURL(
      new Blob([sammelCsv(fahrtenRows([plans.hin, plans.rueck]))], {
        type: 'text/csv;charset=utf-8',
      })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fahrten-${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function groupColor(gruppe: string): string {
    const key = STUFE_TO_KEY[mapGroupToStufe(gruppe) ?? ''];
    return key ? GROUP_CONFIG[key].color : 'var(--color-brand-800)';
  }

  /** CampFlow puts a coloured emoji in front of the group; the marker already shows it. */
  function groupName(gruppe: string): string {
    return gruppe.replace(/^[^\p{L}]+/u, '');
  }

  function seatsText(count: number): string {
    return count === 1 ? '1 Platz' : `${count} Plätze`;
  }
</script>

{#snippet person(p: FahrtPerson, auto: Auto | null, isDriver = false)}
  <button
    type="button"
    class="flex min-h-11 w-full items-center gap-2 py-2 text-left hover:text-brand-900 hover:underline"
    onclick={() => (auswahl = { person: p, auto, isDriver })}
  >
    <span
      aria-hidden="true"
      class="stufe-marker size-2.5 shrink-0 rounded-full"
      style:background-color={groupColor(p.gruppe)}
    ></span>
    <span class={isDriver ? 'font-semibold text-brand-900' : ''}>{p.name}</span>
    {#if p.gruppe}<span class="text-sm text-neutral-700">{groupName(p.gruppe)}</span>{/if}
    <span class="sr-only">, ändern</span>
  </button>
{/snippet}

{#if !id}
  <section aria-labelledby="fahrten-events-heading" class="space-y-4">
    <div>
      <h1
        id="fahrten-events-heading"
        class="font-serif text-3xl font-semibold text-brand-900 md:text-4xl"
      >
        Fahrten planen
      </h1>
      <p class="mt-2 max-w-[72ch] text-neutral-700">
        Wähle eine Aktion. Die Planung verteilt die Teilnehmenden auf die Autos, für die in CampFlow
        Plätze angeboten wurden.
      </p>
    </div>
    <LoadState
      data={campflowEventsStore.data}
      loading={campflowEventsStore.loading}
      error={campflowEventsStore.error}
      loadingText="Aktionen werden geladen …"
      onretry={() => fetchCampflowEvents({ force: true })}
      isEmpty={() => upcoming.length === 0}
    >
      {#snippet empty()}
        <p class="text-sm text-neutral-700">In CampFlow gibt es keine offenen Aktionen.</p>
      {/snippet}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each upcoming as event (event.id)}
          <li>
            <a
              class="flex flex-wrap items-baseline justify-between gap-x-4 py-3 hover:underline"
              href={`?id=${encodeURIComponent(event.id)}`}
            >
              <span class="font-semibold text-brand-900">{event.title}</span>
              <span class="text-sm text-neutral-700">{formatEventRange(event)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </LoadState>
  </section>
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
      <div class="skeleton-element mt-8 h-40 w-full rounded"></div>
    {/snippet}
    {#snippet children(detail)}
      {@const event = detail.event}
      <div class="space-y-8">
        <section
          aria-labelledby="fahrten-heading"
          class="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6"
        >
          <div>
            <h1
              id="fahrten-heading"
              class="font-serif text-3xl font-semibold text-brand-900 md:text-4xl"
            >
              Fahrten: {event.title}
            </h1>
            <p class="mt-2 font-semibold text-brand-800">{formatEventRange(event)}</p>
            <p class="mt-1 max-w-[72ch] text-sm text-neutral-700">
              Leitende, die in CampFlow Plätze angeboten haben, fahren immer, notfalls allein. Von
              den Familien fahren so wenige Autos wie nötig, große zuerst. Geschwister fahren im
              Familienauto, Leitende sonst bei Leitenden oder den ältesten Kindern. Tippe auf einen
              Namen, um ihn umzusetzen.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a
              class="btn-secondary"
              href={`/leitendenbereich/aktionen/aktion?id=${encodeURIComponent(id)}`}
              >Teilnehmende</a
            >
            <ReloadAction
              disabled={campflowDetailStore.loading}
              onclick={() => fetchCampflowEvent(id, { force: true })}
              >{campflowDetailStore.loading ? 'Lädt …' : 'Neu laden'}</ReloadAction
            >
          </div>
        </section>

        <section aria-labelledby="fahrten-spalten-heading" class="space-y-3">
          <h2 id="fahrten-spalten-heading" class="font-serif text-2xl font-semibold text-brand-900">
            Plätze aus CampFlow
          </h2>
          <div class="grid gap-4 sm:grid-cols-2">
            {#each FAHRTEN as f (f)}
              <label class="block text-sm">
                <span class="form-label">Angebotene Plätze {FAHRT_LABEL[f]}</span>
                <select
                  class="form-input"
                  value={seatColumns[f]}
                  onchange={(e) => setSeatColumn(f, e.currentTarget.value)}
                >
                  <option value="">Keine Spalte</option>
                  {#each columns as column (column.id)}
                    <option value={column.id}>{column.name}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
          {#if !seatColumns.hin && !seatColumns.rueck}
            <p class="border-l-2 border-warning py-1 pl-4 text-sm text-neutral-700">
              Wähle die Felder aus dem Anmeldeformular, in denen Eltern und Leitende ihre freien
              Plätze eintragen. Ohne sie hat niemand einen Platz.
            </p>
          {/if}
        </section>

        <section aria-labelledby="fahrten-plan-heading" class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <h2 id="fahrten-plan-heading" class="font-serif text-2xl font-semibold text-brand-900">
              Planung
            </h2>
            <div class="flex flex-wrap gap-2">
              <ActionButton onclick={() => downloadCsv(event.title)}>Als CSV</ActionButton>
              <ActionButton onclick={copyLink}>Link kopieren</ActionButton>
              {#if changed}
                <ActionButton variant="danger" onclick={reset}>Änderungen verwerfen</ActionButton>
              {/if}
            </div>
          </div>

          <FilterTabs
            label="Fahrt"
            options={FAHRTEN.map((f) => ({ value: f, label: FAHRT_LABEL[f] }))}
            value={fahrt}
            onselect={(value) => update((p) => p.set('fahrt', value))}
          />

          <dl
            class="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-6 gap-y-4 border-b border-neutral-200 pb-4"
          >
            {#snippet stat(label: string, value: number, tone = 'text-brand-900')}
              <div>
                <dt class="text-sm text-neutral-700">{label}</dt>
                <dd class="mt-0.5 text-2xl font-semibold tabular-nums {tone}">{value}</dd>
              </div>
            {/snippet}
            {@render stat('Autos', plan.autos.length)}
            {@render stat(
              'Mitfahrende',
              plan.autos.reduce((n, a) => n + a.mitfahrende.length, 0)
            )}
            {@render stat(
              'Freie Plätze',
              plan.autos.reduce((n, a) => n + freiePlaetze(a), 0)
            )}
            {@render stat(
              'Ohne Platz',
              plan.ohnePlatz.length,
              plan.ohnePlatz.length > 0 ? 'text-danger' : 'text-success'
            )}
          </dl>

          {#if plan.autos.length === 0}
            <p class="text-sm text-neutral-700">
              Für die {FAHRT_LABEL[fahrt]} hat niemand Plätze angeboten.
            </p>
          {:else}
            <ol class="grid gap-x-8 lg:grid-cols-2">
              {#each plan.autos as auto, index (auto.fahrer.id)}
                <li class="border-t border-neutral-200 py-3">
                  <div class="flex items-baseline justify-between gap-3">
                    <h3 class="text-sm font-semibold text-neutral-700">Auto {index + 1}</h3>
                    <span class="text-sm tabular-nums text-neutral-700">
                      {auto.mitfahrende.length + 1} von {auto.plaetze}
                      {auto.plaetze === 1 ? 'Platz' : 'Plätzen'} belegt
                    </span>
                  </div>
                  {@render person(auto.fahrer, auto, true)}
                  {#if auto.mitfahrende.length > 0}
                    <ul class="ml-4 border-l border-neutral-200 pl-3">
                      {#each auto.mitfahrende as p (p.id)}
                        <li>{@render person(p, auto)}</li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ol>
          {/if}

          <section
            aria-labelledby="fahrten-ohne-heading"
            class="border-t-2 border-neutral-300 pt-4"
          >
            <h3 id="fahrten-ohne-heading" class="font-semibold text-brand-900">
              Ohne Platz <span class="tabular-nums">({plan.ohnePlatz.length})</span>
            </h3>
            {#if plan.ohnePlatz.length === 0}
              <p class="mt-1 text-sm text-success">Alle haben einen Platz.</p>
            {:else}
              <p class="mt-1 text-sm text-neutral-700">Diese Kinder müssen die Eltern bringen.</p>
              <ul class="mt-1">
                {#each plan.ohnePlatz as p (p.id)}
                  <li>{@render person(p, null)}</li>
                {/each}
              </ul>
            {/if}
          </section>

          {#if plan.entfernt.length > 0}
            <section
              aria-labelledby="fahrten-entfernt-heading"
              class="border-t border-neutral-200 pt-4"
            >
              <h3 id="fahrten-entfernt-heading" class="font-semibold text-brand-900">
                Nicht eingeplant <span class="tabular-nums">({plan.entfernt.length})</span>
              </h3>
              <ul class="mt-1 divide-y divide-neutral-200">
                {#each plan.entfernt as p (p.id)}
                  <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{p.name}</span>
                    <ActionButton
                      onclick={() => setAnpassungen(withRemoved(anpassungen[fahrt], p.id, false))}
                      >Wieder einplanen<span class="sr-only">: {p.name}</span></ActionButton
                    >
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </section>
      </div>

      <ModalDialog
        open={auswahl !== null}
        title={auswahl?.person.name ?? ''}
        size="narrow"
        dismissOnBackdrop
        onclose={() => (auswahl = null)}
      >
        {#if auswahl}
          {@const current = auswahl}
          {@const seats = current.person.plaetze[fahrt]}
          {@const targets = plan.autos.filter((a) => a !== current.auto && freiePlaetze(a) > 0)}
          <div class="space-y-4 overflow-y-auto px-5 py-4">
            <p class="text-sm text-neutral-700">
              {FAHRT_LABEL[fahrt]} ·
              {current.isDriver
                ? `fährt, ${seatsText(seats)}`
                : current.auto
                  ? `fährt bei ${current.auto.fahrer.name} mit`
                  : 'ohne Platz'}
            </p>

            {#if !current.isDriver}
              <div>
                <h3 class="form-label">Mitfahren bei</h3>
                {#if targets.length === 0}
                  <p class="text-sm text-neutral-700">In keinem anderen Auto ist ein Platz frei.</p>
                {:else}
                  <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
                    {#each targets as target (target.fahrer.id)}
                      <li>
                        <button
                          type="button"
                          class="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left hover:underline"
                          onclick={() =>
                            setAnpassungen(
                              withMove(anpassungen[fahrt], current.person.id, target.fahrer.id)
                            )}
                        >
                          <span class="font-semibold text-brand-900">{target.fahrer.name}</span>
                          <span class="text-sm tabular-nums text-neutral-700"
                            >{freiePlaetze(target)} frei</span
                          >
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}

            <div class="flex flex-wrap gap-2">
              {#if !current.isDriver && current.auto}
                <ActionButton
                  onclick={() =>
                    setAnpassungen(withMove(anpassungen[fahrt], current.person.id, null))}
                  >Ohne Platz</ActionButton
                >
              {/if}
              {#if !current.isDriver && seats > 0}
                <ActionButton
                  variant="primary"
                  onclick={() =>
                    setAnpassungen(withDriver(anpassungen[fahrt], current.person.id, true))}
                  >Fahren lassen ({seatsText(seats)})</ActionButton
                >
              {/if}
              {#if current.isDriver}
                <ActionButton
                  onclick={() =>
                    setAnpassungen(withDriver(anpassungen[fahrt], current.person.id, false))}
                  >Fährt nicht</ActionButton
                >
              {/if}
              <ActionButton
                variant="danger"
                onclick={() =>
                  setAnpassungen(withRemoved(anpassungen[fahrt], current.person.id, true))}
                >Nicht einplanen</ActionButton
              >
              <ActionButton onclick={() => (auswahl = null)}>Abbrechen</ActionButton>
            </div>
          </div>
        {/if}
      </ModalDialog>
    {/snippet}
  </LoadState>
{/if}

<Toast
  message={toast?.message ?? null}
  kind={toast?.kind ?? 'success'}
  onclose={() => (toast = null)}
/>
