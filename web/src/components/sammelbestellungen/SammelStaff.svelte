<script lang="ts">
  import { onMount } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import SammelMessageDialog from './SammelMessageDialog.svelte';
  import { fetchApi, sendApi, ApiError } from '../../lib/api';
  import { SAMMEL_STATUS, isSammelOpen } from '../../lib/sammelbestellung';
  import { aggregateSammelItems, sammelCsv } from '../../lib/sammelExport';
  import type { SammelBestellung, SammelStaffView } from '../../lib/types';

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
  let total = $state<number | undefined>(undefined);
  let search = $state('');
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
  const formatDate = (date: string): string =>
    new Date(date).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const money = (cents: number | null): string =>
    cents === null
      ? 'Noch offen'
      : (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  function errorText(caught: unknown): string {
    return caught instanceof Error ? caught.message : 'Die Daten konnten nicht geladen werden.';
  }
  function isFinished(order: SammelBestellung): boolean {
    return (
      order.status === 'Storniert' ||
      (order.status === 'Eingetroffen' &&
        order.totalCents !== null &&
        order.paid &&
        order.delivered)
    );
  }
  function showAllOrders(): void {
    search = '';
    showFinished = true;
    activeFilters = { submitted: false, unpriced: false, unpaid: false, undelivered: false };
  }
  let loadRevision = 0;
  async function loadSelected(): Promise<void> {
    if (!selected) return;
    const revision = ++loadRevision;
    loading = true;
    error = null;
    message = null;
    view = null;
    try {
      const nextView = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
      if (revision === loadRevision) {
        view = nextView;
        document.title = `${nextView.campaign.title} | Sammelbestellungen | Stamm Phoenix`;
      }
    } catch (caught) {
      if (revision === loadRevision) error = errorText(caught);
    } finally {
      if (revision === loadRevision) loading = false;
    }
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
  function edit(order: SammelBestellung): void {
    editing = { ...order, items: order.items.map((item) => ({ ...item })) };
    total = order.totalCents === null ? undefined : order.totalCents / 100;
    dialogError = null;
  }
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
      dialogError =
        caught instanceof ApiError && caught.fields
          ? Object.values(caught.fields).join(' ')
          : errorText(caught);
    } finally {
      busy = false;
    }
  }
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
  <button
    type="button"
    class="btn-secondary"
    disabled={loading || busy || !selected}
    onclick={() => void loadSelected()}>Neu laden</button
  >
</div>
<header class="surface mt-6 p-5 sm:p-8">
  <p class="badge">Rüsthaus · Sammelbestellung</p>
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
        class="btn-secondary"
        onclick={() =>
          download('sammelbestellung-einzelbestellungen.csv', [
            [
              'Name',
              'E-Mail',
              'Artikel',
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
                item.name,
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
            </div>
          </div>
          <ul class="mt-3 space-y-1 text-sm">
            {#each order.items as item (item)}<li>
                {item.quantity} × {item.name}{item.variant ? ` · ${item.variant}` : ''}<span
                  class="block break-all text-xs text-neutral-700">{item.reference}</span
                >
              </li>{/each}
          </ul>
          {#if order.notes}<p class="mt-3 whitespace-pre-line text-sm text-neutral-700">
              {order.notes}
            </p>{/if}
          <p class="mt-4 text-sm font-semibold text-brand-800">
            {order.status} · {money(order.totalCents)} · {order.paid ? 'Bezahlt' : 'Unbezahlt'} · {order.delivered
              ? 'Ausgeliefert'
              : 'Nicht ausgeliefert'}
          </p>
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
        Bestellliste für Rüsthaus
      </h2>
      <button
        class="btn-secondary"
        disabled={!combined.length}
        onclick={() =>
          download('sammelbestellung-ruesthaus.csv', [
            ['Artikel', 'Artikelnummer / Link', 'Variante', 'Anzahl'],
            ...combined.map((row) => [row.name, row.reference, row.variant, row.quantity]),
          ])}>Bestellliste als CSV</button
      >
    </div>
    <p class="mt-2 text-sm text-neutral-700">
      Gleiche Produktlinks oder Artikelnummern mit gleicher Variante werden zusammengefasst, auch
      bei unterschiedlichen Artikelnamen. Stornierte Bestellungen sind ausgeschlossen.
    </p>
    <div class="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">Zusammengefasste Rüsthaus-Artikel</caption><thead
          class="bg-[var(--color-brand-50)]"
          ><tr
            ><th scope="col" class="p-3">Artikel</th><th scope="col" class="p-3">Variante</th><th
              scope="col"
              class="p-3">Anzahl</th
            ></tr
          ></thead
        ><tbody
          >{#each combined as row (row)}<tr class="border-t border-neutral-200"
              ><td class="p-3"
                >{row.name}<span class="block max-w-xl break-all text-xs text-neutral-700"
                  >{row.reference}</span
                ></td
              ><td class="p-3">{row.variant || '–'}</td><td class="p-3 font-semibold"
                >{row.quantity}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
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
          >{#each SAMMEL_STATUS as status (status)}<option value={status}>{status}</option
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
        />{/snippet}</FormField
    >
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={editing.paid} />Bezahlt</label
    >
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={editing.delivered} />Ausgeliefert</label
    >
  {/if}
</EditDialog>
