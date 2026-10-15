<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { SAMMEL_SHOPS, getSammelShop, type SammelShop } from '../../lib/sammelShops';
  import { aggregateSammelItems, sammelReceipt } from '../../lib/sammelExport';
  import { money, download } from '../../lib/sammelStaffView';
  import type { SammelBestellung } from '../../lib/types';
  interface Props {
    exportShop: SammelShop | 'all';
    orders: SammelBestellung[];
    prices: Record<string, number | null>;
    pricesLoading: boolean;
    linePrice: (reference: string, quantity?: number) => string;
  }
  let { exportShop = $bindable(), orders, prices, pricesLoading, linePrice }: Props = $props();
  const combined = $derived(aggregateSammelItems(orders));
  const receipt = $derived(sammelReceipt(combined, prices));
  const exportItems = $derived(
    combined.filter(
      (row) => exportShop === 'all' || getSammelShop(row.reference, row.shop) === exportShop
    )
  );
  /** Exports the displayed receipt amounts and its completeness warning. */
  function downloadReceipt(): void {
    const exportReceipt = sammelReceipt(exportItems, prices);
    download(`sammelbestellung-${exportShop === 'all' ? 'einkaufsliste' : exportShop}.csv`, [
      ['Anbieter', 'Artikel', 'Artikelnummer / Link', 'Variante', 'Anzahl', 'Stückpreis', 'Summe'],
      ...exportItems.map((row) => [
        SAMMEL_SHOPS[getSammelShop(row.reference, row.shop)].name,
        row.name,
        row.reference,
        row.variant,
        row.quantity,
        linePrice(row.reference),
        linePrice(row.reference, row.quantity),
      ]),
      [
        exportReceipt.totalCents === null ? 'Zwischensumme bekannter Preise' : 'Gesamtsumme',
        '',
        '',
        '',
        '',
        '',
        money(exportReceipt.subtotalCents),
      ],
      ...(exportReceipt.missingPositions
        ? [['Fehlende Preise', exportReceipt.missingPositions]]
        : []),
      [
        'Stammesartikel mit Listenpreis, Shop-Artikel mit aktuellem Richtpreis. Ohne Versand. Variantenpreise bitte prüfen.',
      ],
    ]);
  }
</script>

<section aria-labelledby="combined-heading" class="mt-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="combined-heading" class="font-serif text-2xl font-semibold text-brand-900">
      Bestellliste nach Anbieter
    </h2>
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <label for="export-shop" class="form-label">CSV für</label>
        <select id="export-shop" class="form-input" bind:value={exportShop}>
          <option value="all">Alle Anbieter</option>
          {#each Object.entries(SAMMEL_SHOPS) as [key, shop] (key)}<option value={key}
              >{shop.name}</option
            >{/each}
        </select>
      </div>
      <ActionButton
        variant="secondary"
        type="button"
        disabled={!exportItems.length || pricesLoading}
        onclick={downloadReceipt}>Bestellliste als CSV</ActionButton
      >
    </div>
  </div>
  <p class="mt-2 text-sm text-neutral-700">
    Gleiche Produktlinks oder Artikelnummern beim selben Anbieter mit gleicher Variante werden
    zusammengefasst, auch bei unterschiedlichen Artikelnamen. Stornierte Bestellungen sind
    ausgeschlossen.
  </p>
  <div class="mt-4">
    <div class="overflow-x-auto">
      <table class="min-w-[760px] w-full text-left text-sm">
        <caption class="sr-only">Zusammengefasste Artikel nach Anbieter</caption><thead
          class="border-b-2 border-neutral-300 text-neutral-700"
          ><tr
            ><th scope="col" class="p-3">Anbieter</th><th scope="col" class="p-3">Artikel</th><th
              scope="col"
              class="p-3">Variante</th
            ><th scope="col" class="p-3 text-right">Anzahl</th><th
              scope="col"
              class="p-3 text-right">Stückpreis</th
            ><th scope="col" class="p-3 text-right">Summe</th></tr
          ></thead
        ><tbody
          >{#each combined as row (row)}<tr class="border-t border-neutral-200"
              ><td class="p-3">{SAMMEL_SHOPS[getSammelShop(row.reference, row.shop)].name}</td><td
                class="p-3"
                >{row.name}<span class="block max-w-xl break-all text-xs text-neutral-700"
                  >{row.reference}</span
                ></td
              ><td class="p-3">{row.variant || '–'}</td><td
                class="p-3 text-right font-semibold tabular-nums">{row.quantity}</td
              ><td class="p-3 text-right whitespace-nowrap tabular-nums"
                >{linePrice(row.reference)}</td
              ><td class="p-3 text-right whitespace-nowrap font-semibold tabular-nums"
                >{linePrice(row.reference, row.quantity)}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
    <dl
      class="flex items-baseline justify-between gap-4 border-t-2 border-brand-900 p-4 text-brand-900"
    >
      <dt class="font-semibold">
        {receipt.totalCents === null ? 'Zwischensumme bekannter Preise' : 'Gesamtsumme'}
      </dt>
      <dd class="text-lg font-bold whitespace-nowrap tabular-nums">
        {money(receipt.subtotalCents)}
      </dd>
    </dl>
  </div>
  <p class="mt-3 text-sm text-neutral-700" role="status" aria-live="polite">
    {#if pricesLoading}Shop-Preise werden geladen …
    {:else if receipt.missingPositions}{receipt.missingPositions} Position(en) ohne Preis. Die Gesamtsumme
      ist noch unvollständig.
    {/if}
  </p>
  <p class="mt-1 text-xs text-neutral-700">
    Stammesartikel mit Listenpreis, Shop-Artikel mit aktuellem Richtpreis. Ohne Versand. Die
    vollständige Artikelsumme wird in der Statusbearbeitung vorbelegt. Variantenpreise und
    Versandkosten dort bei Bedarf anpassen.
  </p>
</section>
