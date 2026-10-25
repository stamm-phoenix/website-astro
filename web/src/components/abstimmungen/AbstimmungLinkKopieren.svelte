<script lang="ts">
  import { onDestroy } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';

  interface Props {
    url: string;
    /** Heading above the link, e.g. „Link für alle“. */
    label: string;
  }
  let { url, label }: Props = $props();

  let state = $state<'idle' | 'copied' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      state = 'copied';
    } catch {
      state = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (state = 'idle'), 2500);
  }
  onDestroy(() => clearTimeout(timer));
</script>

<div class="min-w-0">
  <p class="text-sm font-semibold text-brand-900">{label}</p>
  <p class="mt-1 font-mono text-sm break-all text-neutral-800">{url}</p>
  <div class="mt-2 flex flex-wrap items-center gap-x-3">
    <ActionButton variant="secondary" aria-label="{label} kopieren" onclick={() => void copy()}
      >Link kopieren</ActionButton
    >
    <span role="status" class="text-sm">
      {#if state === 'copied'}<span class="text-success">Kopiert.</span>
      {:else if state === 'failed'}<span class="text-danger"
          >Kopieren ging nicht. Markiere den Link und kopiere ihn von Hand.</span
        >{/if}
    </span>
  </div>
</div>
