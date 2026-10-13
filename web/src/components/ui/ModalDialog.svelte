<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    onopen?: () => void;
    sheet?: boolean;
    headingActions?: Snippet;
    children: Snippet;
  }
  let { open, title, onclose, onopen, sheet = false, headingActions, children }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  const id = $props.id();
  $effect(() => {
    if (open && dialog && !dialog.open) {
      onopen?.();
      dialog.showModal();
    }
    if (!open && dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={id}
  class="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  class:action-sheet={sheet}
  onclose={() => {
    if (open) onclose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
>
  {#if open}
    <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
      <div
        class="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4"
      >
        <h2 {id} class="font-serif text-xl font-semibold text-brand-900">{title}</h2>
        {@render headingActions?.()}
      </div>
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
  @media (max-width: 639px) {
    .action-sheet {
      margin: auto 0 0;
      width: 100%;
      max-width: none;
      border-radius: 1rem 1rem 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
</style>
