<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { paymentSummary, orderStatusTone } from '../../lib/sammelPayment';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { SAMMEL_SHOPS, getSammelShop, sammelAvailabilityLabel } from '../../lib/sammelShops';
  import { sammelReceipt } from '../../lib/sammelExport';
  import type { SammelOrderFilters } from '../../lib/sammelStaffView';
  import { ORDER_FILTERS, money, download, filterOrders } from '../../lib/sammelStaffView';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { errorMessage } from '../../lib/api';
  import type { Notice } from '../../lib/status';
  import type { SammelBestellung } from '../../lib/types';
  interface Props {
    filters: SammelOrderFilters;
    campaignTitle: string;
    orders: SammelBestellung[];
    prices: Record<string, number | null>;
    availability: Record<string, string | undefined>;
    busy: boolean;
    loading: boolean;
    selected: string;
    linePrice: (reference: string, quantity?: number) => string;
    onreload: () => void;
    onmessage: (order: SammelBestellung) => void;
    onedit: (order: SammelBestellung) => void;
    onpayment: (order: SammelBestellung) => void;
    onitem: (order: SammelBestellung, index: number) => void;
  }
  let {
    filters = $bindable(),
    campaignTitle,
    orders,
    prices,
    availability,
    busy,
    loading,
    selected,
    linePrice,
    onreload,
    onmessage,
    onedit,
    onpayment,
    onitem,
  }: Props = $props();
  /** Availability values worth a line; an unknown availability says nothing. */
  const KNOWN_AVAILABILITY = ['available', 'unavailable', 'preorder'];
  const filtered = $derived(filterOrders(orders, filters));
  let pdfBusy = $state(false);
  let pdfNotice = $state<Notice | null>(null);

  /** The shown orders as a list to hand them out and tick them off. */
  async function exportPdf(): Promise<void> {
    pdfBusy = true;
    pdfNotice = null;
    try {
      const shown = { campaignTitle, orders: filtered, filters };
      const { downloadAusgabeliste } = await import('../../lib/sammelPdf');
      await downloadAusgabeliste(shown);
      pdfNotice = { text: 'Ausgabeliste heruntergeladen.', kind: 'success' };
    } catch (error) {
      pdfNotice = {
        text: errorMessage(
          error,
          'Die Ausgabeliste konnte nicht erstellt werden. Lade die Seite neu und versuche es noch einmal.'
        ),
        kind: 'error',
      };
    } finally {
      pdfBusy = false;
    }
  }
  /** Clears filters.search and active filters and reveals completed orders. */
  function showAllOrders(): void {
    filters.search = '';
    filters.showFinished = true;
    filters.activeFilters = {
      submitted: false,
      unpriced: false,
      unpaid: false,
      undelivered: false,
    };
  }
</script>

