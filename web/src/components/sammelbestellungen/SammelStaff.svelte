<script lang="ts">
  import { onMount } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { fetchApi, sendApi, ApiError } from '../../lib/api';
  import { SAMMEL_STATUS, isSammelOpen, sammelInstant } from '../../lib/sammelbestellung';
  import { SAMMEL_KATALOG } from '../../lib/sammelKatalog';
  import { aggregateSammelItems, sammelCsv } from '../../lib/sammelExport';
  import type { SammelAktion, SammelBestellung, SammelStaffView } from '../../lib/types';

  const BASE = '/intern/pflege/sammelbestellungen';
  let campaigns = $state<SammelAktion[]>([]);
  let selected = $state('');
  let view = $state<SammelStaffView | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let dialogError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let fields = $state<Record<string, string>>({});
  let createOpen = $state(false);
  let title = $state('');
  let creationKey = $state('');
  let description = $state('');
  let startsAt = $state('');
  let endsAt = $state('');
  let catalog = $state(
    SAMMEL_KATALOG.map((row) => ({ ...row, variantsText: row.variants.join(', ') }))
  );
  let editing = $state<SammelBestellung | null>(null);
  let total = $state<number | undefined>(undefined);
  let search = $state('');
  const orders = $derived(view?.orders.filter((order) => order.submitted) ?? []);
  const filtered = $derived(
    orders.filter((order) =>
      `${order.name} ${order.email}`.toLowerCase().includes(search.toLowerCase())
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
  async function loadCampaigns(): Promise<void> {
    loading = true;
    error = null;
    try {
      campaigns = await fetchApi<SammelAktion[]>(BASE);
    } catch (caught) {
      error = errorText(caught);
    } finally {
      loading = false;
    }
  }
  async function loadSelected(): Promise<void> {
    loading = true;
    error = null;
    view = null;
    try {
      if (selected) view = await fetchApi<SammelStaffView>(`${BASE}/${selected}`);
    } catch (caught) {
      error = errorText(caught);
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    void loadCampaigns();
  });
  function openCreate(): void {
    creationKey = crypto.randomUUID();
    title = '';
    description = '';
    startsAt = '';
    endsAt = '';
    catalog = SAMMEL_KATALOG.map((row) => ({ ...row, variantsText: row.variants.join(', ') }));
    dialogError = null;
    fields = {};
    createOpen = true;
  }
  async function create(): Promise<void> {
    busy = true;
    dialogError = null;
    fields = {};
    try {
      if (!startsAt || !endsAt) throw new Error('Bitte gib Beginn und Ende an.');
      const result = await sendApi<{ id: string }>('POST', BASE, {
        creationKey,
        title,
        description,
        startsAt: sammelInstant(startsAt),
        endsAt: sammelInstant(endsAt),
        catalog: catalog.map((row) => ({
          name: row.name,
          reference: row.reference,
          variants: row.variantsText
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        })),
      });
      createOpen = false;
      await loadCampaigns();
      selected = result.id;
      await loadSelected();
      message =
        'Sammelbestellung angelegt. Den Einladungslink kannst du jetzt über CampFlow verschicken.';
    } catch (caught) {
      dialogError = errorText(caught);
      fields = caught instanceof ApiError ? (caught.fields ?? {}) : {};
    } finally {
      busy = false;
    }
  }
  function edit(order: SammelBestellung): void {
    editing = { ...order, items: order.items.map((item) => ({ ...item })) };
    total = order.totalCents === null ? undefined : order.totalCents / 100;
    dialogError = null;
    fields = {};
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

<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
  <div class="w-full min-w-0 sm:max-w-md sm:flex-1">
    <label class="form-label" for="campaign-select">Sammelbestellung</label>
    <select
      id="campaign-select"
      class="form-input"
      bind:value={selected}
      onchange={(event) => {
        selected = event.currentTarget.value;
        void loadSelected();
      }}
      disabled={loading || busy}
    >
      <option value="">Bitte auswählen</option>
      {#each campaigns as campaign (campaign.id)}<option value={campaign.id}
          >{campaign.title}</option
        >{/each}
    </select>
  </div>
  <button class="btn-primary" disabled={busy || loading} onclick={openCreate}
    >Neue Sammelbestellung</button
  >
</div>
{#if loading}<p class="mt-5" role="status" aria-live="polite">Daten werden geladen …</p>
{:else if !campaigns.length && !error}<p class="surface mt-6 p-6 text-neutral-700">
    Noch keine Sammelbestellung angelegt. Beginne mit einem Bestellzeitraum und einer Auswahl
    häufiger Artikel.
  </p>{/if}
{#if error}<div role="alert" class="mt-5 text-[var(--color-dpsg-red)]">
    <p>{error}</p>
    <button
      class="btn-secondary mt-3"
      onclick={() => void (selected ? loadSelected() : loadCampaigns())}>Erneut laden</button
    >
  </div>{/if}
<StatusNotice {message} class="mt-5" />
{#if view}
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
      /><button class="btn-secondary" onclick={() => void copyInvitation()}>Link kopieren</button>
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
    <div class="mt-4 space-y-3">
      {#each filtered as order (order.id)}
        <article class="surface p-5">
          <div class="flex flex-wrap justify-between gap-3">
            <div>
              <h3 class="font-semibold text-brand-900">{order.name}</h3>
              <p class="break-all text-sm text-neutral-700">{order.email}</p>
            </div>
            <button class="btn-secondary" onclick={() => edit(order)}>Status bearbeiten</button>
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
      {:else}<p class="p-4 text-neutral-700">Keine abgegebenen Bestellungen gefunden.</p>{/each}
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
      Gleiche Artikel mit gleicher Variante werden zusammengefasst. Stornierte Bestellungen sind
      ausgeschlossen.
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

<EditDialog
  open={createOpen}
  title="Neue Sammelbestellung"
  {busy}
  error={dialogError}
  onsubmit={() => void create()}
  onclose={() => {
    if (!busy) createOpen = false;
  }}
>
  <FormField id="campaign-title" label="Titel" error={fields.title}
    >{#snippet children(attrs)}<input
        {...attrs}
        class="form-input"
        maxlength="200"
        bind:value={title}
        placeholder="Sammelbestellung Frühjahr 2027"
      />{/snippet}</FormField
  >
  <div class="grid gap-3 sm:grid-cols-2">
    <FormField
      id="campaign-start"
      label="Beginn"
      error={fields.startsAt}
      hint="Ortszeit Europe/Berlin"
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          type="datetime-local"
          bind:value={startsAt}
        />{/snippet}</FormField
    >
    <FormField id="campaign-end" label="Ende" error={fields.endsAt} hint="Ortszeit Europe/Berlin"
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          type="datetime-local"
          bind:value={endsAt}
        />{/snippet}</FormField
    >
  </div>
  <FormField
    id="campaign-description"
    label="Hinweise für Mitglieder"
    optional
    error={fields.description}
    >{#snippet children(attrs)}<textarea
        {...attrs}
        class="form-input"
        rows="3"
        maxlength="2000"
        bind:value={description}></textarea>{/snippet}</FormField
  >
  <h3 class="font-serif text-lg text-brand-900">Häufige Artikel</h3>
  <p class="text-sm text-neutral-700">
    Auswahl und Größen vor dem Speichern prüfen. Mitglieder können zusätzlich jeden Rüsthaus-Artikel
    frei eintragen.
  </p>
  {#each catalog as article, index (article)}
    <fieldset class="space-y-2 rounded-lg border border-neutral-200 p-3">
      <legend class="px-1 text-sm">Artikel {index + 1}</legend>
      <FormField id="catalog-name-{index}" label="Artikelname"
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={article.name}
            maxlength="200"
          />{/snippet}</FormField
      >
      <FormField id="catalog-reference-{index}" label="Artikelnummer / Rüsthaus-Link"
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={article.reference}
            maxlength="500"
          />{/snippet}</FormField
      >
      <FormField
        id="catalog-variants-{index}"
        label="Größen / Varianten"
        optional
        hint="Mit Komma trennen"
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={article.variantsText}
          />{/snippet}</FormField
      >
      <button
        type="button"
        class="text-sm font-semibold text-[var(--color-dpsg-red)]"
        onclick={() => (catalog = catalog.filter((_, i) => i !== index))}
        >Artikel {index + 1} entfernen</button
      >
    </fieldset>
  {/each}
  <button
    type="button"
    class="btn-secondary"
    disabled={catalog.length >= 30}
    onclick={() =>
      (catalog = [...catalog, { name: '', reference: '', variants: [], variantsText: '' }])}
    >Häufigen Artikel hinzufügen</button
  >
  {#each Object.values(fields) as field, fieldIndex (fieldIndex)}<p
      class="text-sm text-[var(--color-dpsg-red)]"
    >
      {field}
    </p>{/each}
</EditDialog>

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
