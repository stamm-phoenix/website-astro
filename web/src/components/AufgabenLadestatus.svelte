<script lang="ts">
  import MessageText from './ui/MessageText.svelte';
  import { aufgabenStore, loadTasks } from '../lib/aufgabenStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
</script>

{#if aufgabenStore.loading}<p role="status" class="my-4">Aufgabenbereich wird geladen …</p>{/if}
{#if aufgabenStore.error}<div class="my-4">
    <p role="alert" class="text-danger"><MessageText text={aufgabenStore.error} /></p>
    <ActionButton variant="secondary" disabled={aufgabenStore.loading} onclick={loadTasks}
      >Neu laden</ActionButton
    >
  </div>{/if}
