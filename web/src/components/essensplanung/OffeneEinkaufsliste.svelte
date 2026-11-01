<script lang="ts">
  import { einkaufsliste, postenMenge } from '../../lib/essensplanungEinkauf';
  import { herkunft } from '../../lib/essensplanungHerkunft';
  import type { EssenKatalog } from '../../lib/types';
  import HerkunftUmschalter from './HerkunftUmschalter.svelte';
  import NeuerZusatz from './NeuerZusatz.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PostenHerkunft from './PostenHerkunft.svelte';
  import { FELD, KNOPF, herkunftAnzeige } from './einkaufHerkunft.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The open shopping list as one dense table: by shop and category, the amount, the thing, the
   * dishes it is for (when switched on) and the shop to buy it at.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    katalogFehler: string | null;
    onkatalog: () => void;
    /** Names of the categories of the central list. */
    kategorien: Map<number, string>;
    /** What is typed under „Noch etwas besorgen“, kept by the area. */
    neuerZusatz: string;
  }
  let {
    kontext,
    katalog,
    katalogFehler,
    onkatalog,
    kategorien,
    neuerZusatz = $bindable(),
  }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);
  const liste = $derived(einkaufsliste(ansicht, kategorien));
  const zutaten = $derived(new Map(ansicht.zutaten.map((z) => [z.id, z])));
  const herkunftJe = $derived(herkunftAnzeige.an ? herkunft(ansicht) : null);
  const mitGeschaeft = $derived(bearbeiten && ansicht.geschaefte.length > 0);
  const spalten = $derived(2 + (herkunftJe ? 1 : 0) + (mitGeschaeft ? 1 : 0));

  async function geschaeftSetzen(feld: HTMLSelectElement, planungZutatId: number, name: string) {
    const geschaeftId = feld.value ? Number(feld.value) : null;
    const geschaeft = ansicht.geschaefte.find((g) => g.id === geschaeftId);
    // On the version the choice was made on: the choice of someone else meanwhile is a conflict
    const etag = zutaten.get(planungZutatId)?.etag;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/zutaten/${planungZutatId}/geschaeft`, { geschaeftId, etag }),
      geschaeft ? `${name} kaufst du bei ${geschaeft.name}.` : `${name} hat kein Geschäft mehr.`
    );
    // Not saved: the field shows the saved shop again, so the choice can be sent once more
    if (!ok) {
      const gespeichert = zutaten.get(planungZutatId)?.geschaeftId;
      feld.value = ansicht.geschaefte.some((g) => g.id === gespeichert) ? String(gespeichert) : '';
    }
  }
</script>

<section aria-labelledby="einkaufsliste-heading" class="space-y-2">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
    <h3 id="einkaufsliste-heading" class="font-serif text-lg font-bold text-brand-900">
      Einkaufsliste
    </h3>
    <HerkunftUmschalter />
    <!-- Only with the list, so each thing stands under its category -->
    <PdfKnopf
      {kontext}
      class="ml-auto {KNOPF}"
      label="Einkaufsliste als PDF"
      disabled={!katalog}
      erstellen={async () => {
        const { downloadEinkaufslistePdf } = await import('../../lib/essensplanungPdf');
        await downloadEinkaufslistePdf(ansicht, liste);
      }}
    />
  </div>
  {#if katalogFehler}
    <p class="text-sm text-danger print:hidden" role="alert">
      {katalogFehler}
      <button
        type="button"
        class="min-h-8 font-semibold underline any-pointer-coarse:min-h-11"
        onclick={onkatalog}>Noch einmal versuchen</button
      >
    </p>
  {/if}
  {#if liste.length}
    <table class="w-full text-left text-sm" aria-label="Einkaufsliste">
      <thead class="text-xs text-neutral-700">
        <tr class="border-b border-neutral-300">
          <th scope="col" class="w-20 py-1 pr-2 text-right font-semibold">Menge</th>
          <th scope="col" class="py-1 pr-2 font-semibold {herkunftJe ? 'md:w-56' : ''}">Zutat</th>
          {#if herkunftJe}
            <th scope="col" class="hidden py-1 pr-2 font-semibold md:table-cell"
              >Für welche Gerichte</th
            >
          {/if}
          {#if mitGeschaeft}
            <th scope="col" class="w-32 py-1 font-semibold md:w-40">Geschäft</th>
          {/if}
        </tr>
      </thead>
      {#each liste as gruppe (gruppe.geschaeft?.id ?? 0)}
        {@const name = gruppe.geschaeft?.name ?? 'Ohne Geschäft'}
        <tbody>
          <tr>
            <th
              scope="colgroup"
              colspan={spalten}
              class="border-y border-neutral-300 bg-neutral-200 px-2 py-1 text-sm font-bold text-brand-900"
            >
              {name}
            </th>
          </tr>
        </tbody>
        {#each gruppe.kategorien as kategorie (kategorie.name)}
          <tbody aria-label="{name}: {kategorie.name}">
            <tr>
              <th
                scope="colgroup"
                colspan={spalten}
                class="border-b border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-bold tracking-wide text-neutral-700 uppercase"
              >
                {kategorie.name}
              </th>
            </tr>
            {#each kategorie.posten as posten (`${posten.planungZutatId}:${posten.einheit}`)}
              <tr class="border-b border-neutral-200 align-top">
                <td class="py-1 pr-2 text-right font-semibold whitespace-nowrap tabular-nums"
                  >{`${postenMenge(posten)} `}</td
                >
                <th
                  scope="row"
                  class="py-1 pr-2 font-normal hyphens-auto [overflow-wrap:break-word]"
                >
                  {posten.name}
                  {#if herkunftJe}<PostenHerkunft
                      class="md:hidden"
                      herkunft={herkunftJe.get(posten.planungZutatId)}
                      name={posten.name}
                    />{/if}
                </th>
                {#if herkunftJe}
                  <td class="hidden py-1 pr-2 md:table-cell">
                    <PostenHerkunft
                      herkunft={herkunftJe.get(posten.planungZutatId)}
                      name={posten.name}
                    />
                  </td>
                {/if}
                {#if mitGeschaeft}
                  <td class="py-0.5">
                    <select
                      class="{FELD} w-full print:hidden"
                      aria-label="Geschäft für {posten.name}"
                      disabled={kontext.busy}
                      value={String(gruppe.geschaeft?.id ?? '')}
                      onchange={(event) =>
                        void geschaeftSetzen(
                          event.currentTarget,
                          posten.planungZutatId,
                          posten.name
                        )}
                    >
                      <option value="">Ohne Geschäft</option>
                      {#each ansicht.geschaefte as geschaeft (geschaeft.id)}
                        <option value={String(geschaeft.id)}>{geschaeft.name}</option>
                      {/each}
                    </select>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        {/each}
      {/each}
    </table>
  {:else}
    <p class="text-neutral-700">Noch nichts zu kaufen.</p>
  {/if}
  {#if bearbeiten}
    <NeuerZusatz {kontext} {katalog} bind:text={neuerZusatz} />
  {/if}
</section>
