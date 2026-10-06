<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { onMount } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { fetchApi, sendApi, ApiError } from '../../lib/api';
  import { isSammelOpen, sammelInstant } from '../../lib/sammelbestellung';
  import { SAMMEL_SHOPS, getSammelShop, isSammelProductUrl } from '../../lib/sammelShops';
  import type { SammelShop } from '../../lib/sammelShops';
  import {
    SAMMEL_KATALOG,
    getSammelStammProdukt,
    SAMMEL_MAX_KATALOG_ARTIKEL,
    getSammelProductImage,
  } from '../../lib/sammelKatalog';
  import type { SammelAktion } from '../../lib/types';

  const BASE = '/intern/pflege/sammelbestellungen';
  let campaigns = $state<SammelAktion[]>([]);
  let showArchive = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let dialogError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let fields = $state<Record<string, string>>({});
  const visibleCampaigns = $derived(
    campaigns
      .filter((campaign) => campaign.archived === showArchive)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.title.localeCompare(b.title, 'de'))
  );
  /** Formats campaign timestamps in German using the Europe/Berlin time zone. */
  const formatDate = (date: string): string =>
    new Date(date).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  let loadRevision = 0;
  /** Turns an API failure into a visible message without assuming a specific thrown type. */
  function errorText(caught: unknown): string {
    return caught instanceof Error ? caught.message : 'Die Daten konnten nicht geladen werden.';
  }
  /** Describes whether a campaign is archived, upcoming, open or past its deadline. */
  function campaignStatus(campaign: SammelAktion): string {
    if (isSammelOpen(campaign)) return 'Offen';
    if (!campaign.archived && Date.now() < Date.parse(campaign.startsAt))
      return 'Noch nicht geöffnet';
    return 'Geschlossen';
  }
  /** Reloads the campaign overview while ignoring responses from superseded loads. */
  async function loadCampaigns(): Promise<void> {
    const revision = ++loadRevision;
    loading = true;
    error = null;
    try {
      const rows = await fetchApi<SammelAktion[]>(BASE);
      if (revision === loadRevision) campaigns = rows;
    } catch (caught) {
      if (revision === loadRevision) error = errorText(caught);
    } finally {
      if (revision === loadRevision) loading = false;
    }
  }
  onMount(() => {
    const params = new URL(window.location.href).searchParams;
    const legacyId = params.get('id');
    if (legacyId && /^\d+$/.test(legacyId)) {
      window.location.replace(`/leitendenbereich/sammelbestellungen/${legacyId}`);
      return;
    }
    /** Restores the archive selection from the current URL. */
    const readArchive = (): void => {
      showArchive = new URL(window.location.href).searchParams.get('archiv') === '1';
    };
    readArchive();
    void loadCampaigns();
    window.addEventListener('popstate', readArchive);
    return () => {
      window.removeEventListener('popstate', readArchive);
      loadRevision++;
    };
  });
  /** Switches the campaign archive tab and preserves its selection in the URL. */
  function changeArchiveView(archived: boolean): void {
    showArchive = archived;
    const url = new URL(window.location.href);
    if (archived) url.searchParams.set('archiv', '1');
    else url.searchParams.delete('archiv');
    if (url.href !== window.location.href) history.pushState(history.state, '', url);
    message = null;
  }
  /** Saves a version-checked archive change and reloads the campaign overview. */
  async function archiveCampaign(campaign: SammelAktion): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    message = null;
    try {
      await sendApi('PATCH', `${BASE}/${campaign.id}`, {
        etag: campaign.etag,
        archived: !campaign.archived,
      });
      await loadCampaigns();
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
  let createOpen = $state(false);
  let title = $state('');
  let creationKey = $state('');
  let description = $state('');
  let startsAt = $state('');
  let endsAt = $state('');
  let catalog = $state(
    SAMMEL_KATALOG.map((row) => ({ ...row, variantsText: row.variants.join(', ') }))
  );

  /** Starts a fresh campaign draft with defaults and a new retry-safe creation key. */
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
  /** Creates the campaign from the validated form and opens its dedicated detail URL. */
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
          shop: getSammelShop(row.reference, row.shop),
          name: row.name,
          reference: row.reference,
          variants: row.variantsText
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        })),
      });
      createOpen = false;
      window.location.assign(`/leitendenbereich/sammelbestellungen/${result.id}`);
    } catch (caught) {
      dialogError = errorText(caught);
      fields = caught instanceof ApiError ? (caught.fields ?? {}) : {};
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-4">
  <div class="flex flex-wrap gap-x-6" role="group" aria-label="Sammelbestellungen auswählen">
    {#each [{ archived: false, label: 'Aktuell' }, { archived: true, label: 'Archiv' }] as tab (tab.label)}
      <button
        type="button"
        class="py-2 font-semibold tabular-nums decoration-2 underline-offset-[6px] {showArchive ===
        tab.archived
          ? 'text-brand-900 underline decoration-accent-500'
          : 'text-neutral-700 hover:text-brand-900 hover:underline'}"
        aria-pressed={showArchive === tab.archived}
        disabled={busy}
        onclick={() => changeArchiveView(tab.archived)}
      >
        {tab.label} ({campaigns.filter((campaign) => campaign.archived === tab.archived).length})
      </button>
    {/each}
  </div>
  <div class="flex flex-wrap gap-2">
    <ActionButton
      variant="secondary"
      type="button"
      disabled={loading || busy}
      onclick={() => void loadCampaigns()}>Neu laden</ActionButton
    >
    <ActionButton variant="primary" type="button" disabled={loading || busy} onclick={openCreate}
      >Neue Sammelbestellung</ActionButton
    >
  </div>
</div>
<StatusNotice {message} class="mt-5" />
{#if error}<div role="alert" class="mt-5 text-danger">
    <p>{error}</p>
    <ActionButton
      variant="secondary"
      type="button"
      class="mt-3"
      disabled={loading || busy}
      onclick={() => void loadCampaigns()}>Erneut laden</ActionButton
    >
  </div>{/if}
{#if loading}<p role="status" aria-live="polite" class="mt-5">
    Sammelbestellungen werden geladen …
  </p>
{:else if !error}
  <section aria-labelledby="campaign-list-heading" class="mt-6">
    <h2 id="campaign-list-heading" class="font-serif text-2xl font-semibold text-brand-900">
      {showArchive ? 'Archivierte Sammelbestellungen' : 'Aktuelle Sammelbestellungen'}
    </h2>
    <ul class="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
      {#each visibleCampaigns as campaign (campaign.id)}
        <li class="py-6">
          <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="text-xl font-semibold text-brand-900">
                <a href="/leitendenbereich/sammelbestellungen/{campaign.id}" class="hover:underline"
                  >{campaign.title}</a
                >
              </h3>
              {#if campaign.description}<p
                  class="mt-2 whitespace-pre-line text-sm text-neutral-700"
                >
                  {campaign.description}
                </p>{/if}
              <dl class="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt class="text-neutral-700">Bestellzeitraum</dt>
                  <dd class="mt-1 font-semibold text-brand-900">
                    {formatDate(campaign.startsAt)} bis {formatDate(campaign.endsAt)} Uhr
                  </dd>
                </div>
                <div>
                  <dt class="text-neutral-700">Bestellstatus</dt>
                  <dd
                    class="mt-1 font-semibold {isSammelOpen(campaign)
                      ? 'text-success'
                      : 'text-brand-900'}"
                  >
                    {campaignStatus(campaign)}
                  </dd>
                </div>
                <div>
                  <dt class="text-neutral-700">Archivstatus</dt>
                  <dd class="mt-1 font-semibold text-brand-900">
                    {campaign.archived ? 'Archiviert' : 'Aktuell'}
                  </dd>
                </div>
              </dl>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2 sm:flex-col">
              <a
                class="btn-primary"
                href="/leitendenbereich/sammelbestellungen/{campaign.id}"
                aria-label="{campaign.title} öffnen">Öffnen</a
              >
              <ActionButton
                variant="secondary"
                type="button"
                disabled={busy}
                onclick={() => void archiveCampaign(campaign)}
                aria-label="{campaign.title} {campaign.archived
                  ? 'wiederherstellen'
                  : 'archivieren'}"
                >{campaign.archived ? 'Wiederherstellen' : 'Archivieren'}</ActionButton
              >
            </div>
          </div>
        </li>
      {:else}<li class="py-6 text-neutral-700">
          {showArchive
            ? 'Noch keine Sammelbestellungen archiviert.'
            : 'Keine aktuellen Sammelbestellungen. Lege eine neue an oder schaue im Archiv nach.'}
        </li>{/each}
    </ul>
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
  <h3 class="border-t border-neutral-200 pt-4 text-lg font-semibold text-brand-900">
    Häufige Artikel
  </h3>
  <p class="text-sm text-neutral-700">
    Auswahl und Größen vor dem Speichern prüfen. Mitglieder können zusätzlich Artikel von Rüsthaus
    oder Ausrüster Eschwege frei eintragen.
  </p>
  {#each catalog as article, index (article)}
    {@const image = getSammelProductImage(article.reference)}
    {@const stock = getSammelStammProdukt(article.reference)}
    <fieldset class="space-y-2 border-t border-neutral-200 pt-3 *:clear-left">
      <legend class="float-left mb-1 w-full text-sm font-semibold text-neutral-700">
        Artikel {index + 1}
      </legend>
      {#if image}
        <img
          src={image}
          alt=""
          aria-hidden="true"
          width="480"
          height="480"
          loading="lazy"
          decoding="async"
          class="h-24 w-24 object-contain"
        />
      {/if}
      {#if stock}<p class="text-sm text-neutral-700">
          Listenpreis: {(stock.unitPriceCents / 100).toLocaleString('de-DE', {
            style: 'currency',
            currency: 'EUR',
          })}. {stock.limited ? 'Begrenzte Auflage. ' : ''}Verfügbarkeit prüft das Team.
        </p>{/if}
      <FormField id="catalog-shop-{index}" label="Anbieter">
        {#snippet children(attrs)}<select
            {...attrs}
            class="form-input"
            value={getSammelShop(article.reference, article.shop)}
            disabled={!!stock || isSammelProductUrl(article.reference)}
            onchange={(event) => (article.shop = event.currentTarget.value as SammelShop)}
          >
            {#each Object.entries(SAMMEL_SHOPS).filter(([key]) => key !== 'stamm' || !!stock) as [key, shop] (key)}<option
                value={key}>{shop.name}</option
              >{/each}
          </select>{/snippet}
      </FormField>
      <FormField id="catalog-name-{index}" label="Artikelname"
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            readonly={!!stock}
            bind:value={article.name}
            maxlength="200"
          />{/snippet}</FormField
      >
      <FormField id="catalog-reference-{index}" label="Artikelnummer / Produktlink"
        >{#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            readonly={!!stock}
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
            disabled={!!stock}
            bind:value={article.variantsText}
          />{/snippet}</FormField
      >
      <button
        type="button"
        class="text-sm font-semibold text-danger"
        onclick={() => (catalog = catalog.filter((_, i) => i !== index))}
        >Artikel {index + 1} entfernen</button
      >
    </fieldset>
  {/each}
  <ActionButton
    variant="secondary"
    type="button"
    disabled={catalog.length >= SAMMEL_MAX_KATALOG_ARTIKEL}
    onclick={() =>
      (catalog = [...catalog, { name: '', reference: '', variants: [], variantsText: '' }])}
    >Häufigen Artikel hinzufügen</ActionButton
  >
  {#each Object.values(fields) as field, fieldIndex (fieldIndex)}<p class="text-sm text-danger">
      {field}
    </p>{/each}
</EditDialog>
