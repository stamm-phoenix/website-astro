<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import QuerScroll from '../ui/QuerScroll.svelte';
  import BelegErfassen from './BelegErfassen.svelte';
  import BelegFotoDialog from './BelegFotoDialog.svelte';
  import BelegStatistik from './BelegStatistik.svelte';
  import BelegZeile from './BelegZeile.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import {
    belegStatistik,
    gefilterteBelege,
    type BelegFilter,
  } from '../../lib/essensplanungBelege';
  import { untrack } from 'svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { PlanungBeleg } from '../../lib/types';
  import { entwurfOffen, entwurfText, type BelegEntwuerfe } from './belegEntwuerfe';
  import { meldeVerloren, type PlanKontext } from './planKontext';

  /**
   * The receipts of a Planung: who paid what, what is paid back, and their photos. They stay in
   * the Planung; only „Belege als PDF“ takes them out.
   */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; photos load only once it was. */
    sichtbar?: boolean;
  }
  let { kontext, sichtbar = true }: Props = $props();
  let gezeigt = $state(false);
  $effect(() => {
    if (sichtbar) gezeigt = true;
  });
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The open form: a new receipt (with or without photo) or the photo of one. */
  let erfassen = $state<{ ohneFoto: boolean; belegId: number | null; nr: number } | null>(null);
  let zaehler = 0;
  let ansehenId = $state<number | null>(null);
  let filter = $state<BelegFilter>('alle');

  const statistik = $derived(belegStatistik(ansicht.belege));
  const sichtbar = $derived(gefilterteBelege(ansicht.belege, filter));
  const fotoBeleg = $derived(
    erfassen?.belegId != null
      ? (ansicht.belege.find((b) => b.id === erfassen!.belegId) ?? null)
      : null
  );
  const ansehen = $derived<PlanungBeleg | null>(
    ansicht.belege.find((b) => b.id === ansehenId && b.foto) ?? null
  );
  const filterOptionen = $derived([
    { value: 'alle', label: 'Alle', count: ansicht.belege.length },
    {
      value: 'offen',
      label: 'Zu erstatten',
      count: gefilterteBelege(ansicht.belege, 'offen').length,
    },
    {
      value: 'erstattet',
      label: 'Erstattet',
      count: gefilterteBelege(ansicht.belege, 'erstattet').length,
    },
  ] as { value: BelegFilter; label: string; count: number }[]);

  /** The open form, to switch its kind or ask before it goes. */
  let formular = $state<ReturnType<typeof BelegErfassen> | null>(null);
  /** Unsaved input of the rows, kept while a filter hides them or editing is locked. */
  const entwuerfe = $state<BelegEntwuerfe>({});

  $effect(() =>
    guardUnsavedChanges(() => Object.values(entwuerfe).some((entwurf) => entwurfOffen(entwurf)))
  );
  // A receipt someone else deleted takes its draft along; what was typed is named to copy
  $effect(() => {
    const ids = new Set(ansicht.belege.map((beleg) => beleg.id));
    untrack(() => {
      for (const [id, entwurf] of Object.entries(entwuerfe)) {
        if (ids.has(Number(id))) continue;
        if (entwurfOffen(entwurf))
          meldeVerloren(
            kontext,
            `Ein Beleg wurde inzwischen gelöscht; deine Eingabe dazu: ${entwurfText(entwurf)}.`
          );
        delete entwuerfe[Number(id)];
      }
    });
  });

  /**
   * Opens the form for a new receipt (with or without photo) or the photo of one. A new receipt
   * already open only switches its kind and keeps what is typed; another form with unsaved input
   * asks first.
   */
  async function oeffnen(ohneFoto: boolean, belegId: number | null = null): Promise<void> {
    if (erfassen && formular) {
      if (belegId === null && erfassen.belegId === null) {
        if (ohneFoto) {
          if (await formular.zuOhneFoto()) erfassen = { ...erfassen, ohneFoto };
        } else {
          formular.zuFoto();
          erfassen = { ...erfassen, ohneFoto };
        }
        return;
      }
      if (
        formular.ungespeichert() &&
        !(await confirmAction({
          title: 'Eingaben verwerfen?',
          message: 'Was du im offenen Beleg eingetragen oder fotografiert hast, geht verloren.',
          confirmLabel: 'Verwerfen',
        }))
      )
        return;
    }
    erfassen = { ohneFoto, belegId, nr: ++zaehler };
  }

  const kopf = 'px-1.5 py-1 font-semibold';
