<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Toast from '../ui/Toast.svelte';
  import { SAMMEL_SHOPS, getSammelShop, isSammelProductUrl } from '../../lib/sammelShops';
  import type { SammelShop } from '../../lib/sammelShops';
  import { tick, untrack } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import ShopProductLookup from './ShopProductLookup.svelte';
  import { getSammelStammProdukt, getSammelProductImage } from '../../lib/sammelKatalog';
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
  let addedItem = $state<SammelArtikel | null>(null);
  let removedText = $state<string | null>(null);
  let addOtherButton = $state<HTMLElement | null>(null);

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
      (reference) => !getSammelStammProdukt(reference) && !Object.hasOwn(catalogPrices, reference)
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
    const price = getSammelStammProdukt(key)?.unitPriceCents ?? catalogPrices[key];
    if (typeof price === 'number')
      return (price / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    return pricesLoading && !Object.hasOwn(catalogPrices, key)
      ? 'Preis wird geladen …'
      : 'Preis nicht verfügbar';
  }
  /** Adds a blank article or a copied catalog selection to the editable order. */
  function add(article?: SammelKatalogArtikel): void {
    const item: SammelArtikel = {
      shop: getSammelShop(article?.reference ?? '', article?.shop),
      name: article?.name ?? '',
      reference: article?.reference ?? '',
      variant: '',
      quantity: 1,
    };
    items = [...items, item];
    // The bound state proxies the new object, so later lookups need the stored entry.
    const added = items[items.length - 1];
    removedText = null;
    if (article) addedItem = added;
    else void showItem(added);
  }
  /** Scrolls to an article and focuses the field the member fills in next. */
  async function showItem(item: SammelArtikel): Promise<void> {
    await tick();
    const index = items.indexOf(item);
    const fieldset = index >= 0 ? document.getElementById(`article-${index}`) : null;
    if (!fieldset) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fieldset.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    // Catalog articles only need size and quantity; a blank article starts with its shop.
    const field = item.reference
      ? (document.getElementById(`article-variant-${index}`) ??
        document.getElementById(`article-quantity-${index}`))
      : fieldset.querySelector<HTMLElement>('select:not(:disabled), input');
    field?.focus({ preventScroll: true });
  }
  /** Removes an article, confirms it and moves the focus to the next article or the add button. */
  async function remove(index: number): Promise<void> {
    const name = items[index]?.name.trim();
    items = items.filter((_, i) => i !== index);
    addedItem = null;
    removedText = name ? `„${name}“ wurde entfernt.` : `Artikel ${index + 1} wurde entfernt.`;
    await tick();
    const next = index < items.length ? document.getElementById(`article-${index}`) : null;
    const field = next?.querySelector<HTMLElement>('select:not(:disabled), input:not([readonly])');
    (field ?? addOtherButton)?.focus();
  }
  /** Confirms a catalog selection; the item number tells where it landed in the list. */
  function addedMessage(item: SammelArtikel): string {
    return `„${item.name}“ wurde als Artikel ${items.indexOf(item) + 1} hinzugefügt.`;
  }
</script>

