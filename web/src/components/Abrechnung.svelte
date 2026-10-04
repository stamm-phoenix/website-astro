<script lang="ts">
  import { untrack } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import {
    abrechnungKey,
    abrechnungStore,
    fetchAbrechnung,
    fetchKostenstellen,
    kostenstellenStore,
  } from '../lib/abrechnungStore.svelte';
  import { formatEventRange } from '../lib/campflowFields';
  import { formatEuro } from '../lib/belege';
  import {
    KJR_BETREUER_AGE,
    KJR_MAX_TEILNEHMENDE_PER_BETREUER,
    betreuungsschluessel,
    countNights,
    kjrZuschuss,
  } from '../lib/kjrZuschuss';
  import type { CampflowEvent, KategorieSumme } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';

  const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;
  const SELECT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none';
  const HEADING_CLASS = 'font-serif text-lg font-semibold text-brand-900';

  let eventId = $state('');
  let kostenstelle = $state('');
  let zusatztag = $state(false);
  let pickKostenstelle = $state(false);

  const byStartDesc = (a: CampflowEvent, b: CampflowEvent): number =>
    (b.start_date ?? '').localeCompare(a.start_date ?? '') || a.title.localeCompare(b.title, 'de');
  const events = $derived(campflowEventsStore.data ?? []);
  const activeEvents = $derived(events.filter((e) => !e.archived).sort(byStartDesc));
  const archivedEvents = $derived(events.filter((e) => e.archived).sort(byStartDesc));
  const selectedEvent = $derived(events.find((e) => e.id === eventId) ?? null);

  const key = $derived(abrechnungKey(eventId, kostenstelle));
  const abrechnung = $derived(eventId ? abrechnungStore.data[key] : undefined);
  const loadError = $derived(eventId ? abrechnungStore.errors[key] : undefined);
  const loading = $derived(eventId !== '' && abrechnungStore.loading[key] === true);
  const costUnitMissing = $derived(loadError?.code === 'KOSTENSTELLE_NOT_FOUND');

  const nights = $derived(
    abrechnung ? countNights(abrechnung.event.start_date, abrechnung.event.end_date) : 0
  );
  const zuschuss = $derived(
    abrechnung
      ? kjrZuschuss({
          persons: abrechnung.persons.total,
          nights,
          zusatztag,
          resultCent: abrechnung.bilanz.resultCent,
        })
      : null
  );
  const schluessel = $derived(
    abrechnung ? betreuungsschluessel(abrechnung.persons.under27, abrechnung.persons.from27) : null
  );

  $effect(() => {
    untrack(() => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('aktion') ?? '';
      if (EVENT_ID_PATTERN.test(id)) {
        eventId = id;
        kostenstelle = params.get('kostenstelle')?.trim() ?? '';
        fetchAbrechnung(eventId, kostenstelle);
      }
      fetchCampflowEvents();
    });
  });

  function updateUrl(): void {
    const url = new URL(window.location.href);
    if (eventId) url.searchParams.set('aktion', eventId);
    else url.searchParams.delete('aktion');
    if (kostenstelle) url.searchParams.set('kostenstelle', kostenstelle);
    else url.searchParams.delete('kostenstelle');
    history.replaceState(history.state, '', url);
  }

  function selectEvent(id: string): void {
    eventId = id;
    kostenstelle = '';
    zusatztag = false;
    pickKostenstelle = false;
    updateUrl();
    if (id) fetchAbrechnung(id);
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

  $effect(() => {
    if (costUnitMissing) untrack(() => fetchKostenstellen());
  });

  function signClass(cent: number): string {
    if (cent > 0) return 'text-[var(--color-dpsg-pfadfinder)]';
    if (cent < 0) return 'text-[var(--color-dpsg-red)]';
    return 'text-brand-900';
  }

  function share(part: number, total: number): string {
    return total > 0 ? `${Math.round((part / total) * 100)} %` : '';
  }
</script>

{#snippet kategorien(title: string, rows: KategorieSumme[], totalCent: number, id: string)}
  <div>
    <h3 {id} class="text-sm font-semibold uppercase tracking-[0.06em] text-neutral-700">
      {title}
    </h3>
    <table class="mt-2 w-full text-left text-sm" aria-labelledby={id}>
      <thead class="sr-only">
        <tr>
          <th scope="col">Kategorie</th>
          <th scope="col">Anteil</th>
          <th scope="col">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.category)}
          <tr class="border-b border-neutral-200">
            <th scope="row" class="py-2 pr-2 font-normal text-neutral-800">
              {row.category}
              <span class="block text-xs text-neutral-600">
                {row.count}
                {row.count === 1 ? 'Buchung' : 'Buchungen'}
              </span>
            </th>
            <td class="py-2 pr-2 text-right text-xs text-neutral-600 tabular-nums">
              {share(row.cent, totalCent)}
            </td>
            <td class="py-2 text-right tabular-nums text-brand-900">{formatEuro(row.cent)}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="py-2 text-neutral-600">Keine Buchungen</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colspan="2" class="pt-2 font-semibold text-brand-900">Summe</th>
          <td class="pt-2 text-right font-semibold tabular-nums text-brand-900">
            {formatEuro(totalCent)}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
{/snippet}

