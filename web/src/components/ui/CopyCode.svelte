<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Props {
    /** The text copied, shown in a monospace font, e.g. a Verwendungszweck. */
    code: string;
    /** What the code is, for the button's name: „Verwendungszweck MK46448 kopieren“. */
    label?: string;
    /** Only the check mark confirms visually, for narrow table cells; screen readers still hear it. */
    compact?: boolean;
    /** Fits a line of text, e.g. in a card; on any device with touch it keeps the full size to tap. */
    small?: boolean;
  }
  let { code, label = 'Verwendungszweck', compact = false, small = false }: Props = $props();

  let state = $state<'idle' | 'copied' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: MouseEvent): Promise<void> {
    // Inside a clickable row the click must not open the row as well
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      state = 'copied';
    } catch {
      state = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (state = 'idle'), 2500);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<span class="inline-flex flex-wrap items-center gap-x-2">
  <button
    type="button"
    class="copy-code"
    class:small
    data-state={state}
    aria-label={`${label} ${code} kopieren`}
    title="Kopieren"
    onclick={copy}
  >
    <span class="font-mono">{code}</span>
    {#if state === 'copied'}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><rect x="9" y="9" width="12" height="12" rx="2" /><path
          d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        /></svg
      >
    {/if}
  </button>
  <span
    role="status"
    class="text-sm"
    class:sr-only={compact && state !== 'failed'}
    class:text-success={state === 'copied'}
    >{#if state === 'copied'}Kopiert{:else if state === 'failed'}<span class="text-danger"
        >Kopieren ging nicht, bitte von Hand abschreiben.</span
      >{/if}</span
  >
</span>

<style>
  .copy-code {
    display: inline-flex;
    min-height: calc(var(--spacing) * 11);
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
    margin-block: calc(var(--spacing) * -2);
    padding: 0 calc(var(--spacing) * 2);
    border: 1px solid var(--color-neutral-300);
    border-radius: 0.375rem;
    background: var(--color-surface);
    color: var(--color-brand-900);
    font-size: 0.875rem;
    cursor: copy;
    white-space: nowrap;
  }
  .copy-code.small {
    min-height: calc(var(--spacing) * 7);
    margin-block: 0;
    gap: var(--spacing);
    padding: 0 calc(var(--spacing) * 1.5);
    font-size: 0.8125rem;
  }
  .copy-code.small svg {
    width: 0.875rem;
    height: 0.875rem;
  }
  @media (any-pointer: coarse) {
    .copy-code.small {
      min-height: calc(var(--spacing) * 11);
      padding: 0 calc(var(--spacing) * 2);
    }
  }
  .copy-code:hover {
    border-color: var(--color-brand-800);
  }
  .copy-code[data-state='copied'] {
    border-color: var(--color-success);
    color: var(--color-success);
  }
  svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
