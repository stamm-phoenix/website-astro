<script lang="ts" module>
  import type { SammelStaffView } from '../../lib/types';

  /**
   * The last loaded view per Sammelbestellung, kept across pages: a revisit shows it at once
   * while it loads again. The actions wait for the fresh view, so they never use an old version.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, never rendered
  const shownViews = new Map<string, SammelStaffView>();
</script>

<script lang="ts">
  import { archiveSammelCampaign } from '../../lib/sammelStaffApi';
  import { confirmAction } from '../../lib/confirm';
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
  import type { SammelBestellung, SammelProductInfo } from '../../lib/types';

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
  const priceErrors = $derived(Object.keys(pricePool.state.errors).length);
  const pricesLoading = $derived(pricePool.state.loading);
  let itemEditing = $state<{ order: SammelBestellung; index: number } | null>(null);
  const orders = $derived(view?.orders.filter((order) => order.submitted) ?? []);
  let loadRevision = 0;
  /** The running load of the campaign detail. */
  let pendingLoad: Promise<void> = Promise.resolve();
  /**
   * Reloads the campaign detail, rejecting responses from superseded loads or unmounted pages.
   * `shown` is a view to show while loading, e.g. the one from the last visit.
   */
  function loadSelected(shown: SammelStaffView | null = null): Promise<void> {
    pendingLoad = fetchSelected(shown);
    return pendingLoad;
  }
  async function fetchSelected(shown: SammelStaffView | null): Promise<void> {
    if (!selected) return;
    const revision = ++loadRevision;
    loading = true;
    error = null;
    loadError = null;
    message = null;
    view = shown;
    if (shown) document.title = `${shown.campaign.title} | Sammelbestellungen | Stamm Phoenix`;
    pricePool.reset();
    try {
      const nextView = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
      if (revision === loadRevision) {
        view = nextView;
        shownViews.set(selected, nextView);
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
  async function loadOrder(id: string): Promise<SammelBestellung | null> {
    const fresh = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
    view = fresh;
    shownViews.set(selected, fresh);
    await loadPrices(fresh);
    return fresh.orders.find((order) => order.id === id) ?? null;
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
  /**
   * The order as loaded last: while the view from the last visit is shown, a tapped action waits
   * for the fresh view, so a dialog never starts from an old version.
   */
  async function current(order: SammelBestellung): Promise<SammelBestellung | null> {
    await pendingLoad;
    return view?.orders.find((entry) => entry.id === order.id) ?? null;
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
    if (selected) void loadSelected(shownViews.get(selected) ?? null);
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
    if (
      !campaign.archived &&
      !(await confirmAction({
        title: `„${campaign.title}“ archivieren?`,
        message: 'Mitglieder können dann nicht mehr bestellen.',
        confirmLabel: 'Archivieren',
        tone: 'neutral',
      }))
    )
      return;
    busy = true;
    error = null;
    message = null;
    try {
      const result = await archiveSammelCampaign(campaign);
      await loadSelected();
      if (!loadError) message = result;
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
            {#if view.campaign.archived}<p class="mt-1 text-sm text-neutral-700">
                Mitglieder können nicht mehr bestellen oder ändern.
              </p>{/if}
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
            void current(order).then((fresh) => (messageOrder = fresh));
          }}
          onedit={(order) => void current(order).then((fresh) => fresh && edit(fresh))}
          onpayment={(order) => void current(order).then((fresh) => (paymentOrder = fresh))}
          onitem={(order, index) => {
            const tapped = JSON.stringify(order.items[index]);
            void current(order).then((fresh) => {
              // Only the same article in the same variant and state; another one is never edited
              if (fresh && JSON.stringify(fresh.items[index]) === tapped)
                itemEditing = { order: fresh, index };
              else
                message = `Die Bestellung von ${order.name} hat sich inzwischen geändert. Tippe den Artikel noch einmal an.`;
            });
          }}
        />
        {#if priceErrors}
          <div class="mt-4 border-l-2 border-warning pl-3 text-sm" role="status">
            <p>
              Die Preisabfrage im Shop ist für {priceErrors}
              {priceErrors === 1 ? 'Artikel' : 'Artikel'} fehlgeschlagen. Die Bestellungen sind gespeichert.
              Prüfe die Preise im Shop oder lade sie noch einmal.
            </p>
            <ActionButton disabled={pricesLoading} onclick={() => view && loadPrices(view)}
              >Preise erneut laden</ActionButton
            >
          </div>
        {/if}
        <SammelCombinedList bind:exportShop {orders} {prices} {pricesLoading} {linePrice} />
      {/snippet}
    </LoadState>
  </div>{/if}

{#if messageOrder}
  {#key messageOrder.id}
    <SammelMessageDialog
      order={messageOrder}
      campaignTitle={view?.campaign.title ?? ''}
      onclose={() => (messageOrder = null)}
      onsent={(order) => {
        messageOrder = null;
        message = `Nachricht an ${order.name} (${order.email}) verschickt.`;
      }}
    />
  {/key}
{/if}

{#if paymentOrder}
  {#key paymentOrder.id}
    <SammelPaymentDialog
      order={paymentOrder}
      automaticTotalCents={paymentOrder
        ? sammelReceipt(paymentOrder.items, prices).totalCents
        : null}
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
  {/key}
{/if}

{#if editing}
  <SammelStatusDialog
    bind:editing
    bind:busy
    {prices}
    onreload={loadSelected}
    onmessage={(text) => (message = text)}
    {loadOrder}
  />
{/if}

{#if itemEditing}
  <SammelItemDialog
    bind:itemEditing
    bind:busy
    onreload={loadSelected}
    onmessage={(text) => (message = text)}
    {loadOrder}
  />
{/if}
