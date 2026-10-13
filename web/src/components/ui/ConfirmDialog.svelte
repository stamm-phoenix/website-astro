<script lang="ts">
  import type { Snippet } from 'svelte';
  import ActionButton from './ActionButton.svelte';
  let {
    open,
    title,
    busy = false,
    error = null,
    submitLabel = 'Löschen',
    onclose,
    onconfirm,
    children,
  }: {
    open: boolean;
    title: string;
    busy?: boolean;
    error?: string | null;
    submitLabel?: string;
    onclose: () => void;
    onconfirm: () => void;
    children: Snippet;
  } = $props();
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
  class="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  onclose={() => {
    if (open) onclose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onclose();
  }}
>
  {#if open}
    <h2
      {id}
      class="border-b border-neutral-200 px-5 py-4 font-serif text-xl font-semibold text-brand-900"
    >
      {title}
    </h2>
    <div class="space-y-4 px-5 py-4">{@render children()}</div>
    <div class="border-t border-neutral-200 px-5 py-3">
      {#if error}<p role="alert" class="mb-3 text-sm text-danger">{error}</p>{/if}
      <div class="flex justify-end gap-2">
        <ActionButton variant="secondary" disabled={busy} onclick={onclose}>Abbrechen</ActionButton
        ><ActionButton variant="danger" disabled={busy} aria-busy={busy} onclick={onconfirm}
          >{busy ? 'Wird gelöscht …' : submitLabel}</ActionButton
        >
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
</style>
