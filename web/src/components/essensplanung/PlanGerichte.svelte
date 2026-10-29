<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { EssenKatalog, Gericht, PlanungAnsicht } from '../../lib/types';
  import GerichtKarte from './GerichtKarte.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PlanZutaten from './PlanZutaten.svelte';
  import type { PlanKontext } from './planKontext';

  /** The dishes of a Planung and the ingredients they use; dishes download as recipe cards. */

  interface Props {
    kontext: PlanKontext;
    /** False while another tab is shown. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
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
  let personen = $state('10');
  let felder = $state<Record<string, string>>({});
  $effect(() => guardUnsavedChanges(() => name.trim() !== ''));

  /** The dishes shown open; a new one opens itself. */
  const offen = new SvelteSet<number>();

  async function anlegen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    felder = {};
    const gesendet = name;
    let id = 0;
    const ok = await kontext.aendern(async () => {
      try {
        const antwort = await kontext.api.senden<{ id: number; ansicht: PlanungAnsicht }>(
          'POST',
          '/gerichte',
          { name: gesendet, personen: Number(personen) || personen }
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
    <form class="surface flex flex-wrap items-end gap-3 p-4 print:hidden" onsubmit={anlegen}>
      <FormField
        id="gericht-neu-name"
        label="Neues Gericht"
        class="min-w-0 flex-1"
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
        class="w-28"
        error={felder.personen}
        info="Für so viele Personen gelten die Mengen, die du einträgst."
      >
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" inputmode="numeric" bind:value={personen} />
        {/snippet}
      </FormField>
      <ActionButton type="submit" variant="primary" disabled={kontext.busy}>Anlegen</ActionButton>
    </form>
  {/if}

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
              class="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 px-4 py-3 print:list-none"
            >
              <span class="font-serif text-lg font-bold text-brand-900 [overflow-wrap:anywhere]"
                >{gericht.name}</span
              >
              <span class="text-sm text-neutral-700"
                >{gericht.zutaten.length} Zutaten · für {gericht.personen} Personen</span
              >
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
