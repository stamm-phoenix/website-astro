<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore, fetchPrincipal, getFirstName } from '../lib/authStore.svelte';

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';

  const firstName = $derived(authStore.principal ? getFirstName(authStore.principal) : null);

  onMount(() => {
    fetchPrincipal();
  });
</script>

<div class="min-h-11 pb-2 md:min-h-12">
  {#if authStore.loading}
    <span role="status" class="sr-only">Anmeldung wird geprüft …</span>
    <div class="skeleton-element h-9 w-72 max-w-full rounded"></div>
  {:else}
    <h1 class="font-serif text-3xl md:text-4xl font-semibold text-brand-900">
      {greeting}{firstName ? `, ${firstName}` : ''}!
    </h1>
  {/if}
</div>