</script>

<section aria-labelledby="belege-heading" class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    <h2 id="belege-heading" class="mr-auto font-serif text-lg font-bold text-brand-900">Belege</h2>
    {#if bearbeiten}
      <ActionButton
        variant="primary"
        class="min-h-9 any-pointer-coarse:min-h-11"
        disabled={erfassen !== null && erfassen.belegId === null && !erfassen.ohneFoto}
        onclick={() => void oeffnen(false)}>Beleg mit Foto</ActionButton
      >
      <ActionButton
        class="min-h-9 any-pointer-coarse:min-h-11"
        disabled={erfassen !== null && erfassen.belegId === null && erfassen.ohneFoto}
        onclick={() => void oeffnen(true)}>Ohne Foto eintragen</ActionButton
      >
    {/if}
    <PdfKnopf
      {kontext}
      label="Belege als PDF"
      disabled={!ansicht.belege.length}
      erstellen={async () => {
        const { downloadBelegePdf } = await import('../../lib/essensplanungBelegePdf');
        const api = kontext.api;
        await downloadBelegePdf(
          ansicht,
          gefilterteBelege(ansicht.belege, 'alle'),
          async (beleg) => (await api.belegFoto(beleg.id, 'bild')).blob
        );
      }}
    />
  </div>

  <!-- Stays during maintenance, locked, so nothing typed or photographed gets lost -->
  {#if erfassen && ansicht.zugang !== 'lesen' && (erfassen.belegId === null || fotoBeleg)}
    {#key erfassen.nr}
      <BelegErfassen
        bind:this={formular}
        {kontext}
        beleg={fotoBeleg}
        ohneFoto={erfassen.ohneFoto}
        sofortWaehlen
        onfertig={() => (erfassen = null)}
      />
    {/key}
  {/if}

  {#if ansicht.belege.length}
    <div class="space-y-4">
      <div class="max-w-xl">
        <BelegStatistik {statistik} />
      </div>
      <div class="min-w-0 space-y-2">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <FilterTabs
            label="Belege zeigen"
            options={filterOptionen}
            value={filter}
            countNouns={['Beleg', 'Belege']}
            onselect={(value) => (filter = value)}
          />
          {#if bearbeiten}
            <p class="text-xs text-neutral-700">
              Änderungen in der Tabelle werden sofort gespeichert.
            </p>
          {/if}
        </div>
        {#if sichtbar.length}
          <!-- On a phone the rows are cards as wide as the screen, so nothing scrolls sideways -->
          <div class="max-md:[&_.w-max]:w-full">
            <QuerScroll
              label="Belege"
              hinweis="Weitere Spalten siehst du, wenn du seitlich wischst."
            >
              <table class="relative w-full border-collapse text-sm" data-testid="belege-tabelle">
                <thead class="max-md:sr-only">
                  <tr class="border-b-2 border-neutral-300 text-left text-xs text-neutral-700">
                    <th scope="col" class={kopf}>Datum</th>
                    <th scope="col" class={kopf}>Händler oder was</th>
                    <th scope="col" class="{kopf} text-right">Betrag</th>
                    <th scope="col" class={kopf}>Bezahlt von</th>
                    <th scope="col" class={kopf}>Erstattet</th>
                    <th scope="col" class={kopf}>Notiz</th>
                    <th scope="col" class={kopf}>Foto</th>
                    {#if bearbeiten}<th scope="col" class={kopf}
                        ><span class="sr-only">Aktionen</span></th
                      >{/if}
                  </tr>
                </thead>
                <tbody>
                  {#each sichtbar as beleg (beleg.id)}
                    <BelegZeile
                      {kontext}
                      {beleg}
                      {bearbeiten}
                      {entwuerfe}
                      fotos={gezeigt}
                      onfoto={() => void oeffnen(false, beleg.id)}
                      onansehen={() => (ansehenId = beleg.id)}
                    />
                  {/each}
                </tbody>
              </table>
            </QuerScroll>
          </div>
        {:else}
          <p class="text-sm text-neutral-700">
            {filter === 'offen' ? 'Alles ist erstattet.' : 'Noch nichts erstattet.'}
          </p>
        {/if}
      </div>
    </div>
  {:else if !erfassen}
    <p class="text-sm text-neutral-700">Noch keine Belege eingetragen.</p>
  {/if}
</section>

<BelegFotoDialog {kontext} beleg={ansehen} onclose={() => (ansehenId = null)} />
