<script lang="ts">
  import { untrack } from 'svelte';
  import { vorstandStore, fetchVorstand } from '../lib/vorstandStore.svelte';

  import { withBaked } from '../lib/storeView';
  import type { Vorstand } from '../lib/types';

  interface Props {
    variant?: 'beige' | 'default';
    /** Baked at build time; refreshed from the API in the browser */
    initial?: Vorstand[] | null;
  }

  let { variant = 'beige', initial = null }: Props = $props();

  const view = $derived(withBaked(vorstandStore, initial));

  $effect(() => {
    untrack(() => {
      fetchVorstand();
    });
  });

  function formatPhone(phone: string): string {
    return phone.replace(/\s+/g, '');
  }
</script>

<!-- Plain address blocks on the page, set apart by a thin line (no boxes); both variants look alike -->
<div class="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
  {#if view.loading}
    <div role="status" aria-live="polite" class="sr-only">Vorstandsdaten werden geladen...</div>
    {#each [1, 2] as i (i)}
      <div class="skeleton-card contact-person {variant}" aria-hidden="true">
        <div class="space-y-2">
          <div class="skeleton-element h-5 w-32 rounded-sm"></div>
          <div class="skeleton-element h-4 w-28 rounded-sm"></div>
          <div class="skeleton-element h-4 w-36 rounded-sm"></div>
        </div>
      </div>
    {/each}
  {:else if view.error}
    <div class="sm:col-span-2 lg:col-span-3" role="alert">
      <p class="text-sm text-neutral-700">Die Vorstandsdaten konnten nicht geladen werden.</p>
    </div>
  {:else if (view.data?.length ?? 0) > 0}
    {#each view.data ?? [] as person (person.id)}
      <address class="contact-person {variant} not-italic">
        <p class="font-semibold text-brand-900">{person.name}</p>
        {#if person.telephone}
          <p class="mt-1 text-sm text-neutral-700">
            Tel: <a
              href="tel:{formatPhone(person.telephone)}"
              class="text-brand-800 tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-current"
              >{person.telephone}</a
            >
          </p>
        {/if}
        {#if person.street}
          <p class="mt-1 text-sm text-neutral-700">
            {person.street}
            {#if person.city}
              <br />{person.city}
            {/if}
          </p>
        {/if}
      </address>
    {/each}
  {:else}
    <div class="sm:col-span-2 lg:col-span-3">
      <p class="text-sm text-neutral-700">Aktuell sind keine Vorstandsmitglieder eingetragen.</p>
    </div>
  {/if}
</div>

<style>
  .contact-person {
    padding-left: 0.875rem;
    border-left: 2px solid var(--color-neutral-300);
  }

  .contact-person.beige {
    border-left-color: var(--color-dpsg-beige-2);
  }
</style>
