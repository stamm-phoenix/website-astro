<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';

  interface Props {
    title: string;
    message: string;
    items?: string[];
    confirmLabel: string;
    cancelLabel: string;
    tone?: 'danger' | 'neutral';
    onresult: (confirmed: boolean) => void;
  }
  let {
    title,
    message,
    items = [],
    confirmLabel,
    cancelLabel,
    tone = 'danger',
    onresult,
  }: Props = $props();
  let open = $state(true);

  function finish(confirmed: boolean): void {
    open = false;
    onresult(confirmed);
  }
</script>

<ConfirmDialog
  {open}
  {title}
  submitLabel={confirmLabel}
  {cancelLabel}
  {tone}
  onclose={() => finish(false)}
  onconfirm={() => finish(true)}
>
  <p>{message}</p>
  {#if items.length}
    <ul class="list-disc space-y-1 pl-5">
      {#each items as item (item)}<li>{item}</li>{/each}
    </ul>
  {/if}
</ConfirmDialog>