{#if !campflowEventsStore.data && campflowEventsStore.loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Aktionen werden geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-10 w-full max-w-md rounded"></div>
  </div>
{:else if !campflowEventsStore.data}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Aktionen konnten nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">{campflowEventsStore.error}</p>
    <button
      type="button"
      class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
      onclick={() => fetchCampflowEvents({ force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
  <div class="space-y-6">
    <form class="surface p-4" aria-label="Aktion wählen" onsubmit={(e) => e.preventDefault()}>
      <label class="block max-w-xl text-sm">
        <span class="font-semibold text-neutral-700">Aktion</span>
        <select
          value={eventId}
          onchange={(event) => selectEvent(event.currentTarget.value)}
          class={SELECT_CLASS}
        >
          <option value="">Aktion wählen …</option>
          {#each activeEvents as event (event.id)}
            <option value={event.id}>{event.title} ({formatEventRange(event)})</option>
          {/each}
          {#if archivedEvents.length > 0}
            <optgroup label="Archiviert">
              {#each archivedEvents as event (event.id)}
                <option value={event.id}>{event.title} ({formatEventRange(event)})</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>
    </form>

    {#if !eventId}
      <p class="surface p-6 text-sm text-neutral-700">
        Wähle eine Aktion, um Teilnehmende, Einnahmen und Ausgaben sowie den möglichen KJR-Zuschuss
        zu sehen.
      </p>
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
          <h2 class="text-lg font-semibold text-brand-900">Kostenstelle nicht gefunden</h2>
          <p class="mt-1 text-sm text-neutral-700">
            {loadError.message} Wähle die Kostenstelle, auf die diese Aktion in CampFlow gebucht wird.
          </p>
        </div>
        {@render kostenstellenPicker()}
      </div>
    {:else if loadError}
      <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
        <h2 class="text-lg font-semibold text-brand-900">Abrechnung konnte nicht geladen werden</h2>
        <p class="mt-1 text-sm text-neutral-700">{loadError.message}</p>
        <button
          type="button"
          class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
          onclick={() => fetchAbrechnung(eventId, kostenstelle, { force: true })}
        >
          Erneut versuchen
        </button>
      </div>
    {:else if abrechnung && zuschuss && schluessel}
      <section aria-labelledby="abrechnung-titel" class="surface p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="abrechnung-titel" class="font-serif text-2xl text-brand-900">
              {abrechnung.event.title}
            </h2>
            <p class="mt-1 text-sm text-neutral-700">
              {selectedEvent ? formatEventRange(selectedEvent) : ''}
              · Kostenstelle „{abrechnung.costUnit.name}“ · {abrechnung.bilanz.entryCount}
              {abrechnung.bilanz.entryCount === 1 ? 'Buchung' : 'Buchungen'}
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
              onclick={() => fetchAbrechnung(eventId, kostenstelle, { force: true })}
            >
              {loading ? 'Wird aktualisiert …' : 'Aktualisieren'}
            </button>
          </div>
        </div>
        {#if pickKostenstelle}
          <div class="mt-4">{@render kostenstellenPicker()}</div>
        {/if}
      </section>

      <section aria-labelledby="teilnehmende-titel" class="surface p-6">
        <h2 id="teilnehmende-titel" class={HEADING_CLASS}>Teilnehmende</h2>
        <p class="mt-1 text-sm text-neutral-700">
          Bestätigte Anmeldungen, Alter am ersten Tag der Aktion. Ab {KJR_BETREUER_AGE} Jahren zählen
          Personen für den KJR als Betreuer*innen.
        </p>
        <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-md border border-neutral-200 p-3">
            <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
              Gesamt
            </dt>
            <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
              {abrechnung.persons.total}
            </dd>
          </div>
          <div class="rounded-md border border-neutral-200 p-3">
            <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
              Unter {KJR_BETREUER_AGE}
            </dt>
            <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
              {abrechnung.persons.under27}
            </dd>
            <dd class="text-xs text-neutral-600">Teilnehmende</dd>
          </div>
          <div class="rounded-md border border-neutral-200 p-3">
            <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
              Ab {KJR_BETREUER_AGE}
            </dt>
            <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
              {abrechnung.persons.from27}
            </dd>
            <dd class="text-xs text-neutral-600">Betreuer*innen</dd>
          </div>
          <div
            class="rounded-md border p-3 {schluessel.warning
              ? 'border-[#8a4a00]/40 bg-[#fff1e0]'
              : 'border-neutral-200'}"
          >
            <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
              Betreuungs&shy;schlüssel
            </dt>
            <dd
              class="mt-1 text-2xl font-semibold tabular-nums {schluessel.warning
                ? 'text-[#8a4a00]'
                : 'text-brand-900'}"
            >
              {schluessel.label}
            </dd>
            <dd class="text-xs text-neutral-600">Betreuer*in : Teilnehmende</dd>
          </div>
        </dl>
        <StatusNotice
          class="mt-4"
          kind="warning"
          message={schluessel.warning
            ? abrechnung.persons.from27 === 0
              ? 'Keine Betreuer*innen ab 27 Jahren. Das muss im Zuschussantrag beim KJR im Bemerkungsfeld erklärt werden.'
              : `Der Betreuungsschlüssel ist schlechter als 1:${KJR_MAX_TEILNEHMENDE_PER_BETREUER}. Das muss im Zuschussantrag beim KJR im Bemerkungsfeld erklärt werden, z. B. „Es waren Ehemalige dabei“.`
            : null}
        />
        {#if abrechnung.persons.unknownAge > 0}
          <p class="mt-2 text-sm text-neutral-700">
            Bei {abrechnung.persons.unknownAge}
            {abrechnung.persons.unknownAge === 1 ? 'Person' : 'Personen'} ist in CampFlow kein Alter hinterlegt;
            {abrechnung.persons.unknownAge === 1 ? 'sie zählt' : 'sie zählen'} nur in der Gesamtzahl.
          </p>
        {/if}
      </section>

      <section aria-labelledby="bilanz-titel" class="surface p-6">
        <h2 id="bilanz-titel" class={HEADING_CLASS}>Einnahmen und Ausgaben</h2>
        <div class="mt-4 grid gap-6 lg:grid-cols-2">
          {@render kategorien(
            'Einnahmen',
            abrechnung.bilanz.income,
            abrechnung.bilanz.incomeCent,
            'bilanz-einnahmen'
          )}
          {@render kategorien(
            'Ausgaben',
            abrechnung.bilanz.expenses,
            abrechnung.bilanz.expenseCent,
            'bilanz-ausgaben'
          )}
        </div>
        <dl
          class="mt-6 flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-brand-900 pt-3"
        >
          <dt class="font-semibold text-brand-900">Ergebnis (Einnahmen − Ausgaben)</dt>
          <dd
            class="text-xl font-semibold tabular-nums {signClass(abrechnung.bilanz.resultCent)}"
            data-testid="ergebnis"
          >
            {formatEuro(abrechnung.bilanz.resultCent)}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="zuschuss-titel" class="surface p-6">
        <h2 id="zuschuss-titel" class={HEADING_CLASS}>KJR-Zuschuss</h2>
        <p class="mt-1 text-sm text-neutral-700">
          Der Kreisjugendring Rosenheim bezuschusst nur ein Defizit, höchstens bis zu seiner Höhe.
        </p>

        <label class="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            class="mt-0.5 h-4 w-4"
            bind:checked={zusatztag}
            disabled={nights === 0}
            aria-describedby="zusatztag-hinweis"
          />
          <span>
            <span class="font-semibold text-brand-900">Zusatztag</span>
            <span id="zusatztag-hinweis" class="block text-neutral-700">
              {#if nights === 0}
                Nur bei Aktionen mit Übernachtung möglich.
              {:else}
                Nur ankreuzen, wenn an An- und Abreisetag mehr als 6 Stunden „echtes“ Programm
                stattfand. „Unterwegs sein“ zählt nicht als Programm.
              {/if}
            </span>
          </span>
        </label>

        <dl class="mt-4 divide-y divide-neutral-200 text-sm">
          <div class="flex flex-wrap justify-between gap-2 py-2">
            <dt class="text-neutral-700">Übernachtungen</dt>
            <dd class="tabular-nums text-brand-900">
              {nights === 0 ? 'Keine (eintägige Aktion)' : nights}
            </dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2 py-2">
            <dt class="text-neutral-700">Berechnung</dt>
            <dd class="tabular-nums text-brand-900" data-testid="zuschuss-formel">
              {formatEuro(zuschuss.rateCent)} × {abrechnung.persons.total}
              {abrechnung.persons.total === 1 ? 'Person' : 'Personen'}
              {#if nights > 0}× {zuschuss.days} {zuschuss.days === 1 ? 'Tag' : 'Tage'}{/if}
            </dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2 py-2">
            <dt class="text-neutral-700">Errechneter Zuschuss</dt>
            <dd class="tabular-nums text-brand-900" data-testid="zuschuss-errechnet">
              {formatEuro(zuschuss.computedCent)}
            </dd>
          </div>
          <div class="flex flex-wrap justify-between gap-2 py-2">
            <dt class="font-semibold text-brand-900">Beantragbarer Zuschuss</dt>
            <dd
              class="text-right font-semibold tabular-nums text-brand-900"
              data-testid="zuschuss-beantragbar"
            >
              {formatEuro(zuschuss.eligibleCent)}
              {#if zuschuss.deficitCent === 0}
                <span class="block text-xs font-normal text-neutral-600">
                  nicht beantragbar – kein Defizit
                </span>
              {:else if zuschuss.eligibleCent < zuschuss.computedCent}
                <span class="block text-xs font-normal text-neutral-600">
                  begrenzt auf das Defizit
                </span>
              {/if}
            </dd>
          </div>
        </dl>

        <dl class="mt-4 space-y-1 border-t-2 border-brand-900 pt-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <dt class="text-neutral-700">Ergebnis vor Zuschuss</dt>
            <dd class="tabular-nums {signClass(abrechnung.bilanz.resultCent)}">
              {formatEuro(abrechnung.bilanz.resultCent)}
            </dd>
          </div>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <dt class="font-semibold text-brand-900">Ergebnis inklusive Zuschuss</dt>
            <dd
              class="text-xl font-semibold tabular-nums {signClass(zuschuss.resultAfterCent)}"
              data-testid="ergebnis-mit-zuschuss"
            >
              {formatEuro(zuschuss.resultAfterCent)}
            </dd>
          </div>
        </dl>
      </section>
    {/if}
  </div>
{/if}

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
