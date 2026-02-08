<script lang="ts">
  import { onMount } from "svelte";
  import { vorstandStore, fetchVorstand } from "../lib/vorstandStore.svelte";

  interface Props {
    variant?: "beige" | "default";
  }

  let { variant = "beige" }: Props = $props();

  onMount(() => {
    fetchVorstand();
  });

  function formatPhone(phone: string): string {
    return phone.replace(/\s+/g, "");
  }
</script>

<div class="grid gap-3 md:grid-cols-2">
  {#if vorstandStore.loading}
    <div role="status" aria-live="polite" class="sr-only">
      Vorstandsdaten werden geladen...
    </div>
    {#each [1, 2] as _}
      <div class="skeleton-card contact-person {variant}" >
        <div class="space-y-2">
          <div class="skeleton-element h-5 w-32 rounded"></div>
          <div class="skeleton-element h-4 w-28 rounded"></div>
          <div class="skeleton-element h-4 w-36 rounded"></div>
          <div class="skeleton-element h-4 w-40 rounded"></div>
        </div>
      </div>
    {/each}
  {:else if vorstandStore.error}
    <div class="md:col-span-2">
      <p class="text-sm text-[var(--color-neutral-700)]">
        Die Vorstandsdaten konnten nicht geladen werden.
      </p>
    </div>
  {:else if vorstandStore.data && vorstandStore.data.length > 0}
    {#each vorstandStore.data as person (person.id)}
      <div class="contact-person {variant}">
        <p class="text-base font-semibold text-[var(--color-brand-900)]">{person.name}</p>
        {#if person.telephone}
          <p class="text-sm text-[var(--color-neutral-700)] mt-1">
            Tel: <a href="tel:{formatPhone(person.telephone)}" class="text-[var(--color-brand-700)] hover:underline">{person.telephone}</a>
          </p>
        {/if}
        {#if person.street}
          <p class="text-sm text-[var(--color-neutral-700)] mt-1">
            {person.street}
            {#if person.city}
              <br />{person.city}
            {/if}
          </p>
        {/if}
      </div>
    {/each}
  {:else}
    <div class="md:col-span-2">
      <p class="text-sm text-[var(--color-neutral-700)]">
        Aktuell sind keine Vorstandsmitglieder eingetragen.
      </p>
    </div>
  {/if}
</div>

<style>
  .contact-person {
    padding: 1rem;
    border-radius: var(--radius-md);
    background: var(--color-neutral-50);
    border: 1px solid var(--color-neutral-200);
  }

  .contact-person.beige {
    background: var(--color-dpsg-beige-1);
    border-color: transparent;
  }

  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .skeleton-element {
    background: linear-gradient(
      110deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 40%,
      var(--color-neutral-200) 60%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-card {
      animation: none;
    }

    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }
</style>
