<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { onDestroy, tick, setContext, type Snippet } from 'svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { confirmAction } from '../../lib/confirm';
  import StatusNotice from './StatusNotice.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import NichtEingesetzt from './NichtEingesetzt.svelte';
  import {
    fillDialog,
    rescueDialog,
    setRescueContext,
    findRescue,
    forgetRescue,
    shownValues,
    type GeretteterWert,
    type RescueEditor,
  } from '../../lib/geretteteEingaben';

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
    /** Keep rare destructive actions behind an explicit disclosure. */
    deleteDisclosure?: boolean;
    /** Title of the confirmation; names the object, e.g. „Gruppenstunde Wölflinge löschen?“. */
    deleteTitle?: string;
    deleteQuestion?: string;
    /**
     * Names the record being edited, e.g. `frage:12` or `frage:neu`. With it, a new login in the
     * iPhone app keeps the input and fills it in again when this record's dialog opens.
     */
    rescueKey?: string;
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
    deleteDisclosure = false,
    deleteTitle,
    deleteQuestion = 'Diesen Eintrag endgültig löschen?',
    rescueKey,
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
  /** Input from before a new login was filled in again; it is unsaved until saved. */
  let restored = $state(false);
  const unsaved = $derived(edited || dirty || restored);
  let confirmingDiscard = $state(false);
  let deleteActionsOpen = $state(false);
  let reloadRequested = $state(false);
  let previousFocus: HTMLElement | null = null;
  /** Kept input without a field to go into, e.g. a row the form does not have yet. */
  let pending = $state<GeretteterWert[]>([]);
  const leftOver = $derived(shownValues(pending));
  const shownNotice = $derived(
    notice ??
      (!restored
        ? null
        : leftOver.length > 0
          ? 'Ein Teil deiner Eingaben von vor der neuen Anmeldung ist wieder eingesetzt. Den Rest findest du darunter.'
          : 'Deine Eingaben von vor der neuen Anmeldung sind wieder eingesetzt. Prüf sie und speichere.')
  );

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

  // A new login in the iPhone app reloads the page; the input is kept and filled in again
  let editors: RescueEditor[] = [];
  /** Title and field values when the dialog opened; they identify the record being edited. */
  let openingTitle = '';
  /** The record of the open dialog: `rescueKey` when it opened. */
  let record: string | undefined;
  let opening = '';
  setRescueContext({
    enabled: () => record !== undefined,
    rescue: () =>
      form && record !== undefined
        ? rescueDialog(form, record, openingTitle, opening, editors, pending)
        : false,
    register(editor) {
      editors.push(editor);
      if (form && pending.length > 0) {
        pending = fillDialog(form, [editor], pending);
        if (shownValues(pending).length === 0) forgetRescue(record);
      }
      return () => {
        editors = editors.filter((entry) => entry !== editor);
      };
    },
  });

  async function restore(kept: GeretteterWert[]): Promise<void> {
    if (!form) return;
    // Choices first: their handlers may change other fields, which take their values after
    pending = fillDialog(form, editors, kept, 'choices');
    await tick();
    pending = fillDialog(form, editors, pending);
    // Fields that appear only after a choice above them
    await tick();
    if (pending.length > 0) pending = fillDialog(form, editors, pending);
    // Kept until everything found its field; editors still loading take theirs on arrival
    if (shownValues(pending).length === 0) forgetRescue(record);
    restored = true;
    await tick();
    updateEdited();
  }

  function opened(): void {
    edited = false;
    confirmingDiscard = false;
    deleteActionsOpen = false;
    initial = [];
    for (const el of form?.elements ?? []) remember(el);
    restored = false;
    pending = [];
    discarded = false;
    openingTitle = title;
    record = rescueKey;
    opening = JSON.stringify(initial.map((entry) => entry.value));
    const kept = record === undefined ? null : findRescue(record, opening, Date.now());
    if (kept) void restore(kept);
  }

  $effect(() => {
    if (open && unsaved) return guardUnsavedChanges(() => true);
  });

  // A field added later, e.g. a row for kept input, takes its value as soon as it appears
  $effect(() => {
    if (!form || !restored || pending.length === 0) return;
    const target = form;
    const observer = new MutationObserver(() => {
      pending = fillDialog(target, editors, pending);
      if (shownValues(pending).length === 0) forgetRescue(record);
    });
    observer.observe(target, { childList: true, subtree: true });
    return () => observer.disconnect();
  });

  /** Set when the person confirmed discarding; any other closing of a filled-in dialog saved. */
  let discarded = false;
  $effect(() => {
    if (!open && restored && !discarded) forgetRescue(record);
  });
  // Some dialogs are removed right after saving instead of closing; that also ends the rescue
  onDestroy(() => {
    if (restored && !discarded) forgetRescue(record);
  });

  async function requestDelete(): Promise<void> {
    const confirmed = await confirmAction({
      title: deleteTitle ?? `${deleteLabel}?`,
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
      <fieldset disabled={busy} inert={busy} class="min-w-0 space-y-4">
        {@render children()}
      </fieldset>
    </div>

    <div class="border-t border-neutral-200 px-5 py-3">
      <StatusNotice
        message={error ? null : shownNotice}
        class={shownNotice && !error ? 'mb-3' : ''}
      />
      {#if restored && leftOver.length > 0}<NichtEingesetzt values={leftOver} />{/if}
      {#if error}
        <p role="alert" class="mb-3 text-sm text-danger"><MessageText text={error} /></p>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          {#if ondelete}
            {#snippet deleteButton()}
              <ActionButton
                variant="danger"
                type="button"
                disabled={busy}
                onclick={() => void requestDelete()}>{deleteLabel}</ActionButton
              >
            {/snippet}
            {#if deleteDisclosure}
              <details bind:open={deleteActionsOpen}>
                <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-link"
                  >Weitere Aktionen</summary
                >
                <div class="pt-2">{@render deleteButton()}</div>
              </details>
            {:else}
              {@render deleteButton()}
            {/if}
          {/if}
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
    } else {
      discarded = true;
      onclose();
    }
  }}
>
  <p>
    {reloadRequested
      ? 'Die aktuelle Fassung ersetzt deine Eingaben. Möchtest du neu laden?'
      : 'Die Änderungen sind noch nicht gespeichert. Möchtest du sie verwerfen?'}
  </p>
</ConfirmDialog>
