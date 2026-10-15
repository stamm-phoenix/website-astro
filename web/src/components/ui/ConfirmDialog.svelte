<script lang="ts">
  import type { Snippet } from 'svelte';
  import ModalDialog from './ModalDialog.svelte';
  import ActionButton from './ActionButton.svelte';
  import MessageText from './MessageText.svelte';
  let {
    open,
    title,
    busy = false,
    error = null,
    submitLabel = 'Löschen',
    cancelLabel = 'Abbrechen',
    busyLabel = 'Wird gelöscht …',
    onclose,
    onconfirm,
    onreload,
    children,
  }: {
    open: boolean;
    title: string;
    busy?: boolean;
    error?: string | null;
    submitLabel?: string;
    cancelLabel?: string;
    busyLabel?: string;
    onclose: () => void;
    onconfirm: () => void;
    /** Offered next to an error, e.g. after a conflict, to load the current version. */
    onreload?: () => void | Promise<void>;
    children: Snippet;
  } = $props();
</script>

<ModalDialog
  {open}
  {title}
  showClose={false}
  closeDisabled={busy}
  onclose={() => {
    if (!busy) onclose();
  }}
>
  <div class="space-y-4 px-5 py-4">{@render children()}</div>
  <div class="border-t border-neutral-200 px-5 py-3">
    {#if error}<p role="alert" class="mb-3 text-sm text-danger">
        <MessageText text={error} />
      </p>{/if}
    <div class="flex flex-wrap justify-end gap-2">
      {#if error && onreload}<ActionButton
          variant="secondary"
          class="mr-auto"
          disabled={busy}
          onclick={() => void onreload()}>Aktuelle Fassung laden</ActionButton
        >{/if}
      <ActionButton variant="secondary" disabled={busy} onclick={onclose}
        >{cancelLabel}</ActionButton
      ><ActionButton variant="danger" disabled={busy} aria-busy={busy} onclick={onconfirm}
        >{busy ? busyLabel : submitLabel}</ActionButton
      >
    </div>
  </div>
</ModalDialog>
