<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { isSammelProductUrl, sammelAvailabilityLabel } from '../../lib/sammelShops';
  import { postApi } from '../../lib/api';
  import { formatEuro } from '../../lib/format';
  import type { SammelProductInfo } from '../../lib/types';

  /** Availability values worth a line; an unknown availability says nothing. */
  const KNOWN_AVAILABILITY = ['available', 'unavailable', 'preorder'];

  interface Props {
    reference: string;
    orderId: string;
    token: string;
    disabled: boolean;
    onUseName: (name: string, previousName: string | null) => void;
  }
  let { reference, orderId, token, disabled, onUseName }: Props = $props();
  let product = $state<SammelProductInfo | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let imageFailed = $state(false);
  let revision = 0;
  let previousName: string | null = null;

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
        onUseName(result.name, previousName);
        previousName = result.name;
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
  <div class="mt-4 border-l-2 border-neutral-300 py-1 pl-4">
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
            class="h-24 w-24 shrink-0 object-contain"
            onerror={() => (imageFailed = true)}
          />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-brand-900">{product.name}</p>
          <p class="mt-2 text-sm text-brand-900">
            {product.unitPriceCents === null
              ? 'Preis nicht verfügbar'
              : `Richtpreis ${formatEuro(product.unitPriceCents)}`}
          </p>
          {#if KNOWN_AVAILABILITY.includes(product.availability ?? '')}<p
              class="mt-2 text-sm text-brand-900"
            >
              {sammelAvailabilityLabel(product.availability)}
            </p>{/if}
          <div class="mt-3 flex flex-wrap gap-3">
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="self-center text-sm font-semibold text-link">Im Shop ansehen ↗</a
            >
          </div>
        </div>
      </div>
    {:else if error}
      <p role="status" class="text-sm text-neutral-700">{error}</p>
      <ActionButton
        variant="secondary"
        type="button"
        class="mt-2"
        onclick={() => void lookup(reference)}>Erneut laden</ActionButton
      >
    {/if}
  </div>
{/if}