{#if catalog.length && !disabled}
  <section aria-labelledby="popular-heading" class="mb-8">
    <h2 id="popular-heading" class="font-serif text-xl font-semibold text-brand-900">
      <button
        type="button"
        class="flex min-h-11 w-full items-center justify-between gap-4 text-left"
        aria-expanded={popularOpen}
        aria-controls={popularOpen ? 'popular-content' : undefined}
        onclick={togglePopular}
      >
        <span>Häufig bestellt</span>
        <svg
          class="size-5 shrink-0 text-brand-800 transition-transform duration-200 motion-reduce:transition-none"
          class:rotate-180={popularOpen}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="m6 9 6 6 6-6"
          />
        </svg>
      </button>
    </h2>
    {#if popularOpen}<div id="popular-content">
        <p class="mt-1 text-sm text-neutral-700">
          Artikel auswählen und die passende Größe oder Variante unten eintragen.
        </p>
        <p class="mt-1 text-xs text-neutral-700">
          Stammesartikel mit Listenpreis, Shop-Artikel mit aktuellem Richtpreis. Ohne Versand.
        </p>
        <ul class="mt-4 grid border-b border-neutral-200 md:grid-cols-2 md:gap-x-10">
          {#each catalog as article (article)}
            {@const image = getSammelProductImage(article.reference)}
            {@const stock = getSammelStammProdukt(article.reference)}
            <li class="flex items-start gap-4 border-t border-neutral-200 py-4">
              {#if image}
                <img
                  src={image}
                  alt=""
                  aria-hidden="true"
                  width="480"
                  height="480"
                  loading="lazy"
                  decoding="async"
                  class="size-20 shrink-0 object-contain"
                />
              {/if}
              <div class="flex min-w-0 flex-1 flex-col">
                <h3 class="font-semibold text-brand-900">{article.name}</h3>
                <p
                  class="mt-0.5 font-semibold tabular-nums text-brand-900"
                  role="status"
                  aria-live="polite"
                >
                  {catalogPrice(article.reference)}
                </p>
                {#if stock}<p class="mt-1 text-sm text-neutral-700">Vom Stamm Phoenix</p>
                  {#if stock.limited}<p class="mt-1 text-sm text-neutral-700">
                      Begrenzte Auflage. Verfügbarkeit prüft das Team.
                    </p>{/if}
                {/if}
                {#if article.variants.length}<p class="mt-1 text-sm text-neutral-700">
                    {article.variants.join(' · ')}
                  </p>{/if}
                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <ActionButton
                    variant="secondary"
                    type="button"
                    disabled={items.length >= 40}
                    onclick={() => add(article)}
                    aria-label="{article.name} hinzufügen">Hinzufügen</ActionButton
                  >
                  {#if article.reference.startsWith('https://')}
                    <a
                      class="text-sm font-semibold text-link"
                      href={article.reference}
                      target="_blank"
                      rel="noopener noreferrer"
                      >Details bei {SAMMEL_SHOPS[getSammelShop(article.reference, article.shop)]
                        .name} ↗</a
                    >
                  {/if}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </div>{/if}
  </section>
{/if}

<section aria-labelledby="items-heading">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 id="items-heading" class="font-serif text-xl font-semibold text-brand-900">
      Deine Artikel
    </h2>
    <div class="flex flex-wrap gap-x-5 gap-y-2">
      {#each Object.values(SAMMEL_SHOPS).filter((shop) => shop.hosts.length) as shop (shop.url)}
        <a href={shop.url} target="_blank" rel="noopener noreferrer" class="font-semibold text-link"
          >{shop.name} ↗</a
        >
      {/each}
    </div>
  </div>
  <p class="mt-2 text-sm text-neutral-700">
    Stammesartikel wählst du oben aus. Weitere Artikel kannst du von Rüsthaus und Ausrüster Eschwege
    angeben. Preise und Verfügbarkeit prüft das Team vor der Sammelbestellung.
  </p>
  {#if !items.length}<p class="mt-4 border-t border-neutral-200 pt-4 text-neutral-700">
      Wähle einen häufigen Artikel oder füge einen anderen Artikel hinzu.
    </p>{/if}
  <div class="mt-4 border-b border-neutral-200">
    {#each items as item, index (item)}
      {@const stock = getSammelStammProdukt(item.reference)}
      <fieldset
        id="article-{index}"
        disabled={disabled || !!item.excluded}
        class="border-t border-neutral-200 py-5 *:clear-left"
      >
        <legend class="float-left mb-3 w-full font-semibold text-brand-900"
          >Artikel {index + 1}</legend
        >
        {#if item.excluded}<p class="mb-3 text-sm text-danger">
            Wird nicht mitbestellt{item.excluded.reason ? ': ' + item.excluded.reason : ''}
          </p>{/if}
        <div class="grid gap-3 sm:grid-cols-2 {item.excluded ? 'opacity-60 line-through' : ''}">
          <FormField id="article-shop-{index}" label="Anbieter">
            {#snippet children(attrs)}<select
                {...attrs}
                class="form-input"
                value={getSammelShop(item.reference, item.shop)}
                disabled={disabled || !!stock || isSammelProductUrl(item.reference)}
                onchange={(event) => (item.shop = event.currentTarget.value as SammelShop)}
              >
                {#each Object.entries(SAMMEL_SHOPS).filter(([key]) => key !== 'stamm' || !!stock) as [key, shop] (key)}<option
                    value={key}>{shop.name}</option
                  >{/each}
              </select>{/snippet}
          </FormField>
          <FormField id="article-reference-{index}" label="Artikelnummer oder Produktlink">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="500"
                required
                readonly={!!stock}
                bind:value={item.reference}
              />{/snippet}
          </FormField>
          <FormField id="article-name-{index}" label="Artikelname">
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                maxlength="200"
                required
                readonly={!!stock}
                bind:value={item.name}
              />{/snippet}
          </FormField>
          {#if !stock}<FormField
              id="article-variant-{index}"
              label="Größe / Farbe / Variante"
              optional
            >
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
          {/if}
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
        {#if stock}<p class="mt-3 text-sm text-neutral-700">
            Listenpreis: {catalogPrice(item.reference)} pro Stück. {stock.limited
              ? 'Begrenzte Auflage. '
              : ''}Verfügbarkeit prüft das Team.
          </p>{/if}
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
            class="mt-3 text-sm font-semibold text-danger"
            onclick={() => void remove(index)}
            aria-label="Artikel {index + 1} entfernen">Artikel entfernen</button
          >{/if}
      </fieldset>
    {/each}
  </div>
  {#if !disabled}<ActionButton
      variant="secondary"
      type="button"
      class="mt-4"
      disabled={items.length >= 40}
      bind:element={addOtherButton}
      onclick={() => add()}>Anderen Artikel hinzufügen</ActionButton
    >{/if}
</section>

<Toast
  message={removedText ?? (addedItem && items.includes(addedItem) ? addedMessage(addedItem) : null)}
  actionLabel={removedText ? undefined : 'Zum Artikel'}
  onaction={() => {
    if (addedItem) void showItem(addedItem);
  }}
  onclose={() => {
    addedItem = null;
    removedText = null;
  }}
/>
