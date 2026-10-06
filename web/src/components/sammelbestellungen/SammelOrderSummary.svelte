<script lang="ts">
  import { SAMMEL_SHOPS, getSammelShop } from '../../lib/sammelShops';
  import { getSammelProductImage } from '../../lib/sammelKatalog';
  import type { SammelArtikel } from '../../lib/types';

  interface Props {
    name: string;
    email: string;
    notes: string;
    items: SammelArtikel[];
  }
  let { name, email, notes, items }: Props = $props();
</script>

<div class="space-y-6">
  <dl class="grid gap-3 border-y border-neutral-200 py-4 sm:grid-cols-2">
    <div class="min-w-0">
      <dt class="text-sm text-neutral-700">Name</dt>
      <dd class="mt-1 font-semibold break-words text-brand-900">{name}</dd>
    </div>
    <div class="min-w-0">
      <dt class="text-sm text-neutral-700">E-Mail-Adresse</dt>
      <dd class="mt-1 font-semibold break-words text-brand-900">{email}</dd>
    </div>
  </dl>

  <section aria-labelledby="summary-items-heading">
    <h2 id="summary-items-heading" class="font-serif text-xl text-brand-900">Deine Artikel</h2>
    <ul class="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
      {#each items as item, index (index)}
        {@const image = getSammelProductImage(item.reference)}
        {@const shop = SAMMEL_SHOPS[getSammelShop(item.reference, item.shop)]}
        <li class="flex items-center gap-3 py-3 sm:gap-4">
          <div
            class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border border-neutral-100 bg-surface sm:size-16 {item.excluded
              ? 'opacity-60'
              : ''}"
          >
            {#if image}
              <img
                src={image}
                alt=""
                aria-hidden="true"
                width="64"
                height="64"
                loading="lazy"
                decoding="async"
                class="size-full object-contain"
              />
            {:else}
              <svg
                class="size-7 text-neutral-400"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
                />
              </svg>
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <p
              class="font-semibold break-words text-brand-900 {item.excluded
                ? 'line-through opacity-60'
                : ''}"
            >
              {item.name}
            </p>
            <p class="text-sm break-words text-neutral-700">
              {[item.variant, shop.name].filter(Boolean).join(' · ')}
              {#if item.reference.startsWith('https://')}
                · <a
                  class="font-semibold text-link"
                  href={item.reference}
                  target="_blank"
                  rel="noopener noreferrer">Im Shop ansehen ↗</a
                >
              {:else}
                · Art.-Nr. {item.reference}
              {/if}
            </p>
            {#if item.excluded}<p class="text-sm text-danger">
                Wird nicht mitbestellt{item.excluded.reason ? ': ' + item.excluded.reason : ''}
              </p>{/if}
          </div>
          <p
            class="shrink-0 font-semibold tabular-nums text-brand-900 {item.excluded
              ? 'opacity-60'
              : ''}"
          >
            <span class="sr-only">Anzahl:</span>
            <span aria-hidden="true">×</span>
            {item.quantity}
          </p>
        </li>
      {/each}
    </ul>
  </section>

  {#if notes.trim()}
    <section aria-labelledby="summary-notes-heading" class="border-t border-neutral-200 pt-4">
      <h2 id="summary-notes-heading" class="text-sm text-neutral-700">Bemerkungen</h2>
      <p class="mt-1 whitespace-pre-line text-brand-900">{notes}</p>
    </section>
  {/if}
</div>
