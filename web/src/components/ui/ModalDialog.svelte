<script lang="ts">
  import { untrack, onMount, type Snippet } from 'svelte';
  /**
   * Focus return: when the opener is gone after closing, focus moves to the first enabled
   * button of the neighbouring `[data-focus-item]` element, then to `[data-focus-fallback]`.
   */
  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    onopen?: () => void;
    sheet?: boolean;
    showClose?: boolean;
    closeDisabled?: boolean;
    /** Label of the close button in the header. */
    closeLabel?: string;
    /** `wide` (44rem) for forms, `medium` (40rem) for details, `narrow` (28rem) for questions. */
    size?: 'wide' | 'medium' | 'narrow';
    /** Close on a click on the dimmed area around the dialog. Only for dialogs without input. */
    dismissOnBackdrop?: boolean;
    /** Stronger shadow and darker backdrop, so a question stands out from a dialog behind it. */
    prominent?: boolean;
    children: Snippet;
  }
  let {
    open,
    title,
    onclose,
    onopen,
    sheet = false,
    showClose = true,
    closeDisabled = false,
    closeLabel = 'Schließen',
    size = 'wide',
    dismissOnBackdrop = false,
    prominent = false,
    children,
  }: Props = $props();
  const WIDTH = {
    wide: 'w-[min(44rem,calc(100%-2rem))]',
    medium: 'w-[min(40rem,calc(100%-2rem))]',
    narrow: 'w-[min(28rem,calc(100%-4rem))]',
  } as const;
  /** Whether the current click started on the backdrop, so a drag out of the dialog keeps it open. */
  let pressedBackdrop = false;
  let dialog = $state<HTMLDialogElement | null>(null);
  const id = $props.id();
  let wasOpen = false;
  let opener: HTMLElement | null = null;
  let nearby: HTMLElement | null = null;
  let parentModal: HTMLDialogElement | null = null;
  function restoreFocus(): void {
    const source = opener;
    const neighbor = nearby;
    const parent = parentModal;
    opener = null;
    nearby = null;
    parentModal = null;
    requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]') || (parent && !parent.isConnected)) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.closest('dialog')
      )
        return;
      const target = source?.isConnected
        ? source
        : neighbor?.isConnected
          ? neighbor.querySelector<HTMLElement>('button:not(:disabled)')
          : document.querySelector<HTMLElement>('[data-focus-fallback]');
      target?.focus({ preventScroll: true });
    });
  }
  onMount(() => () => {
    if (wasOpen) restoreFocus();
  });
  $effect(() => {
    if (open && dialog && !dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      parentModal = opener?.closest('dialog') ?? null;
      const item = opener?.closest('[data-focus-item]');
      nearby = (item?.nextElementSibling ?? item?.previousElementSibling) as HTMLElement | null;
      untrack(() => onopen?.());
      dialog.showModal();
      wasOpen = true;
    }
    if (!open && dialog?.open) {
      dialog.close();
      wasOpen = false;
      restoreFocus();
    }
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={id}
  class="m-auto max-h-[calc(100dvh-2rem)] {WIDTH[
    size
  ]} rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  class:action-sheet={sheet}
  class:prominent
  onpointerdown={(event) => {
    pressedBackdrop = event.target === dialog;
  }}
  onclick={(event) => {
    const outside = pressedBackdrop && event.target === dialog;
    pressedBackdrop = false;
    if (outside && dismissOnBackdrop && !closeDisabled) onclose();
  }}
  onclose={() => {
    wasOpen = false;
    if (opener) restoreFocus();
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
        {#if showClose}
          <button
            type="button"
            class="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
            aria-label={closeLabel}
            disabled={closeDisabled}
            onclick={onclose}
          >
            <svg
              aria-hidden="true"
              class="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
            >
          </button>
        {/if}
      </div>
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
  .prominent {
    border-color: var(--color-neutral-300);
    box-shadow:
      0 24px 48px rgb(0 20 40 / 0.35),
      0 4px 12px rgb(0 20 40 / 0.25);
  }
  .prominent::backdrop {
    background: var(--dialog-backdrop-strong, rgb(0 30 56 / 0.55));
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
