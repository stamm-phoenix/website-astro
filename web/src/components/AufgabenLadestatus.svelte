<script lang="ts">
  import ReloadAction from './ui/ReloadAction.svelte';
  import MessageText from './ui/MessageText.svelte';
  import { aufgabenStore, loadTasks } from '../lib/aufgabenStore.svelte';
</script>

{#if aufgabenStore.loading}<div role="status" class="my-4 min-h-[60dvh]">
    <p>Aufgabenbereich wird geladen …</p>
    <div class="skeleton-element mt-4 h-64" aria-hidden="true"></div>
  </div>{/if}
{#if aufgabenStore.error}<div class="my-4">
    <p role="alert" class="text-danger"><MessageText text={aufgabenStore.error} /></p>
    <ReloadAction disabled={aufgabenStore.loading} onclick={loadTasks}>Neu laden</ReloadAction>
  </div>{/if}
