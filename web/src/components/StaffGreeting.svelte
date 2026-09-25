<script lang="ts">
  import { untrack } from 'svelte';
  import { authStore, fetchPrincipal, getFirstName } from '../lib/authStore.svelte';

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';

  const firstName = $derived(authStore.principal ? getFirstName(authStore.principal) : null);

  $effect(() => {
    untrack(() => fetchPrincipal());
  });
</script>

<div role="status" aria-live="polite">
  {#if authStore.loading}
    <span class="sr-only">Anmeldung wird geprüft …</span>
    <div class="skeleton-element h-9 w-72 max-w-full rounded"></div>
  {:else}
    <h1 class="font-serif text-3xl md:text-4xl font-semibold text-brand-900">
      {greeting}{firstName ? `, ${firstName}` : ''}!
    </h1>
    {#if authStore.principal}
      <p class="mt-1 text-sm text-neutral-700">
        Angemeldet als <span class="font-semibold">{authStore.principal.userDetails}</span>
      </p>
    {/if}
  {/if}
</div>
