<script lang="ts">
  import { untrack } from 'svelte';
  import FotoPfad from './FotoPfad.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { folderEntry, loadFotoFolder } from '../../lib/fotoOrdnerStore.svelte';

  interface Props {
    /** Chosen folder; empty for the top folder. */
    path: string;
    /** New folder below the chosen one, shown after the path. */
    pending?: string[];
  }
  let { path = $bindable(), pending = [] }: Props = $props();

  const entry = $derived(folderEntry(path));

  $effect(() => {
    const current = path;
    untrack(() => void loadFotoFolder(current));
  });
</script>

<div class="space-y-2">
  <div class="surface-muted px-3 py-2">
    <p class="text-xs font-semibold text-neutral-700">Deine Fotos landen in</p>
    <FotoPfad {path} {pending} onselect={(next) => (path = next)} />
  </div>

  <LoadState
    data={entry.data}
    loading={entry.loading}
    error={entry.error}
    loadingText="Ordner werden geladen …"
    onretry={() => void loadFotoFolder(path, { force: true })}
    isEmpty={(data) => data.folders.length === 0}
  >
    {#snippet empty()}
      <p class="text-sm text-neutral-700">In diesem Ordner gibt es keine weiteren Ordner.</p>
    {/snippet}
    {#snippet children(data)}
      <ul class="max-h-80 divide-y divide-neutral-200 overflow-y-auto border-y border-neutral-200">
        {#each data.folders as folder (folder.path)}
          <li>
            <button
              type="button"
              class="flex min-h-12 w-full items-center gap-3 py-2 text-left text-brand-900 hover:underline"
              onclick={() => (path = folder.path)}
            >
              <svg
                aria-hidden="true"
                class="size-5 shrink-0 text-brand-700"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
                /></svg
              >
              <span class="min-w-0 flex-1 truncate">{folder.name}</span>
              <span aria-hidden="true" class="text-neutral-700">›</span>
            </button>
          </li>
        {/each}
      </ul>
    {/snippet}
  </LoadState>
</div>
