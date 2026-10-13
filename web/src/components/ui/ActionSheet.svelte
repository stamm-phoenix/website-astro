<script lang="ts">
  import type { Snippet } from 'svelte';
  import ActionButton from './ActionButton.svelte';
  let {
    open,
    title,
    onclose,
    children,
  }: { open: boolean; title: string; onclose: () => void; children: Snippet } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  const id = $props.id();
  $effect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={id}
  class="action-sheet m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  onclose={() => {
    if (open) onclose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
>
  {#if open}
    <h2
      {id}
      class="border-b border-neutral-200 px-5 py-4 font-serif text-xl font-semibold text-brand-900"
    >
      {title}
    </h2>
    <div class="overflow-y-auto px-5 py-4">{@render children()}</div>
    <div class="flex justify-end border-t border-neutral-200 px-5 py-3">
      <ActionButton variant="secondary" onclick={onclose}>Schließen</ActionButton>
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
