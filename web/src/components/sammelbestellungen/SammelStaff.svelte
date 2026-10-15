<script lang="ts">
  import { createSammelPrices } from '../../lib/sammelPrices.svelte';
  import SammelStaffInvitation from './SammelStaffInvitation.svelte';
  import SammelStatusDialog from './SammelStatusDialog.svelte';
  import SammelItemDialog from './SammelItemDialog.svelte';
  import SammelOrderList from './SammelOrderList.svelte';
  import SammelCombinedList from './SammelCombinedList.svelte';
  import type { SammelShop } from '../../lib/sammelShops';
  import type { SammelOrderFilters } from '../../lib/sammelStaffView';
  import { money } from '../../lib/sammelStaffView';
  import MessageText from '../ui/MessageText.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { getSammelStammProdukt } from '../../lib/sammelKatalog';
  import { isSammelProductUrl } from '../../lib/sammelShops';

  import { onMount } from 'svelte';

  import StatusNotice from '../pflege/StatusNotice.svelte';

  import SammelMessageDialog from './SammelMessageDialog.svelte';
  import SammelPaymentDialog from './SammelPaymentDialog.svelte';
  import { fetchApi, sendApi, errorMessage } from '../../lib/api';

  import { sammelReceipt } from '../../lib/sammelExport';
  import type { SammelBestellung, SammelStaffView, SammelProductInfo } from '../../lib/types';

  const BASE = '/intern/pflege/sammelbestellungen';
  let selected = $state('');
  let view = $state<SammelStaffView | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let editing = $state<SammelBestellung | null>(null);
  let messageOrder = $state<SammelBestellung | null>(null);
  let paymentOrder = $state<SammelBestellung | null>(null);
  let orderFilters = $state<SammelOrderFilters>({
    search: '',
    showFinished: false,
    activeFilters: { submitted: false, unpriced: false, unpaid: false, undelivered: false },
  });
  let exportShop = $state<SammelShop | 'all'>('all');
  const pricePool = createSammelPrices();
  const prices = $derived(pricePool.state.prices);
  const availability = $derived(pricePool.state.availability);
  const pricesLoading = $derived(pricePool.state.loading);
  let itemEditing = $state<{ order: SammelBestellung; index: number } | null>(null);
  const orders = $derived(view?.orders.filter((order) => order.submitted) ?? []);
  let loadRevision = 0;
  /** Reloads the campaign detail, rejecting responses from superseded loads or unmounted pages. */
  async function loadSelected(): Promise<void> {
    if (!selected) return;
    const revision = ++loadRevision;
    loading = true;
    error = null;
    loadError = null;
    message = null;
    view = null;
    pricePool.reset();
    try {
      const nextView = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
      if (revision === loadRevision) {
        view = nextView;
        void loadPrices(nextView);
        document.title = `${nextView.campaign.title} | Sammelbestellungen | Stamm Phoenix`;
      }
    } catch (caught) {
      if (revision === loadRevision)
        loadError = errorMessage(
          caught,
          'Die Sammelbestellung konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
        );
    } finally {
      if (revision === loadRevision) loading = false;
    }
  }
  async function loadPrices(nextView: SammelStaffView): Promise<void> {
    const references = nextView.orders
      .filter((order) => order.submitted)
      .flatMap((order) => order.items.map((item) => item.reference.trim()));
    await pricePool.load(references, (reference) =>
      isSammelProductUrl(reference)
        ? sendApi<SammelProductInfo>('POST', `${BASE}/product`, { reference })
        : Promise.resolve(null)
    );
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
      pricePool.cancel();
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
      if (!loadError)
        message = campaign.archived
          ? 'Sammelbestellung wiederhergestellt.'
          : 'Sammelbestellung archiviert. Alle Bestellungen bleiben erhalten.';
    } catch (caught) {
      error = errorMessage(
        caught,
        'Die Sammelbestellung wurde nicht geändert. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      busy = false;
    }
  }
  /** Copies the selected order into a status draft with its loaded ETag and euro amount. */
  function edit(order: SammelBestellung): void {
    editing = { ...order, items: order.items.map((item) => ({ ...item })) };
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
<header class="mt-6 border-b border-neutral-200 pb-6">
  <h1 class="font-serif text-3xl font-semibold text-brand-900 md:text-4xl">
    {view?.campaign.title ?? 'Sammelbestellung'}
  </h1>
  {#if view?.campaign.description}<p class="mt-3 max-w-3xl whitespace-pre-line text-neutral-700">
      {view.campaign.description}
    </p>{/if}
</header>
{#if error}<div role="alert" class="mt-5 text-danger">
    <p><MessageText text={error} /></p>
    {#if selected}<ActionButton
        type="button"
        variant="secondary"
        class="mt-3"
        disabled={loading || busy}
        onclick={() => void loadSelected()}>Erneut laden</ActionButton
      >{/if}
  </div>{/if}
<StatusNotice {message} class="mt-5" popup />
{#if selected}<div class="mt-6">
    <LoadState
      data={view}
      {loading}
      error={loadError}
      loadingText="Daten werden geladen …"
      onretry={() => void loadSelected()}
    >
      {#snippet children(view)}
        <section
          aria-labelledby="archive-heading"
          class="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-6"
        >
          <div>
            <h2 id="archive-heading" class="font-serif text-xl font-semibold text-brand-900">
              {view.campaign.archived
                ? 'Archivierte Sammelbestellung'
                : 'Aktuelle Sammelbestellung'}
            </h2>
            <p class="mt-1 text-sm text-neutral-700">
              {view.campaign.archived
                ? 'Alle Bestellungen bleiben einsehbar. Neue Bestellungen und Änderungen durch Mitglieder sind gesperrt.'
                : 'Archivieren blendet diese Sammelbestellung aus der aktuellen Auswahl aus. Die Daten bleiben erhalten.'}
            </p>
          </div>
          <ActionButton
            variant="secondary"
            type="button"
            disabled={busy || loading}
            onclick={() => void archiveSelected()}
          >
            {view.campaign.archived ? 'Wiederherstellen' : 'Archivieren'}
          </ActionButton>
        </section>
        <SammelStaffInvitation {view} {busy} {loading} onerror={(text) => (error = text)} />
        <dl
          class="mt-8 grid grid-cols-3 gap-4 border-y border-neutral-200 py-4 sm:divide-x sm:divide-neutral-200"
        >
          <div>
            <dt class="text-sm text-neutral-700">Bestellungen</dt>
            <dd class="text-2xl font-semibold tabular-nums text-brand-900">
              {orders.filter((o) => o.status !== 'Storniert').length}
            </dd>
          </div>
          <div class="sm:pl-4">
            <dt class="text-sm text-neutral-700">Noch unbezahlt</dt>
            <dd class="text-2xl font-semibold tabular-nums text-brand-900">
              {orders.filter((o) => !o.paid && o.status !== 'Storniert').length}
            </dd>
          </div>
          <div class="sm:pl-4">
            <dt class="text-sm text-neutral-700">Noch nicht ausgeliefert</dt>
            <dd class="text-2xl font-semibold tabular-nums text-brand-900">
              {orders.filter((o) => !o.delivered && o.status !== 'Storniert').length}
            </dd>
          </div>
        </dl>
        <SammelOrderList
          bind:filters={orderFilters}
          {orders}
          {prices}
          {availability}
          {busy}
          {loading}
          {selected}
          {linePrice}
          onreload={() => void loadSelected()}
          onmessage={(order) => {
            message = null;
            messageOrder = order;
          }}
          onedit={edit}
          onpayment={(order) => (paymentOrder = order)}
          onitem={(order, index) => {
            itemEditing = { order, index };
          }}
        />
        <SammelCombinedList bind:exportShop {orders} {prices} {pricesLoading} {linePrice} />
      {/snippet}
    </LoadState>
  </div>{/if}

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

{#if editing}
  <SammelStatusDialog
    bind:editing
    bind:busy
    {prices}
    onreload={loadSelected}
    onmessage={(text) => (message = text)}
    onerror={(text) => (error = text)}
  />
{/if}

{#if itemEditing}
  <SammelItemDialog
    bind:itemEditing
    bind:busy
    onreload={loadSelected}
    onmessage={(text) => (message = text)}
    onerror={(text) => (error = text)}
  />
{/if}
