<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';

  interface Props {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    onresult: (confirmed: boolean) => void;
  }
  let { title, message, confirmLabel, cancelLabel, onresult }: Props = $props();
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
  onclose={() => finish(false)}
  onconfirm={() => finish(true)}
>
  <p>{message}</p>
</ConfirmDialog>
