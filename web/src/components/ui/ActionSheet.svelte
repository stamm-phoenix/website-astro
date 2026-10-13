<script lang="ts">
  import type { Snippet } from 'svelte';
  import ModalDialog from './ModalDialog.svelte';
  import ActionButton from './ActionButton.svelte';
  let {
    open,
    title,
    onclose,
    children,
  }: { open: boolean; title: string; onclose: () => void; children: Snippet } = $props();
</script>

<ModalDialog {open} {title} {onclose} sheet>
  <div class="overflow-y-auto px-5 py-4">{@render children()}</div>
  <div class="flex justify-end border-t border-neutral-200 px-5 py-3">
    <ActionButton variant="secondary" onclick={onclose}>Schließen</ActionButton>
  </div>
</ModalDialog>
