<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { tick, type Snippet } from 'svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    open: boolean;
    /** Action sheets share the app dialog, anchored at the bottom on small screens. */
    mobileSheet?: boolean;
    hideSubmit?: boolean;
    /** Action sheets use their footer close action instead of a second header button. */
    hideHeaderClose?: boolean;
    title: string;
    busy?: boolean;
    submitDisabled?: boolean;
    /** Error shown above the buttons, e.g. a conflict or network error. */
    error?: string | null;
    /** Result of an action that keeps the dialog open, e.g. a replaced photo. */
    notice?: string | null;
    submitLabel?: string;
    submitVariant?: 'primary' | 'danger';
    cancelLabel?: string;
    busyLabel?: string;
    onsubmit: () => void;
    onclose: () => void;
    children: Snippet;
    /** Extra actions on the left of the footer, e.g. a delete button. */
    actions?: Snippet;
  }

  let {
    open,
    mobileSheet = false,
    hideSubmit = false,
    hideHeaderClose = false,
    title,
    busy = false,
    submitDisabled = false,
    error = null,
    notice = null,
    submitLabel = 'Speichern',
    submitVariant = 'primary',
    cancelLabel = 'Abbrechen',
    busyLabel = 'Wird gespeichert …',
    onsubmit,
    onclose,
    children,
    actions,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let form = $state<HTMLFormElement | null>(null);
  const headingId = `dialog-${Math.random().toString(36).slice(2, 9)}`;
  /** Whether a field differs from its value when the dialog opened; saving closes the dialog. */
  let edited = $state(false);
  let confirmingDiscard = $state(false);
  let keepEditingButton = $state<HTMLButtonElement | null>(null);
  let previousFocus: HTMLElement | null = null;

  async function keepEditing(): Promise<void> {
    confirmingDiscard = false;
    await tick();
    previousFocus?.focus();
  }
  /** Value of each field when the dialog opened, or before the user first touched it. */
  let initial: { el: Element; value: string }[] = [];

  /** Serializes a form control's current value; other elements yield null. */
  function valueOf(el: Element): string | null {
    if (el instanceof HTMLInputElement) {
      return el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value;
    }
    if (el instanceof HTMLSelectElement) {
      return Array.from(el.selectedOptions, (option) => option.value).join('\n');
    }
    if (el instanceof HTMLTextAreaElement) return el.value;
    return null;
  }

  /** Records a field's value the first time it is seen, before the user changes it. */
  function remember(el: EventTarget | null): void {
    if (!(el instanceof Element) || initial.some((entry) => entry.el === el)) return;
    const value = valueOf(el);
    if (value !== null) initial.push({ el, value });
  }

  /** Recomputes `edited`, so restoring the original values clears it again. */
  function updateEdited(): void {
    edited = initial.some(({ el, value }) => el.isConnected && valueOf(el) !== value);
  }

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      edited = false;
      confirmingDiscard = false;
      initial = [];
      for (const el of form?.elements ?? []) remember(el);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    if (open && edited) return guardUnsavedChanges(() => true);
  });

  /** Keep discard confirmation inside the app dialog, preserving the mounted form. */
  async function requestClose(): Promise<void> {
    if (busy) return;
    if (confirmingDiscard) {
      await keepEditing();
    } else if (edited) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      confirmingDiscard = true;
      await tick();
      keepEditingButton?.focus();
    } else onclose();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={headingId}
  class:mobile-sheet={mobileSheet}
  class="edit-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  onclose={() => {
    if (open) onclose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    void requestClose();
  }}
>
  {#if open}
    <form
      novalidate
      class="flex max-h-[calc(100dvh-2rem)] flex-col"
      bind:this={form}
      onfocusincapture={(event) => remember(event.target)}
      onpointerdowncapture={(event) => remember(event.target)}
      oninput={updateEdited}
      onchange={updateEdited}
      onsubmit={(event) => {
        event.preventDefault();
        if (!busy && !submitDisabled && !confirmingDiscard) onsubmit();
      }}
    >
      <div class="flex items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4">
        <h2 id={headingId} class="font-serif text-xl font-semibold text-brand-900">
          {confirmingDiscard ? 'Änderungen verwerfen?' : title}
        </h2>
        {#if !hideHeaderClose}
          <button
            type="button"
            class="-mr-2 rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
            aria-label="Schließen"
            disabled={busy}
            onclick={requestClose}
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
        {/if}
      </div>

      {#if confirmingDiscard}
        <p class="px-5 py-4">
          Die Änderungen sind noch nicht gespeichert. Möchtest du sie verwerfen?
        </p>
      {/if}
      <div hidden={confirmingDiscard} class="space-y-4 overflow-y-auto px-5 py-4">
        {@render children()}
      </div>

      {#if confirmingDiscard}
        <div class="flex flex-wrap justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <ActionButton variant="secondary" bind:element={keepEditingButton} onclick={keepEditing}
            >Weiter bearbeiten</ActionButton
          >
          <ActionButton variant="danger" onclick={onclose}>Änderungen verwerfen</ActionButton>
        </div>
      {/if}
      <div hidden={confirmingDiscard} class="border-t border-neutral-200 px-5 py-3">
        <StatusNotice message={error ? null : notice} class={notice && !error ? 'mb-3' : ''} />
        {#if error}
          <p role="alert" class="mb-3 text-sm text-danger">{error}</p>
        {/if}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>{@render actions?.()}</div>
          <div class="flex flex-wrap justify-end gap-2">
            <ActionButton variant="secondary" type="button" disabled={busy} onclick={requestClose}>
              {cancelLabel}
            </ActionButton>
            {#if !hideSubmit}<ActionButton
                variant={submitVariant}
                type="submit"
                disabled={busy || submitDisabled}
                aria-busy={busy}
              >
                {busy ? busyLabel : submitLabel}
              </ActionButton>{/if}
          </div>
        </div>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .edit-dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
  @media (max-width: 639px) {
    .edit-dialog.mobile-sheet {
      margin: auto 0 0;
      width: 100%;
      max-width: none;
      border-radius: 1rem 1rem 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
</style>
