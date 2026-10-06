<script lang="ts">
  import ActionButton from './ActionButton.svelte';

  interface Props {
    /** Text of the confirmation; `null` hides the popup. */
    message: string | null;
    kind?: 'success' | 'warning' | 'error';
    actionLabel?: string;
    onaction?: () => void;
    onclose: () => void;
    /** Milliseconds until the popup closes itself while not hovered or focused. */
    duration?: number;
    /** False when another live region already announces the same message. */
    announce?: boolean;
  }
  let {
    message,
    kind = 'success',
    actionLabel,
    onaction,
    onclose,
    duration = kind === 'success' ? 6000 : 10000,
    announce = true,
  }: Props = $props();
  let paused = $state(false);

  const KIND_CLASS = {
    success: 'border-l-success text-success',
    warning: 'border-l-warning text-warning',
    error: 'border-l-danger text-danger',
  };

  $effect(() => {
    if (!message || paused) return;
    const timer = setTimeout(onclose, duration);
    return () => clearTimeout(timer);
  });
</script>

<!-- The live region stays in the DOM so screen readers announce each new message. -->
<div
  class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
  role={announce ? 'status' : undefined}
  aria-live={announce ? 'polite' : undefined}
>
  {#if message}
    <div
      class="surface pointer-events-auto flex w-full max-w-md items-center gap-3 border-l-4 py-3 pl-4 pr-2 shadow-[var(--shadow-lift)] {KIND_CLASS[
        kind
      ]}"
      role="presentation"
      onmouseenter={() => (paused = true)}
      onmouseleave={() => (paused = false)}
      onfocusin={() => (paused = true)}
      onfocusout={() => (paused = false)}
    >
      <svg
        class="size-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {#if kind === 'success'}
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="m5 13 4 4L19 7"
          />
        {:else}
          <path stroke-linecap="round" stroke-width="2.5" d="M12 7v6m0 4h.01" />
        {/if}
      </svg>
      <p class="min-w-0 flex-1 text-sm font-semibold text-brand-900">{message}</p>
      {#if actionLabel && onaction}
        <ActionButton
          variant="secondary"
          type="button"
          class="shrink-0"
          onclick={() => {
            onaction();
            onclose();
          }}>{actionLabel}</ActionButton
        >
      {/if}
      <button
        type="button"
        class="flex size-9 shrink-0 items-center justify-center text-neutral-700"
        aria-label="Hinweis schließen"
        onclick={onclose}
      >
        <svg
          class="size-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-width="2.5" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  {/if}
</div>
