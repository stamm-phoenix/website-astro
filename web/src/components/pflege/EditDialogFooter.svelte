<script lang="ts">
  import type { Snippet } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import FormFeedback from './FormFeedback.svelte';
  interface Props {
    open: boolean;
    form: HTMLFormElement | null;
    busy: boolean;
    submitDisabled: boolean;
    error: string | null;
    shownNotice: string | null;
    submitLabel: string;
    cancelLabel: string;
    busyLabel: string;
    deleteLabel: string;
    deleteDisclosure: boolean;
    ondelete?: () => void;
    onreload?: () => void;
    onclose: () => void;
    actions?: Snippet;
    hideSubmit?: boolean;
  }
  let {
    open,
    form,
    busy,
    submitDisabled,
    error,
    shownNotice,
    submitLabel,
    cancelLabel,
    busyLabel,
    deleteLabel,
    deleteDisclosure,
    ondelete,
    onreload,
    onclose,
    actions,
    hideSubmit = false,
  }: Props = $props();
  let deleteActionsOpen = $state(false);
  $effect(() => {
    if (!open) deleteActionsOpen = false;
  });
</script>

<div class="shrink-0 border-t border-neutral-200 px-5 py-3">
  <FormFeedback {form} />
  <StatusNotice message={error ? null : shownNotice} class={shownNotice && !error ? 'mb-3' : ''} />
  {#if error}
    <p role="alert" class="mb-3 text-sm text-danger"><MessageText text={error} /></p>
  {/if}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap gap-2">
      {#if ondelete}
        {#snippet deleteButton()}
          <ActionButton variant="danger" type="button" disabled={busy} onclick={ondelete}
            >{deleteLabel}</ActionButton
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
      {#if onreload}<ActionButton variant="secondary" disabled={busy} onclick={onreload}
          >Aktuelle Fassung laden</ActionButton
        >{/if}
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <ActionButton variant="secondary" type="button" disabled={busy} onclick={onclose}>
        {cancelLabel}
      </ActionButton>
      {#if !hideSubmit}
        <ActionButton
          variant="primary"
          type="submit"
          disabled={busy || submitDisabled}
          aria-busy={busy}
        >
          {busy ? busyLabel : submitLabel}
        </ActionButton>
      {/if}
    </div>
  </div>
</div>
