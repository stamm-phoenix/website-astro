<script lang="ts">
  import { getSammelStammProdukt } from '../../lib/sammelKatalog';
  import {
    SAMMEL_SHOPS,
    getSammelShop,
    isSammelProductUrl,
    sammelAvailabilityLabel,
  } from '../../lib/sammelShops';
  import type { SammelShop } from '../../lib/sammelShops';
  import { onMount } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import SammelInvitationRelease from './SammelInvitationRelease.svelte';
  import SammelMessageDialog from './SammelMessageDialog.svelte';
  import SammelPaymentDialog from './SammelPaymentDialog.svelte';
  import { fetchApi, sendApi, ApiError } from '../../lib/api';
  import { SAMMEL_STATUS, isSammelOpen } from '../../lib/sammelbestellung';
  import { aggregateSammelItems, sammelCsv, sammelReceipt } from '../../lib/sammelExport';
  import type {
    SammelBestellung,
    SammelStaffView,
    SammelProductInfo,
    SammelSaveResult,
  } from '../../lib/types';

  const BASE = '/intern/pflege/sammelbestellungen';
  let selected = $state('');
  let view = $state<SammelStaffView | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let dialogError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let editing = $state<SammelBestellung | null>(null);
  let messageOrder = $state<SammelBestellung | null>(null);
  let paymentOrder = $state<SammelBestellung | null>(null);
  let total = $state<number | undefined>(undefined);
  let search = $state('');
  let prices = $state<Record<string, number | null>>({});
  let availability = $state<Record<string, string | undefined>>({});
  let pricesLoading = $state(false);
  let itemEditing = $state<{ order: SammelBestellung; index: number } | null>(null);
  let itemReason = $state('');
  let itemError = $state<string | null>(null);
  let exportShop = $state<SammelShop | 'all'>('all');
  let showFinished = $state(false);
  let activeFilters = $state({
    submitted: false,
    unpriced: false,
    unpaid: false,
    undelivered: false,
  });
  const ORDER_FILTERS = [
    { key: 'submitted', label: 'Eingereicht' },
    { key: 'unpriced', label: 'Noch offen' },
    { key: 'unpaid', label: 'Unbezahlt' },
    { key: 'undelivered', label: 'Nicht ausgeliefert' },
  ] as const;
  const orders = $derived(view?.orders.filter((order) => order.submitted) ?? []);
  const filtered = $derived(
    orders.filter(
      (order) =>
        (showFinished || !isFinished(order)) &&
        `${order.name} ${order.email}`.toLowerCase().includes(search.trim().toLowerCase()) &&
        (!activeFilters.submitted || order.status === 'Eingereicht') &&
        (!activeFilters.unpriced || order.totalCents === null) &&
        (!activeFilters.unpaid || !order.paid) &&
        (!activeFilters.undelivered || !order.delivered)
    )
  );
  const combined = $derived(aggregateSammelItems(orders));
  const receipt = $derived(sammelReceipt(combined, prices));
  const exportItems = $derived(
    combined.filter(
      (row) => exportShop === 'all' || getSammelShop(row.reference, row.shop) === exportShop
    )
  );
  /** Formats campaign timestamps in German using the Europe/Berlin time zone. */
  const formatDate = (date: string): string =>
    new Date(date).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  /** Formats stored cent amounts as euros, preserving an unset staff price. */
  const money = (cents: number | null): string =>
    cents === null
      ? 'Noch offen'
      : (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  /** Turns an API failure into a visible message without assuming a specific thrown type. */
  function errorText(caught: unknown): string {
    return caught instanceof Error ? caught.message : 'Die Daten konnten nicht geladen werden.';
  }
  /** Classifies cancelled orders and fully priced, paid and delivered arrivals as completed. */
  function isFinished(order: SammelBestellung): boolean {
    return (
      order.status === 'Storniert' ||
      (order.status === 'Eingetroffen' &&
        order.totalCents !== null &&
        order.paid &&
        order.delivered)
    );
  }
  /** Clears search and active filters and reveals completed orders. */
  function showAllOrders(): void {
    search = '';
    showFinished = true;
    activeFilters = { submitted: false, unpriced: false, unpaid: false, undelivered: false };
  }
  let loadRevision = 0;
  /** Reloads the campaign detail, rejecting responses from superseded loads or unmounted pages. */
  async function loadSelected(): Promise<void> {
    if (!selected) return;
    const revision = ++loadRevision;
    loading = true;
    error = null;
    message = null;
    view = null;
    prices = {};
    availability = {};
    pricesLoading = false;
    try {
      const nextView = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
      if (revision === loadRevision) {
        view = nextView;
        void loadPrices(nextView, revision);
        document.title = `${nextView.campaign.title} | Sammelbestellungen | Stamm Phoenix`;
      }
    } catch (caught) {
      if (revision === loadRevision) error = errorText(caught);
    } finally {
      if (revision === loadRevision) loading = false;
    }
  }
  /** Loads each distinct shop link once with four workers and isolated lookup failures. */
  async function loadPrices(nextView: SammelStaffView, revision: number): Promise<void> {
    const references = [
      ...new Set(
        nextView.orders
          .filter((order) => order.submitted)
          .flatMap((order) => order.items.map((item) => item.reference.trim()))
      ),
    ];
    pricesLoading = true;
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, references.length) }, async () => {
        while (index < references.length && revision === loadRevision) {
          const reference = references[index++];
          let price: number | null = getSammelStammProdukt(reference)?.unitPriceCents ?? null;
          try {
            if (isSammelProductUrl(reference)) {
              const product = await sendApi<SammelProductInfo>('POST', `${BASE}/product`, {
                reference,
              });
              price = product.unitPriceCents;
              if (revision === loadRevision) availability[reference] = product.availability;
            }
          } catch {
            // Missing prices keep orders available and leave the receipt visibly incomplete.
          }
          if (revision === loadRevision) prices = { ...prices, [reference]: price };
        }
      })
    );
    if (revision === loadRevision) pricesLoading = false;
  }
  /** Returns the fetched unit price without treating missing values as zero. */
  function unitPrice(reference: string): number | null {
    return getSammelStammProdukt(reference)?.unitPriceCents ?? prices[reference.trim()] ?? null;
  }
  /** Formats a line amount, distinguishing pending lookups from unavailable prices. */
  function linePrice(reference: string, quantity = 1): string {
    const price = unitPrice(reference);
    return price === null
      ? pricesLoading
        ? 'Wird geladen …'
        : 'Preis fehlt'
      : money(price * quantity);
  }
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
  onMount(() => {
    selected =
      window.location.pathname.match(/^\/leitendenbereich\/sammelbestellungen\/(\d+)\/?$/)?.[1] ??
      '';
    if (selected) void loadSelected();
    else {
      loading = false;
      error = 'Ungültiger Link zur Sammelbestellung. Bitte öffne sie über die Übersicht.';
    }
    return () => {
      loadRevision++;
    };
  });
  /** Archives or restores the loaded campaign and refreshes its detail view. */
  async function archiveSelected(): Promise<void> {
    if (!view || busy) return;
    const campaign = view.campaign;
    busy = true;
    error = null;
    message = null;
    try {
      await sendApi('PATCH', `${BASE}/${campaign.id}`, {
        etag: campaign.etag,
        archived: !campaign.archived,
      });
      await loadSelected();
      if (!error)
        message = campaign.archived
          ? 'Sammelbestellung wiederhergestellt.'
          : 'Sammelbestellung archiviert. Alle Bestellungen bleiben erhalten.';
    } catch (caught) {
      error = errorText(caught);
    } finally {
      busy = false;
    }
  }
  /** Copies the selected order into a status draft with its loaded ETag and euro amount. */
  function edit(order: SammelBestellung): void {
    editing = { ...order, items: order.items.map((item) => ({ ...item })) };
    const cents = order.totalCents ?? sammelReceipt(order.items, prices).totalCents;
    total = cents === null ? undefined : cents / 100;
    dialogError = null;
  }
  /** Saves staff fields and reloads conflicts so a stale ETag cannot trap the editor. */
  async function saveStatus(): Promise<void> {
    if (!editing) return;
    busy = true;
    dialogError = null;
    try {
      await sendApi('PATCH', `${BASE}/orders/${editing.id}`, {
        etag: editing.etag,
        status: editing.status,
        paid: editing.paid,
        delivered: editing.delivered,
        totalCents: total === undefined ? null : Math.round(total * 100),
      });
      editing = null;
      await loadSelected();
      message = 'Bestellstatus gespeichert.';
    } catch (caught) {
      if (caught instanceof ApiError && [409, 412].includes(caught.status)) {
        editing = null;
        await loadSelected();
        const conflict = 'Die Bestellung wurde inzwischen geändert. Bitte erneut bearbeiten.';
        error = error ? `${conflict} ${error}` : conflict;
        return;
      }
      dialogError =
        caught instanceof ApiError && caught.fields
          ? Object.values(caught.fields).join(' ')
          : errorText(caught);
    } finally {
      busy = false;
    }
  }
  /** Downloads an encoded CSV through a temporary object URL and releases it afterwards. */
  function download(name: string, rows: (string | number)[][]): void {
    const url = URL.createObjectURL(
      new Blob([sammelCsv(rows)], { type: 'text/csv;charset=utf-8' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** Copies the shared campaign invitation, with manual-copy guidance on clipboard failure. */
  async function copyInvitation(): Promise<void> {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.invitationUrl);
      message = 'Einladungslink kopiert.';
    } catch {
      error = 'Bitte markiere und kopiere den Einladungslink im Textfeld.';
    }
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
  <a
    class="btn-secondary"
    href={view?.campaign.archived
      ? '/leitendenbereich/sammelbestellungen?archiv=1'
      : '/leitendenbereich/sammelbestellungen'}>Zur Übersicht</a
  >
</div>
<header class="surface mt-6 p-5 sm:p-8">
  <p class="badge">Sammelbestellung</p>
  <h1 class="mt-3 font-serif text-3xl text-brand-900">
    {view?.campaign.title ?? 'Sammelbestellung'}
  </h1>
  {#if view?.campaign.description}<p class="mt-3 whitespace-pre-line text-neutral-700">
      {view.campaign.description}
    </p>{/if}
</header>
{#if loading}<p class="mt-5" role="status" aria-live="polite">Daten werden geladen …</p>{/if}
{#if error}<div role="alert" class="mt-5 text-[var(--color-dpsg-red)]">
    <p>{error}</p>
    {#if selected}<button
        class="btn-secondary mt-3"
        disabled={loading || busy}
        onclick={() => void loadSelected()}>Erneut laden</button
      >{/if}
  </div>{/if}
<StatusNotice {message} class="mt-5" />
{#if view}
  <section
    aria-labelledby="archive-heading"
    class="surface mt-6 flex flex-wrap items-center justify-between gap-4 p-5"
  >
    <div>
      <h2 id="archive-heading" class="font-serif text-xl text-brand-900">
        {view.campaign.archived ? 'Archivierte Sammelbestellung' : 'Aktuelle Sammelbestellung'}
      </h2>
      <p class="mt-1 text-sm text-neutral-700">
        {view.campaign.archived
          ? 'Alle Bestellungen bleiben einsehbar. Neue Bestellungen und Änderungen durch Mitglieder sind gesperrt.'
          : 'Archivieren blendet diese Sammelbestellung aus der aktuellen Auswahl aus. Die Daten bleiben erhalten.'}
      </p>
    </div>
    <button
      type="button"
      class="btn-secondary"
      disabled={busy || loading}
      onclick={() => void archiveSelected()}
    >
      {view.campaign.archived ? 'Wiederherstellen' : 'Archivieren'}
    </button>
  </section>
  <section aria-labelledby="invite-heading" class="surface mt-6 p-5">
    <h2 id="invite-heading" class="font-serif text-xl text-brand-900">Einladung über CampFlow</h2>
    <p class="mt-2 text-sm text-neutral-700">
      {formatDate(view.campaign.startsAt)} bis {formatDate(view.campaign.endsAt)} Uhr · {isSammelOpen(
        view.campaign
      )
        ? 'Bestellzeitraum offen'
        : 'Bestellzeitraum geschlossen'}
    </p>
    <p class="mt-3 text-sm text-neutral-700">
      Diesen Link erhalten alle Mitglieder in derselben CampFlow-Mail. Die Website verschickt
      anschließend die persönlichen Bestelllinks. Der Einladungslink ist nur für Mitglieder
      bestimmt.
    </p>
    <label class="form-label mt-4" for="invitation-url">Gemeinsamer Einladungslink</label>
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        id="invitation-url"
        class="form-input min-w-0 flex-1"
        readonly
        value={view.invitationUrl}
      /><button
        class="btn-secondary"
        disabled={view.campaign.archived}
        onclick={() => void copyInvitation()}>Link kopieren</button
      >
    </div>
    <SammelInvitationRelease
      campaignId={view.campaign.id}
      disabled={!isSammelOpen(view.campaign) || busy || loading}
    />
  </section>
  <div class="mt-6 grid gap-3 sm:grid-cols-3">
    <div class="surface p-4">
      <p class="text-sm text-neutral-700">Bestellungen</p>
      <p class="font-serif text-3xl text-brand-900">
        {orders.filter((o) => o.status !== 'Storniert').length}
      </p>
    </div>
    <div class="surface p-4">
      <p class="text-sm text-neutral-700">Noch unbezahlt</p>
      <p class="font-serif text-3xl text-brand-900">
        {orders.filter((o) => !o.paid && o.status !== 'Storniert').length}
      </p>
    </div>
    <div class="surface p-4">
      <p class="text-sm text-neutral-700">Noch nicht ausgeliefert</p>
      <p class="font-serif text-3xl text-brand-900">
        {orders.filter((o) => !o.delivered && o.status !== 'Storniert').length}
      </p>
    </div>
  </div>
  <section aria-labelledby="orders-heading" class="mt-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="orders-heading" class="font-serif text-2xl text-brand-900">Bestellungen</h2>
      <button
        type="button"
        class="btn-secondary"
        disabled={loading || busy || !selected}
        onclick={() => void loadSelected()}>Neu laden</button
      >
      <button
        class="btn-secondary"
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
        disabled={!orders.length}>Einzelbestellungen als CSV</button
      >
    </div>
    <label for="order-search" class="form-label mt-4">Nach Name oder E-Mail suchen</label><input
      id="order-search"
      class="form-input max-w-md"
      type="search"
      bind:value={search}
    />
    <fieldset class="mt-4">
      <legend class="form-label">Bestellungen filtern</legend>
      <div class="flex flex-wrap gap-2">
        {#each ORDER_FILTERS as filter (filter.key)}
          <button
            type="button"
            aria-pressed={activeFilters[filter.key]}
            class="rounded-full border px-4 py-2 text-sm font-semibold transition-colors {activeFilters[
              filter.key
            ]
              ? 'border-brand-900 bg-brand-900 text-white'
              : 'border-neutral-300 bg-white text-brand-900 hover:border-brand-900'}"
            onclick={() => (activeFilters[filter.key] = !activeFilters[filter.key])}
            >{filter.label}</button
          >
        {/each}
      </div>
      <p class="mt-2 text-sm text-neutral-700">
        Mehrere Filter gelten gemeinsam. „Noch offen“ bedeutet: Der Gesamtbetrag fehlt noch.
      </p>
    </fieldset>
    <label class="mt-4 flex items-center gap-2 text-sm text-neutral-700">
      <input type="checkbox" bind:checked={showFinished} class="h-4 w-4 accent-brand-900" />
      Erledigte und stornierte Bestellungen anzeigen
    </label>
    <p class="mt-3 text-sm text-neutral-700" role="status" aria-live="polite">
      {filtered.length} von {orders.length} Bestellungen angezeigt
    </p>
    <div class="mt-4 space-y-3">
      {#each filtered as order (order.id)}
        {@const orderReceipt = sammelReceipt(order.items, prices)}
        <article class="surface p-5">
          <div class="flex flex-wrap justify-between gap-3">
            <div>
              <h3 class="font-semibold text-brand-900">{order.name}</h3>
              <p class="break-all text-sm text-neutral-700">{order.email}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn-secondary"
                onclick={() => {
                  message = null;
                  messageOrder = order;
                }}>Nachricht schreiben</button
              >
              <button class="btn-secondary" onclick={() => edit(order)}>Status bearbeiten</button>
              <button type="button" class="btn-secondary" onclick={() => (paymentOrder = order)}
                >Bezahlung verwalten</button
              >
            </div>
          </div>
          <ul class="mt-3 space-y-1 text-sm">
            {#each order.items as item, index (item)}<li>
                <span class={item.excluded ? 'line-through text-neutral-500' : ''}
                  >{item.quantity} × {item.name}{item.variant ? ` · ${item.variant}` : ''}</span
                >
                <span class="float-right ml-3 font-semibold tabular-nums text-brand-900"
                  >{item.excluded
                    ? 'Nicht mitbestellt'
                    : linePrice(item.reference, item.quantity)}</span
                ><span class="block break-all text-xs text-neutral-700"
                  >{SAMMEL_SHOPS[getSammelShop(item.reference, item.shop)].name} · {item.reference}</span
                >
                <span class="block text-xs text-neutral-700"
                  >{sammelAvailabilityLabel(availability[item.reference])}</span
                >
                {#if item.excluded}<p class="text-sm text-[var(--color-dpsg-red)]">
                    Wird nicht mitbestellt{item.excluded.reason ? ': ' + item.excluded.reason : ''}
                  </p>{/if}
                <button
                  class="mt-1 text-sm font-semibold text-brand-800 underline"
                  disabled={busy || order.status === 'Storniert' || order.payment?.locked}
                  onclick={() => {
                    itemError = null;
                    itemReason = item.excluded?.reason ?? '';
                    itemEditing = { order, index };
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
          <p class="mt-4 text-sm font-semibold text-brand-800">
            {order.status} · {money(order.totalCents)} · {order.paid ? 'Bezahlt' : 'Unbezahlt'} · {order.delivered
              ? 'Ausgeliefert'
              : 'Nicht ausgeliefert'}
          </p>
          {#if order.payment}<p class="mt-1 text-sm text-neutral-700">
              {order.payment.reference
                ? `CampFlow-Referenz ${order.payment.reference}`
                : order.payment.state === 'prepared'
                  ? 'CampFlow-Beitrag vorbereitet'
                  : 'CampFlow-Ergebnis unklar. Bitte prüfen.'}{order.payment.requestSentAt
                ? ' · Versand manuell bestätigt'
                : ''}
            </p>{/if}
        </article>
      {:else}<div class="surface p-5">
          <p class="text-neutral-700">Keine Bestellungen passen zur aktuellen Auswahl.</p>
          {#if orders.length}<button
              type="button"
              class="btn-secondary mt-3"
              onclick={showAllOrders}>Alle Bestellungen anzeigen</button
            >{/if}
        </div>{/each}
    </div>
  </section>
  <section aria-labelledby="combined-heading" class="mt-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="combined-heading" class="font-serif text-2xl text-brand-900">
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
        <button
          class="btn-secondary"
          disabled={!exportItems.length || pricesLoading}
          onclick={downloadReceipt}>Bestellliste als CSV</button
        >
      </div>
    </div>
    <p class="mt-2 text-sm text-neutral-700">
      Gleiche Produktlinks oder Artikelnummern beim selben Anbieter mit gleicher Variante werden
      zusammengefasst, auch bei unterschiedlichen Artikelnamen. Stornierte Bestellungen sind
      ausgeschlossen.
    </p>
    <div class="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div class="overflow-x-auto">
        <table class="min-w-[760px] w-full text-left text-sm">
          <caption class="sr-only">Zusammengefasste Artikel nach Anbieter</caption><thead
            class="bg-[var(--color-brand-50)]"
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
{/if}

<SammelMessageDialog
  order={messageOrder}
  campaignTitle={view?.campaign.title ?? ''}
  onclose={() => (messageOrder = null)}
  onsent={(order) => {
    messageOrder = null;
    message = `Nachricht an ${order.name} (${order.email}) verschickt.`;
  }}
/>

<SammelPaymentDialog
  order={paymentOrder}
  automaticTotalCents={paymentOrder ? sammelReceipt(paymentOrder.items, prices).totalCents : null}
  archived={view?.campaign.archived ?? false}
  onprepare={(current) => {
    paymentOrder = null;
    edit(current);
  }}
  onclose={() => {
    paymentOrder = null;
  }}
  onupdate={(updated) => {
    if (view)
      view = {
        ...view,
        orders: view.orders.map((order) => (order.id === updated.id ? updated : order)),
      };
  }}
/>

<EditDialog
  open={editing !== null}
  title="Bestellstatus bearbeiten"
  {busy}
  error={dialogError}
  onsubmit={() => void saveStatus()}
  onclose={() => {
    if (!busy) editing = null;
  }}
>
  {#if editing}
    <p class="font-semibold text-brand-900">{editing.name}</p>
    <FormField id="order-status" label="Bestellstatus"
      >{#snippet children(attrs)}<select {...attrs} class="form-input" bind:value={editing!.status}
          >{#each SAMMEL_STATUS as status (status)}<option
              value={status}
              disabled={editing?.payment?.locked && !['Bestellt', 'Eingetroffen'].includes(status)}
              >{status}</option
            >{/each}</select
        >{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Ab „Bestellt“ können Mitglieder ihre Bestellung nicht mehr ändern. „Eingereicht“ gibt sie
      innerhalb des Bestellzeitraums wieder frei.
    </p>
    <FormField id="order-total" label="Endgültiger Gesamtbetrag in Euro" optional
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          bind:value={total}
          disabled={editing?.payment?.locked}
        />{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Ohne eigenen Betrag wird die vollständige Summe der aktiven Artikel übernommen. Passe den
      Gesamtbetrag bei Bedarf an, zum Beispiel für Versandkosten. Ein bereits gespeicherter Betrag
      bleibt vorbelegt.
    </p>
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        bind:checked={editing.paid}
        disabled={editing?.payment?.locked && editing.payment.state !== 'created'}
      />Bezahlt{editing.payment ? ' (manuell geprüft)' : ''}</label
    >
    {#if editing.payment?.locked}<p class="text-sm text-neutral-700">
        Der CampFlow-Beitrag sperrt Betrag, Person und Artikel. Korrekturen oder Stornierungen bitte
        zuerst in CampFlow klären.
      </p>{/if}
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={editing.delivered} />Ausgeliefert</label
    >
  {/if}
</EditDialog>

<EditDialog
  open={itemEditing !== null}
  error={itemError}
  title={itemEditing?.order.items[itemEditing.index].excluded
    ? 'Artikel wieder mitbestellen'
    : 'Artikel ausschließen'}
  {busy}
  onclose={() => {
    itemEditing = null;
    itemError = null;
  }}
  onsubmit={async () => {
    if (!itemEditing) return;
    busy = true;
    itemError = null;
    try {
      const result = await sendApi<SammelSaveResult>(
        'PATCH',
        BASE + '/orders/' + itemEditing.order.id + '/item',
        {
          etag: itemEditing.order.etag,
          index: itemEditing.index,
          excluded: !itemEditing.order.items[itemEditing.index].excluded,
          reason: itemReason,
        }
      );
      itemEditing = null;
      itemError = null;
      await loadSelected();
      message = result.confirmationMailSent
        ? 'Artikelstatus gespeichert und Familie benachrichtigt.'
        : 'Artikelstatus gespeichert. Die Benachrichtigung konnte nicht gesendet werden. Bitte nutze „Nachricht schreiben“.';
    } catch (caught) {
      if (caught instanceof ApiError && [409, 412].includes(caught.status)) {
        itemEditing = null;
        await loadSelected();
      }
      if (itemEditing) itemError = errorText(caught);
      else {
        const conflict = 'Die Bestellung wurde inzwischen geändert. Bitte erneut bearbeiten.';
        error = error ? conflict + ' ' + error : conflict;
      }
    } finally {
      busy = false;
    }
  }}
>
  <p class="mb-4 text-sm text-neutral-700">
    Der Artikel bleibt nachvollziehbar in der Bestellung. Die Familie erhält eine E-Mail. Der
    endgültige Betrag und die Zahlungsmarkierung werden zurückgesetzt.
  </p>
  <FormField id="item-reason" label="Kommentar" optional
    >{#snippet children(attrs)}<textarea
        {...attrs}
        class="form-input"
        rows="3"
        maxlength="1000"
        bind:value={itemReason}></textarea>{/snippet}</FormField
  >
</EditDialog>
