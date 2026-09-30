<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    busy?: boolean;
    /** Error shown above the buttons, e.g. a conflict or network error. */
    error?: string | null;
    submitLabel?: string;
    onsubmit: () => void;
    onclose: () => void;
    children: Snippet;
    /** Extra actions on the left of the footer, e.g. a delete button. */
    actions?: Snippet;
  }

  let {
    open,
    title,
    busy = false,
    error = null,
    submitLabel = 'Speichern',
    onsubmit,
    onclose,
    children,
    actions,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  const headingId = `dialog-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={headingId}
  class="edit-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-white p-0 shadow-lift"
  onclose={() => {
    if (open) onclose();
  }}
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  {#if open}
    <form
      novalidate
      class="flex max-h-[calc(100dvh-2rem)] flex-col"
      onsubmit={(event) => {
        event.preventDefault();
        if (!busy) onsubmit();
      }}
    >
      <div class="flex items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4">
        <h2 id={headingId} class="font-serif text-xl font-semibold text-brand-900">{title}</h2>
        <button
          type="button"
          class="rounded-full p-2 text-neutral-700 hover:bg-[var(--color-brand-50)]"
          aria-label="Schließen"
          disabled={busy}
          onclick={onclose}
        >
          <svg
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 overflow-y-auto px-5 py-4">
        {@render children()}
      </div>

      <div class="border-t border-neutral-200 px-5 py-3">
        {#if error}
          <p role="alert" class="mb-3 text-sm text-[var(--color-dpsg-red)]">{error}</p>
        {/if}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>{@render actions?.()}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-secondary" disabled={busy} onclick={onclose}>
              Abbrechen
            </button>
            <button type="submit" class="btn-primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Wird gespeichert …' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .edit-dialog::backdrop {
    background: rgb(0 48 86 / 0.35);
    backdrop-filter: blur(2px);
  }
</style>
