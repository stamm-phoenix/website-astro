<script lang="ts">
  import { onMount } from 'svelte';
  import { loadChangelogSeen, unseenCount } from '../../lib/staffChangelogStore.svelte';

  const count = $derived(unseenCount());

  onMount(() => void loadChangelogSeen());
</script>

<div role="status" aria-live="polite">
  {#if count > 0}
    <p class="mb-4 border-l-4 border-accent-500 py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-brand-900">
        {count === 1 ? 'Eine neue Neuigkeit' : `${count} neue Neuigkeiten`}:
      </strong>
      Im Leitendenbereich hat sich etwas geändert.
      <a
        href="/leitendenbereich/neuigkeiten"
        class="inline-flex min-h-11 items-center font-semibold text-link">Neuigkeiten lesen</a
      >
    </p>
  {/if}
</div>
