<script lang="ts">
  import { SAMMEL_SHOPS, getSammelShop, isSammelProductUrl } from '../../lib/sammelShops';
  import { postApi } from '../../lib/api';
  import type { SammelProductInfo } from '../../lib/types';

  interface Props {
    reference: string;
    orderId: string;
    token: string;
    disabled: boolean;
    onUseName: (name: string) => void;
  }
  let { reference, orderId, token, disabled, onUseName }: Props = $props();
  let product = $state<SammelProductInfo | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let imageFailed = $state(false);
  let revision = 0;

  /** Loads product suggestions while rejecting stale results after the input changes. */
  async function lookup(value: string): Promise<void> {
    const current = ++revision;
    loading = true;
    error = null;
    try {
      const result = await postApi<SammelProductInfo>('/sammelbestellungen/product', {
        id: orderId,
        token,
        reference: value,
      });
      if (current === revision) {
        product = result;
        imageFailed = false;
      }
    } catch (caught) {
      if (current === revision)
        error =
          caught instanceof Error ? caught.message : 'Produktdaten konnten nicht geladen werden.';
    } finally {
      if (current === revision) loading = false;
    }
  }
  $effect(() => {
    const value = reference;
    const available = orderId && token && !disabled;
    revision++;
    product = null;
    error = null;
    loading = false;
    if (available && isSammelProductUrl(value)) {
      const timer = setTimeout(() => void lookup(value), 800);
      return () => {
        clearTimeout(timer);
        revision++;
      };
    }
  });
</script>

{#if orderId && token && !disabled && isSammelProductUrl(reference) && (loading || product || error)}
  <div class="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
    {#if loading}
      <p role="status" aria-live="polite" class="text-sm text-neutral-700">
        Produktdaten werden geladen …
      </p>
    {:else if product}
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
        {#if product.imageUrl && !imageFailed}
          <img
            src={product.imageUrl}
            alt=""
            aria-hidden="true"
            width="160"
            height="160"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            class="h-32 w-32 shrink-0 rounded bg-white object-contain"
            onerror={() => (imageFailed = true)}
          />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-neutral-700">
            Gefunden bei {SAMMEL_SHOPS[getSammelShop(product.sourceUrl)].name}
          </p>
          <p class="mt-1 font-semibold text-brand-900">{product.name}</p>
          <p class="mt-2 text-sm text-brand-900">
            {product.unitPriceCents === null
              ? 'Kein Einzelpreis verfügbar'
              : `Einzelpreis: ${(product.unitPriceCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`}
          </p>
          <p class="mt-1 text-xs text-neutral-700">
            Preis zur Orientierung. Den endgültigen Preis und die Verfügbarkeit prüft das Team.
          </p>
          <div class="mt-3 flex flex-wrap gap-3">
            <button type="button" class="btn-secondary" onclick={() => onUseName(product!.name)}
              >Artikelnamen übernehmen</button
            >
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="self-center text-sm font-semibold text-brand-800">Im Shop ansehen ↗</a
            >
          </div>
        </div>
      </div>
    {:else if error}
      <p role="status" class="text-sm text-neutral-700">{error}</p>
      <button type="button" class="btn-secondary mt-2" onclick={() => void lookup(reference)}
        >Erneut laden</button
      >
    {/if}
  </div>
{/if}
