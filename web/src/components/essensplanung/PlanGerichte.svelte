<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { zustaendigAus } from '../../lib/essensplanungPlan';
  import { planungHash } from '../../lib/essensplanung';
  import { zustaendigeJeGericht } from '../../lib/essensplanungZustaendige';
  import { ApiError, errorMessage } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { EssenKatalog, Gericht } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanungAnsicht } from '../../../../api/lib/essen-planung-model';
  import GerichtKarte from './GerichtKarte.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PlanZutaten from './PlanZutaten.svelte';
  import EinheitenHinweis from './EinheitenHinweis.svelte';
  import type { PlanKontext } from './planKontext';
  import type { PlanNavigation } from './planNavigation.svelte';

  /**
   * The dishes of a Planung and the ingredients they use; dishes download as recipe cards. Each
   * dish opens on a page of its own. All dishes stay in the page, hidden, so input started in one
   * is kept while another area or the list is shown.
   */

  interface Props {
    kontext: PlanKontext;
    /** Which dish is shown on its own page. */
    navigation: PlanNavigation;
    /** False while another tab is shown. */
    sichtbar: boolean;
  }
  let { kontext, navigation, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The central lists, loaded once; they change only in the Steuerung. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);

  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      katalogFehler = errorMessage(error, 'Die Zutatenliste konnte nicht geladen werden.');
    }
  }
  // Again when the Steuerung changed the lists, e.g. a corrected allergen or a new ingredient
  $effect(() => {
    void ansicht.katalogStand;
    untrack(() => void katalogLaden());
  });

  let name = $state('');
  let personen = $state('');
  /** The meal to plan the new dish at; '' for none. */
  let mahlzeitId = $state('');
  let zustaendig = $state('');
  let felder = $state<Record<string, string>>({});
  $effect(() => guardUnsavedChanges(() => name.trim() !== ''));
  const mitglieder = $derived(
    ansicht.mitglieder.filter((m) => !m.entzogen).map((m) => ({ value: m.name }))
  );

  /** The dish shown on its own page; a deleted one gives way to the list. */
  const offenId = $derived(
    navigation.gericht !== null && ansicht.gerichte.some((g) => g.id === navigation.gericht)
      ? navigation.gericht
      : null
  );
  $effect(() => {
    if (navigation.gericht !== null && offenId === null) untrack(() => navigation.weg());
  });
  const zurueckText = $derived(navigation.von === 'plan' ? 'Zurück zum Plan' : 'Alle Gerichte');

  // A dish just opened gets the focus on its heading, so a phone shows no keyboard; a new one on
  // its name, to fill it in
  $effect(() => {
    if (!navigation.geoeffnet) return;
    const id = untrack(() => navigation.gericht);
    if (id !== null) void fokus(id);
  });
  async function fokus(id: number): Promise<void> {
    await tick();
    const feld =
      (navigation.zumNamen && document.getElementById(`gericht-${id}-name`)) ||
      document.getElementById(`gericht-${id}-titel`);
    feld?.focus({ preventScroll: true });
  }

  /** Opens a dish on its own page; a click with Ctrl or the middle button opens a new tab. */
  function oeffnen(event: MouseEvent, id: number): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void navigation.oeffnen(id);
  }

  /** Who is responsible for each dish anywhere in the plan, and whether it is the viewer. */
  const zustaendige = $derived(zustaendigeJeGericht(ansicht));
  let filter = $state<'alle' | 'meine'>('alle');
  const meine = $derived(ansicht.gerichte.filter((g) => zustaendige.get(g.id)?.ich));
  /** Whether the filter hides a dish in the list. */
  function versteckt(id: number): boolean {
    return filter === 'meine' && !zustaendige.get(id)?.ich;
  }

  async function anlegen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    felder = {};
    const gesendet = name;
    // What was sent; fields typed on during the save keep their new input
    const gesendetPersonen = personen;
    const gesendetZustaendig = zustaendig;
    const gesendetMahlzeit = mahlzeitId;
    let id = 0;
    const ok = await kontext.aendern(async () => {
      try {
        const antwort = await kontext.api.senden<{ id: number; ansicht: PlanungAnsicht }>(
          'POST',
          '/gerichte',
          {
            name: gesendet,
            personen:
              gesendetPersonen.trim() === '' ? null : Number(gesendetPersonen) || gesendetPersonen,
            ...(gesendetMahlzeit
              ? {
                  mahlzeitId: Number(gesendetMahlzeit),
                  ...zustaendigAus(gesendetZustaendig, ansicht.mitglieder),
                }
              : {}),
          }
        );
        id = antwort.id;
        return antwort;
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, `${gesendet.trim()} angelegt.`);
    if (!ok) return;
    if (name === gesendet) name = '';
    if (personen === gesendetPersonen) personen = '';
    if (zustaendig === gesendetZustaendig) zustaendig = '';
    // A new dish opens on its own page, with the focus on its name to fill it in
    await navigation.oeffnen(id, true);
  }

  /** Recipe cards as PDF; only with the central list, so they name all allergens. */
  async function rezeptkarten(gerichte: Gericht[], dateiName: string): Promise<void> {
    if (!katalog) return;
    const namen = new Map(katalog.unvertraeglichkeiten.map((u) => [u.id, u.name]));
    const { downloadRezeptkartenPdf } = await import('../../lib/essensplanungPdf');
    await downloadRezeptkartenPdf(ansicht, gerichte, namen, dateiName);
  }

  async function alleRezeptkarten(): Promise<void> {
    const { essenDateiName } = await import('../../lib/essensplanungPdf');
    await rezeptkarten(ansicht.gerichte, essenDateiName('Rezeptkarten', ansicht));
  }
</script>

<div class="space-y-6">
  {#if katalogFehler}
    <p class="text-sm text-danger print:hidden" role="alert">
      {katalogFehler}
      <button
        type="button"
        class="min-h-11 font-semibold underline"
        onclick={() => void katalogLaden()}
      >
        Noch einmal versuchen
      </button>
    </p>
  {/if}

  <!-- The list stays in the page while a dish is open, so a started new dish is kept -->
  <div class="space-y-6" hidden={offenId !== null}>
    {#if bearbeiten}
      <form class="surface flex flex-wrap items-end gap-3 p-3 print:hidden" onsubmit={anlegen}>
        <FormField
          id="gericht-neu-name"
          label="Neues Gericht"
          class="min-w-48 flex-[2]"
          error={felder.name}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              maxlength="150"
              placeholder="z. B. Chili sin Carne"
              bind:value={name}
            />
          {/snippet}
        </FormField>
        <FormField
          id="gericht-neu-personen"
          label="Personen"
          class="w-48"
          error={felder.personen}
          info="Für so viele Personen gelten die Mengen und wachsen mit den Essern. Leer gelten sie fest für jede Einplanung, z. B. 2 Brote fürs Frühstück."
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              inputmode="numeric"
              placeholder="leer: feste Mengen"
              bind:value={personen}
            />
          {/snippet}
        </FormField>
        <FormField
          id="gericht-neu-mahlzeit"
          label="Einplanen bei"
          optional
          class="min-w-48 flex-1"
          error={felder.mahlzeitId}
        >
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={mahlzeitId}>
              <option value="">nicht einplanen</option>
              {#each ansicht.tage as tag (tag.id)}
                <optgroup label="Tag {tag.nummer}">
                  {#each tag.mahlzeiten as mahlzeit (mahlzeit.id)}
                    <option value={String(mahlzeit.id)}>{mahlzeit.kennung} {mahlzeit.name}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          {/snippet}
        </FormField>
        {#if mahlzeitId}
          <FormField
            id="gericht-neu-zustaendig"
            label="Zuständig"
            optional
            class="min-w-40 flex-1"
            error={felder.zustaendigText ?? felder.zustaendigId}
          >
            {#snippet children(attrs)}
              <VorschlagFeld
                {...attrs}
                options={mitglieder}
                listLabel="Mitglieder"
                maxlength={100}
                placeholder="Name"
                bind:value={zustaendig}
              />
            {/snippet}
          </FormField>
        {/if}
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>Anlegen</ActionButton>
      </form>
    {/if}

    <!-- Stays during maintenance, locked, so an open conversion keeps what is typed -->
    {#if ansicht.zugang !== 'lesen'}<EinheitenHinweis {kontext} />{/if}

    {#if ansicht.gerichte.length}
      <PdfKnopf
        {kontext}
        label="Alle Rezeptkarten als PDF"
        disabled={!katalog}
        erstellen={alleRezeptkarten}
      />
      {#if ansicht.ichId !== null}
        <FilterTabs
          label="Gerichte zeigen"
          countNouns={['Gericht', 'Gerichte']}
          options={[
            { value: 'alle', label: 'Alle', count: ansicht.gerichte.length },
            { value: 'meine', label: 'Meine', count: meine.length },
          ]}
          value={filter}
          onselect={(wert) => (filter = wert)}
        />
      {/if}
      {#if filter === 'meine' && !meine.length}
        <p class="text-neutral-700">Du bist bei keinem Gericht zuständig.</p>
      {/if}
    {:else}
      <p class="text-neutral-700">Die Planung hat noch keine Gerichte.</p>
    {/if}
  </div>

  {#if ansicht.gerichte.length}
    <!-- While a dish is open, the list holds only its page -->
    <ul class="space-y-3" role={offenId !== null ? 'none' : undefined}>
      {#each ansicht.gerichte as gericht (gericht.id)}
        {@const wer = zustaendige.get(gericht.id)}
        {@const offen = offenId === gericht.id}
        <li
          id="gericht-{gericht.id}"
          role={offenId !== null ? 'none' : undefined}
          hidden={offenId !== null ? !offen : versteckt(gericht.id)}
        >
          {#if !offen}
            <a
              href={planungHash(kontext.token, gericht.id)}
              class="surface flex min-h-11 items-center gap-3 px-4 py-3 no-underline hover:border-brand-900"
              class:meins={wer?.ich}
              onclick={(event) => oeffnen(event, gericht.id)}
            >
              <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
                <span class="font-serif text-lg font-bold text-brand-900 [overflow-wrap:anywhere]">
                  {gericht.name}
                </span>
                <span class="text-sm text-neutral-700">
                  {gericht.zutaten.length} Zutaten{gericht.personen === null
                    ? ' · feste Mengen'
                    : ` · für ${gericht.personen} Personen`}
                </span>
                {#if wer?.ich}<StatusLabel label="Du bist zuständig" tone="success" dot />{/if}
                {#if wer?.namen.length}
                  <span class="basis-full text-sm text-neutral-700 [overflow-wrap:anywhere]">
                    Zuständig: {wer.namen.join(', ')}
                  </span>
                {/if}
              </span>
              <svg
                class="size-5 shrink-0 text-neutral-700"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </a>
          {/if}
          <article class="space-y-4" hidden={!offen} aria-labelledby="gericht-{gericht.id}-titel">
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-1 font-semibold text-link hover:underline print:hidden"
              onclick={() => navigation.zurueck()}
            >
              <span aria-hidden="true">←</span>
              {zurueckText}
            </button>
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2
                id="gericht-{gericht.id}-titel"
                tabindex="-1"
                class="font-serif text-2xl font-bold text-brand-900 [overflow-wrap:anywhere] focus:outline-none"
              >
                {gericht.name}
              </h2>
              {#if wer?.ich}<StatusLabel label="Du bist zuständig" tone="success" dot />{/if}
              {#if wer?.namen.length}
                <p class="basis-full text-sm text-neutral-700 [overflow-wrap:anywhere]">
                  Zuständig: {wer.namen.join(', ')}
                </p>
              {/if}
            </div>
            {#if bearbeiten}
              <p class="text-sm text-neutral-700 print:hidden">Wird sofort gespeichert.</p>
            {/if}
            <GerichtKarte
              {kontext}
              {katalog}
              {gericht}
              {bearbeiten}
              sichtbar={sichtbar && offen}
              onpdf={async () => {
                const { dateiName } = await import('../../lib/pdfBasis');
                await rezeptkarten(
                  [gericht],
                  dateiName('Rezeptkarte', 'Rezeptkarte', gericht.name)
                );
              }}
            />
          </article>
        </li>
      {/each}
    </ul>
  {/if}

  {#if ansicht.zutaten.length}
    <div hidden={offenId !== null}>
      <PlanZutaten {kontext} {katalog} {bearbeiten} />
    </div>
  {/if}
</div>

<style>
  /* Dishes the viewer is responsible for stand out by a bar on the left */
  .meins {
    border-left: 4px solid var(--color-success);
  }
</style>
