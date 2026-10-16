<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';

  interface Props {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    tone?: 'danger' | 'neutral';
    onresult: (confirmed: boolean) => void;
  }
  let { title, message, confirmLabel, cancelLabel, tone = 'danger', onresult }: Props = $props();
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
</ConfirmDialog>
