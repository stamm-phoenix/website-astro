<script lang="ts">
  import ReloadAction from './ui/ReloadAction.svelte';
  import MessageText from './ui/MessageText.svelte';
  import { aufgabenStore, loadTasks } from '../lib/aufgabenStore.svelte';
</script>

{#if aufgabenStore.loading}<p role="status" class="my-4">Aufgabenbereich wird geladen …</p>{/if}
{#if aufgabenStore.error}<div class="my-4">
    <p role="alert" class="text-danger"><MessageText text={aufgabenStore.error} /></p>
    <ReloadAction disabled={aufgabenStore.loading} onclick={loadTasks}>Neu laden</ReloadAction>
  </div>{/if}
