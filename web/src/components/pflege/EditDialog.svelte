<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import EditDialogFooter from './EditDialogFooter.svelte';
  import { onDestroy, tick, setContext, untrack, type Snippet } from 'svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { beginFormFeedback } from '../../lib/formFeedback';
  import { confirmAction } from '../../lib/confirm';
  import NichtEingesetzt from './NichtEingesetzt.svelte';
  import {
    fillDialog,
    setRescueContext,
    forgetRescue,
    shownValues,
    withoutEditedField,
    type GeretteterWert,
    type RescueEditor,
    type RescueField,
    type RescueDependency,
  } from '../../lib/geretteteEingaben';
  import {
    acceptVersion,
    adoptKept,
    canAdopt,
    leftOverValues,
    fillAppeared,
    keepDialogInput,
    keptOnOpening,
    openedDialog,
    rescueNotice,
    restoreKept,
  } from '../../lib/dialogRettung';

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
    /** Original record version, including text held outside native form fields. */
    rescueVersion?: string;
    rescueWarning?: string | null;
    rescueFields?: RescueField[];
    rescueDependencies?: RescueDependency[];
    rescueDependencyVersion?: (key: string) => string | undefined;
    onedit?: (event: Event) => void;
    onreload?: () => Promise<boolean>;
    onsubmit: () => void;
    onclose: () => void;
    children: Snippet;
    /**
     * Shown before the fields; on large screens beside them in its own scrolling column, e.g. the
     * picture of a receipt. Give the dialog `size="split"` for the room.
     */
    aside?: Snippet;
    size?: 'wide' | 'split';
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
    rescueVersion,
    rescueWarning = null,
    rescueFields = [],
    rescueDependencies = [],
    rescueDependencyVersion,
    onedit,
    onreload,
    onsubmit,
    onclose,
    children,
    aside,
    size = 'wide',
    actions,
  }: Props = $props();

  let form = $state<HTMLFormElement | null>(null);
  /** Whether a field differs from its value when the dialog opened; saving closes the dialog. */
  let edited = $state(false);
  /** Input from before a new login was filled in again; it is unsaved until saved. */
  let restored = $state(false);
  let rescueConflict = $state(false);
  let rescueAppliedNotice = $state<string | null>(null);
  const unsaved = $derived(edited || dirty || restored);
  let confirmingDiscard = $state(false);
  let reloadRequested = $state(false);
  let previousFocus: HTMLElement | null = null;
  /** Kept input without a field to go into, e.g. a row the form does not have yet. */
  let pending = $state<GeretteterWert[]>([]);
  const leftOver = $derived(leftOverValues(rescueConflict, pending));
  const shownNotice = $derived(
    notice ?? rescueAppliedNotice ?? rescueNotice(rescueConflict, restored, leftOver.length)
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
  /** Record, title and field values when the dialog opened; they identify what is edited. */
  let opening = openedDialog(undefined, '', '', []);
  /** The record of the open dialog: `rescueKey` when it opened. */
  let record: string | undefined;

  /** A confirmed partial write (a photo) advances only our version, never unsaved fields. */
  export function acceptRescueVersion(previous: string, saved: string): void {
    if (!rescueConflict) opening = acceptVersion(opening, previous, saved);
  }

  /** Additional save/transfer actions use the same error guidance as the submit button. */
  export function beginValidation(): void {
    if (form && open && !busy) beginFormFeedback(form);
  }
  setRescueContext({
    warning: () => rescueWarning,
    enabled: () => record !== undefined,
    rescue: () =>
      !rescueConflict && form
        ? keepDialogInput(form, opening, editors, pending, rescueFields, rescueDependencies)
        : false,
    register(editor) {
      editors.push(editor);
      if (form && !rescueConflict && pending.length > 0) {
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
    pending = await restoreKept(form, editors, kept, rescueFields, tick);
    // Kept until everything found its field; editors still loading take theirs on arrival
    if (shownValues(pending).length === 0) forgetRescue(record);
    restored = true;
    await tick();
    updateEdited();
  }

  function opened(): void {
    edited = false;
    confirmingDiscard = false;
    initial = [];
    for (const el of form?.elements ?? []) remember(el);
    restored = false;
    rescueConflict = false;
    rescueAppliedNotice = null;
    pending = [];
    discarded = false;
    record = rescueKey;
    opening = openedDialog(
      record,
      title,
      rescueVersion ?? '',
      initial
        .filter(({ el }) => !(el instanceof HTMLInputElement && el.type === 'hidden'))
        .map((entry) => entry.value)
    );
    const kept = keptOnOpening(opening, Date.now(), rescueDependencyVersion);
    if (kept && !kept.conflict) void restore(kept.values);
    else if (kept) {
      pending = kept.values;
      rescueConflict = true;
      restored = true;
    }
  }

  /** Explicitly adopts one compound selection; other saved values are never filled in. */
  function applyRescueField(kept: GeretteterWert): boolean {
    if (!open || busy) return false;
    const adopted = adoptKept(kept, pending, rescueFields);
    if (!adopted) return false;
    pending = adopted.pending;
    rescueAppliedNotice = adopted.notice;
    void tick().then(updateEdited);
    return true;
  }

  // Creating a person keeps the dialog open for their photo. Its new ID and saved
  // values become the baseline before any further edits or a new login.
  $effect(() => {
    if (
      open &&
      rescueKey !== undefined &&
      untrack(() => record !== undefined && record !== rescueKey)
    ) {
      untrack(() => {
        forgetRescue(record);
        opened();
      });
    }
  });

  $effect(() => {
    if (open && unsaved) return guardUnsavedChanges(() => true);
  });

  // A field added later, e.g. a row for kept input, takes its value as soon as it appears
  $effect(() => {
    if (!form || !restored || rescueConflict || pending.length === 0) return;
    const target = form;
    const observer = new MutationObserver(() => {
      pending = fillAppeared(target, editors, pending, rescueFields);
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

<ModalDialog {open} {title} {size} closeDisabled={busy} onclose={requestClose} onopen={opened}>
  <form
    novalidate
    class="flex min-h-0 flex-col"
    bind:this={form}
    onfocusincapture={(event) => remember(event.target)}
    onpointerdowncapture={(event) => remember(event.target)}
    oninput={(event) => {
      if (event.isTrusted && form && !rescueConflict)
        pending = withoutEditedField(form, pending, event.target);
      updateEdited();
      onedit?.(event);
    }}
    onchange={(event) => {
      if (event.isTrusted && form && !rescueConflict)
        pending = withoutEditedField(form, pending, event.target);
      updateEdited();
      onedit?.(event);
    }}
    onsubmit={(event) => {
      event.preventDefault();
      if (!busy && !submitDisabled && !confirmingDiscard) onsubmit();
    }}
  >
    {#snippet fields(scrollClass: string)}
      <!-- Positioned, so hidden inputs (e.g. the file input of a photo) stay inside the scroll area -->
      <div class="relative min-h-0 space-y-4 px-5 py-4 {scrollClass}">
        <fieldset disabled={busy} inert={busy} class="min-w-0 space-y-4">
          {@render children()}
        </fieldset>
        {#if restored && leftOver.length > 0}<NichtEingesetzt
            values={leftOver}
            conflict={rescueConflict}
            canApply={(kept) => canAdopt(kept, rescueFields)}
            onapply={applyRescueField}
          />{/if}
      </div>
    {/snippet}
    {#if aside}
      <!-- One scroll area on small screens; on large ones two columns that scroll on their own -->
      <div class="relative flex min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div
          class="relative min-h-0 shrink-0 px-5 pt-4 lg:w-1/2 lg:shrink lg:overflow-y-auto lg:border-r lg:border-neutral-200 lg:pb-4"
        >
          <fieldset disabled={busy} inert={busy} class="min-w-0 space-y-4">
            {@render aside()}
          </fieldset>
        </div>
        {@render fields('shrink-0 lg:flex-1 lg:shrink lg:overflow-y-auto')}
      </div>
    {:else}
      {@render fields('overflow-y-auto')}
    {/if}

    <EditDialogFooter
      {open}
      {form}
      {busy}
      {submitDisabled}
      {error}
      {shownNotice}
      {submitLabel}
      {cancelLabel}
      {busyLabel}
      {deleteLabel}
      {deleteDisclosure}
      {actions}
      ondelete={ondelete ? () => void requestDelete() : undefined}
      onreload={onreload
        ? () => {
            reloadRequested = true;
            confirmingDiscard = true;
          }
        : undefined}
      onclose={() => void requestClose()}
    />
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
        if (record !== undefined) forgetRescue(record);
        await tick();
        opened();
      }
    } else {
      discarded = true;
      if (record !== undefined) forgetRescue(record);
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
