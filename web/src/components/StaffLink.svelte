<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';

  interface Props {
    href: string;
    variant?: 'primary' | 'secondary';
    class?: string;
    children: Snippet;
  }
  let { href, variant = 'secondary', class: className = '', children }: Props = $props();

  onMount(() => {
    fetchPrincipal();
  });
</script>

<!-- Only shown with an active login; visitors never see it -->
{#if authStore.principal}
  <a {href} class="btn-{variant} {className}">{@render children()}</a>
{/if}
