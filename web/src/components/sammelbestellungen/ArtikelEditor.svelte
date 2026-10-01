<script lang="ts">
  import { SAMMEL_SHOPS, getSammelShop, isSammelProductUrl } from '../../lib/sammelShops';
  import type { SammelShop } from '../../lib/sammelShops';
  import { untrack } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import ShopProductLookup from './ShopProductLookup.svelte';
  import { getSammelProductImage } from '../../lib/sammelKatalog';
  import { postApi } from '../../lib/api';
  import type { SammelProductInfo } from '../../lib/types';
  import type { SammelArtikel, SammelKatalogArtikel } from '../../lib/types';

  interface Props {
    items: SammelArtikel[];
    catalog: SammelKatalogArtikel[];
    disabled?: boolean;
    orderId?: string;
    token?: string;
  }
  let {
    items = $bindable(),
    catalog,
    disabled = false,
    orderId = '',
    token = '',
  }: Props = $props();
  const POPULAR_COLLAPSED_KEY = 'sammelbestellungen-haeufig-eingeklappt';
  let popularOpen = $state(true);
  let catalogPrices = $state<Record<string, number | null>>({});
  let pricesLoading = $state(false);
  let priceRevision = 0;
  let priceCredentials = '';

  /** Fetches catalog prices once per private link with four workers and isolated shop failures. */
  async function loadCatalogPrices(
    references: string[],
    id: string,
    privateToken: string
  ): Promise<void> {
    const revision = ++priceRevision;
    const credentials = `${id}:${privateToken}`;
    if (priceCredentials !== credentials) {
      catalogPrices = {};
      priceCredentials = credentials;
    }
    const pending = [...new Set(references)].filter(
      (reference) => !Object.hasOwn(catalogPrices, reference)
    );
    pricesLoading = true;
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (index < pending.length && revision === priceRevision) {
          const reference = pending[index++];
          let price: number | null = null;
          try {
            const product = await postApi<SammelProductInfo>('/sammelbestellungen/product', {
              id,
              token: privateToken,
              reference,
            });
            price = product.unitPriceCents;
          } catch {
            // Catalog selection remains available when the shop cannot supply a price.
          }
          if (revision === priceRevision) catalogPrices = { ...catalogPrices, [reference]: price };
        }
      })
    );
    if (revision === priceRevision) pricesLoading = false;
  }
  $effect(() => {
    const references = catalog.map((article) => article.reference.trim());
    const id = orderId;
    const privateToken = token;
    if (!disabled && id && privateToken && references.length) {
      untrack(() => void loadCatalogPrices(references, id, privateToken));
    }
    return () => {
      priceRevision++;
    };
  });

  $effect(() => {
    try {
      popularOpen = localStorage.getItem(POPULAR_COLLAPSED_KEY) !== '1';
    } catch {
      // Storage unavailable: the section stays expanded.
    }
  });

  /** Toggles the popular articles and remembers the choice in this browser. */
  function togglePopular(): void {
    popularOpen = !popularOpen;
    try {
      if (popularOpen) localStorage.removeItem(POPULAR_COLLAPSED_KEY);
      else localStorage.setItem(POPULAR_COLLAPSED_KEY, '1');
    } catch {
      // Only a convenience: the section opens again next time.
    }
  }

  /** Formats fetched catalog prices as euros and distinguishes missing prices from loading. */
  function catalogPrice(reference: string): string {
    const key = reference.trim();
    const price = catalogPrices[key];
    if (typeof price === 'number')
      return (price / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    return pricesLoading && !Object.hasOwn(catalogPrices, key)
      ? 'Preis wird geladen …'
      : 'Preis nicht verfügbar';
  }
  /** Adds a blank article or a copied catalog selection to the editable order. */
  function add(article?: SammelKatalogArtikel): void {
    items = [
      ...items,
      {
        shop: getSammelShop(article?.reference ?? '', article?.shop),
        name: article?.name ?? '',
        reference: article?.reference ?? '',
        variant: '',
        quantity: 1,
      },
    ];
  }
</script>

{#if catalog.length && !disabled}
  <section aria-labelledby="popular-heading" class="mb-8">
    <h2 id="popular-heading" class="font-serif text-xl text-brand-900">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-4 text-left"
        aria-expanded={popularOpen}
        aria-controls={popularOpen ? 'popular-content' : undefined}
        onclick={togglePopular}
      >
        <span>Häufig bestellt</span>
        <span
          class="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand-50)] text-brand-800"
          aria-hidden="true"
        >
          <svg
            class="size-4 transition-transform duration-200 motion-reduce:transition-none"
            class:rotate-180={popularOpen}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="m6 9 6 6 6-6"
            />
          </svg>
        </span>
      </button>
    </h2>
    {#if popularOpen}<div id="popular-content">
        <p class="mt-1 text-sm text-neutral-700">
          Artikel auswählen und die passende Größe oder Variante unten eintragen.
        </p>
        <p class="mt-1 text-xs text-neutral-700">
          Aktuelle Shop-Preise zur Orientierung, ohne Versand. Variantenpreise bitte prüfen.
        </p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each catalog as article (article)}
            {@const image = getSammelProductImage(article.reference)}
            <div class="flex flex-col rounded-lg border border-neutral-200 bg-white p-4">
              {#if image}
                <div
                  class="mb-4 flex h-40 items-center justify-center border-b border-neutral-100 pb-4"
                >
                  <img
                    src={image}
                    alt=""
                    aria-hidden="true"
                    width="480"
                    height="480"
                    loading="lazy"
                    decoding="async"
                    class="h-full w-full object-contain"
                  />
                </div>
              {/if}
              <h3 class="font-semibold text-brand-900">{article.name}</h3>
              <p
                class="mt-1 font-semibold tabular-nums text-brand-900"
                role="status"
                aria-live="polite"
              >
                {catalogPrice(article.reference)}
              </p>
              {#if article.variants.length}<p class="mt-1 text-sm text-neutral-700">
                  {article.variants.join(' · ')}
                </p>{/if}
              {#if article.reference.startsWith('https://')}
                <a
                  class="mt-2 block text-sm font-semibold text-brand-800"
                  href={article.reference}
                  target="_blank"
                  rel="noopener noreferrer"
                  >Details bei {SAMMEL_SHOPS[getSammelShop(article.reference, article.shop)].name} ↗</a
                >
              {/if}
              <div class="mt-auto pt-3">
                <button
                  type="button"
                  class="btn-secondary"
                  disabled={items.length >= 40}
                  onclick={() => add(article)}
                  aria-label="{article.name} hinzufügen">Hinzufügen</button
                >
              </div>
            </div>
          {/each}
        </div>
      </div>{/if}
  </section>
{/if}

<section aria-labelledby="items-heading">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="items-heading" class="font-serif text-xl text-brand-900">Deine Artikel</h2>
    <div class="flex flex-wrap gap-x-5 gap-y-2">
      {#each Object.values(SAMMEL_SHOPS) as shop (shop.url)}
        <a
          href={shop.url}
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold text-brand-800">{shop.name} ↗</a
        >
      {/each}
    </div>
  </div>
  <p class="mt-2 text-sm text-neutral-700">
    Du kannst Artikel von Rüsthaus und Ausrüster Eschwege angeben. Preise und Verfügbarkeit prüft
    das Team vor der Sammelbestellung.
  </p>
  {#if !items.length}<p
      class="mt-4 rounded-lg border border-dashed border-neutral-300 p-5 text-neutral-700"
    >
      Wähle einen häufigen Artikel oder füge einen anderen Artikel hinzu.
    </p>{/if}
  <div class="mt-4 space-y-4">
    {#each items as item, index (item)}
      <fieldset
        disabled={disabled || !!item.excluded}
        class="rounded-lg border border-neutral-200 bg-white p-4"
      >
        <legend class="px-2 text-sm font-semibold text-brand-800">Artikel {index + 1}</legend>
        {#if item.excluded}<p class="mb-3 text-sm text-[var(--color-dpsg-red)]">
            Wird nicht mitbestellt{item.excluded.reason ? ': ' + item.excluded.reason : ''}
          </p>{/if}
        <div class="grid gap-3 sm:grid-cols-2 {item.excluded ? 'opacity-60 line-through' : ''}">
          <FormField id="article-shop-{index}" label="Anbieter">
            {#snippet children(attrs)}<select
                {...attrs}
                class="form-input"
                value={getSammelShop(item.reference, item.shop)}
                disabled={disabled || isSammelProductUrl(item.reference)}
                onchange={(event) => (item.shop = event.currentTarget.value as SammelShop)}
              >
                {#each Object.entries(SAMMEL_SHOPS) as [key, shop] (key)}<option value={key}
                    >{shop.name}</option
                  >{/each}
              </select>{/snippet}
          </FormField>
          <FormField id="article-reference-{index}" label="Artikelnummer oder Produktlink">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="500"
                required
                bind:value={item.reference}
              />{/snippet}
          </FormField>
          <FormField id="article-name-{index}" label="Artikelname">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="200"
                required
                bind:value={item.name}
              />{/snippet}
          </FormField>
          <FormField id="article-variant-{index}" label="Größe / Farbe / Variante" optional>
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="120"
                bind:value={item.variant}
                list="variants-{index}"
              />
              <datalist id="variants-{index}"
                >{#each catalog.find((entry) => entry.reference === item.reference)?.variants ?? [] as variant, variantIndex (variantIndex)}<option
                    value={variant}
                  ></option>{/each}</datalist
              >{/snippet}
          </FormField>
          <FormField id="article-quantity-{index}" label="Anzahl">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                type="number"
                min="1"
                max="99"
                step="1"
                required
                bind:value={item.quantity}
              />{/snippet}
          </FormField>
        </div>
        <ShopProductLookup
          reference={item.reference}
          {orderId}
          {token}
          disabled={disabled || !!item.excluded}
          onUseName={(name, previousName) => {
            if (!item.name.trim() || item.name === previousName) item.name = name;
          }}
        />
        {#if !disabled && !item.excluded}<button
            type="button"
            class="mt-3 text-sm font-semibold text-[var(--color-dpsg-red)]"
            onclick={() => (items = items.filter((_, i) => i !== index))}
            aria-label="Artikel {index + 1} entfernen">Artikel entfernen</button
          >{/if}
      </fieldset>
    {/each}
  </div>
  {#if !disabled}<button
      type="button"
      class="btn-secondary mt-4"
      disabled={items.length >= 40}
      onclick={() => add()}>Anderen Artikel hinzufügen</button
    >{/if}
</section>
