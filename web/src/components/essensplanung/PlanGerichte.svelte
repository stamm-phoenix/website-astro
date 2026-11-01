<script lang="ts">
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { zustaendigAus } from '../../lib/essensplanungPlan';
  import { personenFehlen } from '../../lib/essensplanungRechnung';
  import { ApiError, errorMessage } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { EssenKatalog, Gericht, PlanungAnsicht } from '../../lib/types';
  import GerichtKarte from './GerichtKarte.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PlanZutaten from './PlanZutaten.svelte';
  import EinheitenHinweis from './EinheitenHinweis.svelte';
  import type { PlanKontext } from './planKontext';

  /** The dishes of a Planung and the ingredients they use; dishes download as recipe cards. */

  interface Props {
    kontext: PlanKontext;
    /** False while another tab is shown. */
    sichtbar: boolean;
    /** A dish to open for editing, e.g. clicked in the plan; `n` counts the requests. */
    ziel?: { id: number; n: number } | null;
  }
  let { kontext, sichtbar, ziel = null }: Props = $props();
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

  // A dish clicked in the plan opens, scrolled into view with its name field focused
  $effect(() => {
    void ziel?.n;
    const id = ziel?.id;
    if (id === undefined) return;
    untrack(() => void oeffne(id));
  });
  async function oeffne(id: number): Promise<void> {
    offen.add(id);
    await tick();
    const karte = document.getElementById(`gericht-${id}`);
    karte?.scrollIntoView({ block: 'start' });
    const feld = document.getElementById(`gericht-${id}-name`) ?? karte?.querySelector('summary');
    feld?.focus({ preventScroll: true });
  }

  /** The dishes shown open; a new one opens itself. */
  const offen = new SvelteSet<number>();

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
    offen.add(id);
    await tick();
    document.getElementById(`gericht-${id}`)?.scrollIntoView({ block: 'start' });
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

  function umschalten(id: number, auf: boolean): void {
    if (auf) offen.add(id);
    else offen.delete(id);
  }
</script>

<div class="space-y-6">
  {#if katalogFehler}
    <p class="text-sm text-danger print:hidden" role="alert">
      {katalogFehler}
      <button
        type="button"
        class="min-h-11 font-semibold underline"
        onclick={() => void katalogLaden()}>Noch einmal versuchen</button
      >
    </p>
  {/if}

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
        info="Für so viele Personen gelten die Mengen, die du einträgst. Leer lassen geht: dann zählen nur feste Mengen, bis du die Zahl einträgst."
      >
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" inputmode="numeric" bind:value={personen} />
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
    <ul class="space-y-3">
      {#each ansicht.gerichte as gericht (gericht.id)}
        <li id="gericht-{gericht.id}" class="surface scroll-mt-24">
          <details
            open={offen.has(gericht.id)}
            ontoggle={(event) => umschalten(gericht.id, event.currentTarget.open)}
          >
            <summary
              class="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 px-4 py-3 [&::-webkit-details-marker]:hidden"
            >
              <span class="font-serif text-lg font-bold text-brand-900 [overflow-wrap:anywhere]"
                >{gericht.name}</span
              >
              <span class="text-sm text-neutral-700"
                >{gericht.zutaten.length} Zutaten{gericht.personen === null
                  ? ''
                  : ` · für ${gericht.personen} Personen`}</span
              >
              {#if gericht.personen === null}
                <span
                  class="text-sm font-semibold {personenFehlen(gericht)
                    ? 'text-warning'
                    : 'text-neutral-700'}">Personenzahl fehlt</span
                >
              {/if}
              <AufklappPfeil class="ml-auto self-center" />
            </summary>
            <div class="px-4 pb-4">
              <GerichtKarte
                {kontext}
                {katalog}
                {gericht}
                {bearbeiten}
                sichtbar={sichtbar && offen.has(gericht.id)}
                onpdf={async () => {
                  const { dateiName } = await import('../../lib/pdfBasis');
                  await rezeptkarten(
                    [gericht],
                    dateiName('Rezeptkarte', 'Rezeptkarte', gericht.name)
                  );
                }}
              />
            </div>
          </details>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-neutral-700">Die Planung hat noch keine Gerichte.</p>
  {/if}

  {#if ansicht.zutaten.length}
    <PlanZutaten {kontext} {katalog} {bearbeiten} />
  {/if}
</div>
