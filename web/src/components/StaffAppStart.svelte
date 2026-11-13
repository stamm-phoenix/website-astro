<script lang="ts">
  import { onMount } from 'svelte';

  const OPENING = 'Der Leitendenbereich wird geöffnet …';
  const FAILED =
    'Der Leitendenbereich lässt sich gerade nicht öffnen. Prüf deine Internetverbindung und versuch es noch einmal.';

  let failed = $state(false);

  async function openLeitendenbereich(): Promise<void> {
    try {
      const response = await fetch('/.auth/me', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Auth error: ${response.status}`);
      const { clientPrincipal } = (await response.json()) as { clientPrincipal: unknown };
      location.replace(clientPrincipal ? '/leitendenbereich/' : '/login');
    } catch {
      failed = true;
    }
  }

  onMount(() => {
    void openLeitendenbereich();
  });
</script>

<p role="status" aria-live="polite" class="text-neutral-800">
  {failed ? FAILED : OPENING}
</p>
{#if failed}
  <p class="mt-4">
    <!-- A full load, so the login is checked again -->
    <a href="/leitendenbereich-app/" data-astro-reload class="btn-primary no-underline">
      Noch einmal versuchen
    </a>
  </p>
{/if}