<section aria-labelledby="orders-heading" class="mt-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="orders-heading" class="mr-auto font-serif text-2xl font-semibold text-brand-900">
      Bestellungen
    </h2>
    <ReloadAction type="button" disabled={loading || busy || !selected} onclick={onreload}
      >Neu laden</ReloadAction
    >
    <ActionButton
      variant="secondary"
      type="button"
      onclick={() =>
        download('sammelbestellung-einzelbestellungen.csv', [
          [
            'Name',
            'E-Mail',
            'Anbieter',
            'Artikel',
            'Mitbestellen',
            'Kommentar zum Ausschluss',
            'Artikelnummer / Link',
            'Variante',
            'Anzahl',
            'Status',
            'Bezahlt',
            'Ausgeliefert',
            'Gesamtbetrag EUR',
            'Bemerkungen',
          ],
          ...orders.flatMap((o) =>
            o.items.map((item) => [
              o.name,
              o.email,
              SAMMEL_SHOPS[getSammelShop(item.reference, item.shop)].name,
              item.name,
              item.excluded ? 'Nein' : 'Ja',
              item.excluded?.reason ?? '',
              item.reference,
              item.variant,
              item.quantity,
              o.status,
              o.paid ? 'Ja' : 'Nein',
              o.delivered ? 'Ja' : 'Nein',
              o.totalCents === null ? '' : (o.totalCents / 100).toFixed(2),
              o.notes,
            ])
          ),
        ])}
      disabled={!orders.length}>Einzelbestellungen herunterladen (CSV)</ActionButton
    >
    <ActionButton
      variant="secondary"
      type="button"
      disabled={pdfBusy || !filtered.some((order) => order.status !== 'Storniert')}
      onclick={() => void exportPdf()}
      >{pdfBusy ? 'Erstellt PDF …' : 'Ausgabeliste herunterladen (PDF)'}</ActionButton
    >
  </div>
  <StatusNotice
    message={pdfNotice?.text ?? null}
    kind={pdfNotice?.kind}
    class="mt-3 empty:hidden"
    popup
  />
  <label for="order-search" class="form-label mt-4">Nach Name oder E-Mail suchen</label><input
    id="order-search"
    class="form-input max-w-md"
    type="search"
    bind:value={filters.search}
  />
  <fieldset class="mt-4">
    <legend class="form-label">Bestellungen filtern</legend>
    <div class="flex flex-wrap gap-x-5 gap-y-1">
      {#each ORDER_FILTERS as filter (filter.key)}
        <button
          type="button"
          aria-pressed={filters.activeFilters[filter.key]}
          class="py-2 text-sm font-semibold decoration-2 underline-offset-[6px] {filters
            .activeFilters[filter.key]
            ? 'text-brand-900 underline decoration-accent-500'
            : 'text-neutral-700 hover:text-brand-900 hover:underline'}"
          onclick={() => (filters.activeFilters[filter.key] = !filters.activeFilters[filter.key])}
          >{filter.label}</button
        >
      {/each}
    </div>
  </fieldset>
  <label class="mt-4 flex items-center gap-2 text-sm text-neutral-700">
    <input type="checkbox" bind:checked={filters.showFinished} class="h-4 w-4 accent-brand-900" />
    Erledigte und stornierte Bestellungen anzeigen
  </label>
  <p class="mt-3 text-sm text-neutral-700" role="status" aria-live="polite">
    {filtered.length} von {orders.length} Bestellungen angezeigt
  </p>
  <div class="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
    {#each filtered as order (order.id)}
      {@const orderReceipt = sammelReceipt(order.items, prices)}
      <article class="py-5">
        <div class="flex flex-wrap justify-between gap-3">
          <div>
            <h3 class="font-semibold text-brand-900">{order.name}</h3>
            <p class="break-all text-sm text-neutral-700">{order.email}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <ActionButton
              variant="secondary"
              type="button"
              onclick={() => {
                onmessage(order);
              }}>Nachricht schreiben</ActionButton
            >
            <ActionButton variant="secondary" type="button" onclick={() => onedit(order)}
              >Status bearbeiten</ActionButton
            >
            <ActionButton variant="secondary" type="button" onclick={() => onpayment(order)}
              >Bezahlung verwalten</ActionButton
            >
          </div>
        </div>
        <ul class="mt-3 space-y-1 text-sm">
          {#each order.items as item, index (item)}<li>
              <span class={item.excluded ? 'line-through text-neutral-500' : ''}
                >{item.quantity} × {item.name}{item.variant ? ` · ${item.variant}` : ''}</span
              >
              {#if !item.excluded}<span
                  class="float-right ml-3 font-semibold tabular-nums text-brand-900"
                  >{linePrice(item.reference, item.quantity)}</span
                >{/if}<span class="block break-all text-xs text-neutral-700"
                >{SAMMEL_SHOPS[getSammelShop(item.reference, item.shop)].name} · {item.reference}</span
              >
              {#if KNOWN_AVAILABILITY.includes(availability[item.reference] ?? '')}<span
                  class="block text-xs text-neutral-700"
                  >{sammelAvailabilityLabel(availability[item.reference])}</span
                >{/if}
              {#if item.excluded}<p class="text-sm text-danger">
                  Wird nicht mitbestellt{item.excluded.reason ? ': ' + item.excluded.reason : ''}
                </p>{/if}
              <button
                type="button"
                class="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-800 underline"
                disabled={busy || order.status === 'Storniert' || order.payment?.locked}
                onclick={() => {
                  onitem(order, index);
                }}>{item.excluded ? 'Wieder mitbestellen' : 'Nicht mitbestellen'}</button
              >
            </li>{/each}
        </ul>
        <p
          class="mt-3 flex justify-between gap-3 border-t border-neutral-200 pt-3 text-sm font-semibold text-brand-900"
        >
          <span>{orderReceipt.totalCents === null ? 'Shop-Zwischensumme' : 'Shop-Summe'}</span>
          <span class="tabular-nums">{money(orderReceipt.subtotalCents)}</span>
        </p>
        {#if order.notes}<p class="mt-3 whitespace-pre-line text-sm text-neutral-700">
            {order.notes}
          </p>{/if}
        <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLabel label={order.status} tone={orderStatusTone(order.status)} />
          <span class="text-sm font-semibold tabular-nums">{money(order.totalCents)}</span>
          <StatusLabel
            label={order.paid ? 'Bezahlt' : 'Unbezahlt'}
            tone={order.paid ? 'success' : 'neutral'}
          />
          <StatusLabel
            label={order.delivered ? 'Ausgeliefert' : 'Nicht ausgeliefert'}
            tone={order.delivered ? 'success' : 'neutral'}
          />
        </div>
        {#if order.payment}
          {@const payment = paymentSummary(order.payment)}
          <p class="mt-1"><StatusLabel {...payment} /></p>
          {#if order.payment.reference}<p class="mt-1 break-all text-sm text-neutral-700">
              CampFlow-Referenz {order.payment.reference}
            </p>{/if}
        {/if}
      </article>
    {:else}<div class="py-5">
        <p class="text-neutral-700">Keine Bestellungen passen zur aktuellen Auswahl.</p>
        {#if orders.length}<ActionButton
            variant="secondary"
            type="button"
            class="mt-3"
            onclick={showAllOrders}>Alle Bestellungen anzeigen</ActionButton
          >{/if}
      </div>{/each}
  </div>
</section>
