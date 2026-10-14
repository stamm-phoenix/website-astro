<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { tick, setContext, type Snippet } from 'svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { confirmAction } from '../../lib/confirm';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    open: boolean;
    title: string;
    busy?: boolean;
    submitDisabled?: boolean;
    /** Error shown above the buttons, e.g. a conflict or network error. */
    error?: string | null;
    /** Result of an action that keeps the dialog open, e.g. a replaced photo. */
    notice?: string | null;
    submitLabel?: string;
    cancelLabel?: string;
    busyLabel?: string;
    /** Unsaved state outside the form fields, e.g. a chosen photo; closing asks first. */
    dirty?: boolean;
    /** Shows a delete button; the deletion runs after `deleteQuestion` was confirmed. */
    ondelete?: () => void | Promise<void>;
    deleteLabel?: string;
    deleteQuestion?: string;
    onedit?: (event: Event) => void;
    onreload?: () => Promise<boolean>;
    onsubmit: () => void;
    onclose: () => void;
    children: Snippet;
    /** Extra actions on the left of the footer, after the delete button. */
    actions?: Snippet;
  }

  let {
    open,
    title,
    busy = false,
    submitDisabled = false,
    error = null,
    notice = null,
    submitLabel = 'Speichern',
    cancelLabel = 'Abbrechen',
    busyLabel = 'Wird gespeichert …',
    dirty = false,
    ondelete,
    deleteLabel = 'Löschen',
    deleteQuestion = 'Diesen Eintrag endgültig löschen?',
    onedit,
    onreload,
    onsubmit,
    onclose,
    children,
    actions,
  }: Props = $props();

  let form = $state<HTMLFormElement | null>(null);
  /** Whether a field differs from its value when the dialog opened; saving closes the dialog. */
  let edited = $state(false);
  const unsaved = $derived(edited || dirty);
  let confirmingDiscard = $state(false);
  let reloadRequested = $state(false);
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

  setContext('form-edited', () => {
    void tick().then(updateEdited);
  });

  function opened(): void {
    edited = false;
    confirmingDiscard = false;
    initial = [];
    for (const el of form?.elements ?? []) remember(el);
  }

  $effect(() => {
    if (open && unsaved) return guardUnsavedChanges(() => true);
  });

  async function requestDelete(): Promise<void> {
    const confirmed = await confirmAction({
      title: `${deleteLabel}?`,
      message: deleteQuestion,
      confirmLabel: deleteLabel,
    });
    if (confirmed) await ondelete?.();
  }

  /** Keep discard confirmation inside the app dialog, preserving the mounted form. */
  async function requestClose(): Promise<void> {
    if (busy) return;
    if (confirmingDiscard) {
      await keepEditing();
    } else if (unsaved) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      confirmingDiscard = true;
    } else onclose();
  }
</script>

<ModalDialog {open} {title} closeDisabled={busy} onclose={requestClose} onopen={opened}>
  <form
    novalidate
    class="flex min-h-0 flex-col"
    bind:this={form}
    onfocusincapture={(event) => remember(event.target)}
    onpointerdowncapture={(event) => remember(event.target)}
    oninput={(event) => {
      updateEdited();
      onedit?.(event);
    }}
    onchange={(event) => {
      updateEdited();
      onedit?.(event);
    }}
    onsubmit={(event) => {
      event.preventDefault();
      if (!busy && !submitDisabled && !confirmingDiscard) onsubmit();
    }}
  >
    <div class="space-y-4 overflow-y-auto px-5 py-4">
      {@render children()}
    </div>

    <div class="border-t border-neutral-200 px-5 py-3">
      <StatusNotice message={error ? null : notice} class={notice && !error ? 'mb-3' : ''} />
      {#if error}
        <p role="alert" class="mb-3 text-sm text-danger">{error}</p>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          {#if ondelete}<ActionButton
              variant="danger"
              type="button"
              disabled={busy}
              onclick={() => void requestDelete()}>{deleteLabel}</ActionButton
            >{/if}
          {@render actions?.()}
          {#if onreload}<ActionButton
              variant="secondary"
              disabled={busy}
              onclick={() => {
                reloadRequested = true;
                confirmingDiscard = true;
              }}>Aktuelle Fassung laden</ActionButton
            >{/if}
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <ActionButton variant="secondary" type="button" disabled={busy} onclick={requestClose}>
            {cancelLabel}
          </ActionButton>
          <ActionButton
            variant="primary"
            type="submit"
            disabled={busy || submitDisabled}
            aria-busy={busy}
          >
            {busy ? busyLabel : submitLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  </form>
</ModalDialog>
<ConfirmDialog
  open={open && confirmingDiscard}
  title={reloadRequested ? 'Aktuelle Fassung laden?' : 'Änderungen verwerfen?'}
  cancelLabel="Weiter bearbeiten"
  submitLabel={reloadRequested ? 'Neu laden' : 'Änderungen verwerfen'}
  onclose={() => {
    reloadRequested = false;
    void keepEditing();
  }}
  onconfirm={async () => {
    confirmingDiscard = false;
    if (reloadRequested) {
      reloadRequested = false;
      if (await onreload?.()) {
        await tick();
        opened();
      }
    } else onclose();
  }}
>
  <p>
    {reloadRequested
      ? 'Die aktuelle Fassung ersetzt deine Eingaben. Möchtest du neu laden?'
      : 'Die Änderungen sind noch nicht gespeichert. Möchtest du sie verwerfen?'}
  </p>
</ConfirmDialog>
