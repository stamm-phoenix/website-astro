<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';

  /** The running check of a new photo, or why it did not work. */

  interface Props {
    photo: ReturnType<typeof createBelegPhotoDraft>;
  }
  let { photo }: Props = $props();
</script>

{#if photo.aiChecking}
  <!-- The check takes about ten seconds; the bar fills in that time and waits near its end -->
  <div role="status" class="space-y-1.5" data-testid="beleg-pruefung">
    <p class="text-sm font-semibold text-brand-900">Beleg wird geprüft …</p>
    <div class="h-1.5 overflow-hidden rounded-full bg-neutral-200" aria-hidden="true">
      <div class="pruefung-fortschritt h-full rounded-full bg-[var(--color-action)]"></div>
    </div>
    <p class="text-sm text-neutral-700">Lesbarkeit, Vollständigkeit und Artikel</p>
  </div>
{:else if photo.aiNotice}
  <p role="note" class="text-sm text-neutral-700"><MessageText text={photo.aiNotice} /></p>
{/if}

<style>
  .pruefung-fortschritt {
    width: 90%;
    animation: pruefung-fuellen 12s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes pruefung-fuellen {
    from {
      width: 4%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pruefung-fortschritt {
      animation: none;
    }
  }
</style>
