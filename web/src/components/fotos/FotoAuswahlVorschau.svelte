<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import { fotoKind } from '../../lib/fotoPfade';

  interface Props {
    files: File[];
    onremove: (file: File) => void;
  }
  let { files, onremove }: Props = $props();

  /** Shown before „Alle anzeigen“; previews of many large photos cost memory on a phone. */
  const FIRST = 24;

  let showAll = $state(false);
  /** Local preview links of the shown files; released when a file leaves the list. */
  const urls = new SvelteMap<File, string>();
  /** Files the browser cannot show (e.g. HEIC outside Safari, RAW). */
  const unreadable = new SvelteMap<File, true>();

  const shown = $derived(showAll ? files : files.slice(0, FIRST));

  function isVideo(file: File): boolean {
    return file.type.startsWith('video/') || fotoKind(file.name) === 'video';
  }

  $effect(() => {
    const visible = new Set(shown);
    for (const file of visible) {
      if (!urls.has(file) && !isVideo(file)) urls.set(file, URL.createObjectURL(file));
    }
    for (const [file, url] of urls) {
      if (!visible.has(file)) {
        URL.revokeObjectURL(url);
        urls.delete(file);
      }
    }
  });

  $effect(() => () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  });
</script>

<ul class="grid grid-cols-4 gap-1 sm:grid-cols-6" aria-label="Ausgewählte Dateien">
  {#each shown as file (file)}
    {@const url = urls.get(file)}
    <li class="relative aspect-square overflow-hidden bg-[var(--color-neutral-200)]">
      {#if url && !unreadable.has(file)}
        <img
          src={url}
          alt=""
          aria-hidden="true"
          width="120"
          height="120"
          decoding="async"
          class="h-full w-full object-cover"
          onerror={() => unreadable.set(file, true)}
        />
      {:else}
        <span
          class="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center text-[0.65rem] leading-tight text-neutral-700"
        >
          <span aria-hidden="true" class="text-base">{isVideo(file) ? '▶' : '🖼'}</span>
          <span class="line-clamp-3 break-all">{file.name}</span>
        </span>
      {/if}
      <button
        type="button"
        class="absolute right-0 top-0 flex size-11 items-start justify-end p-1"
        aria-label={`${file.name} (${formatFileSize(file.size)}) aus der Auswahl entfernen`}
        onclick={() => onremove(file)}
      >
        <span
          aria-hidden="true"
          class="flex size-6 items-center justify-center rounded-full bg-black/60 text-sm text-white"
          >×</span
        >
      </button>
    </li>
  {/each}
</ul>
{#if files.length > FIRST}
  <button
    type="button"
    class="min-h-11 text-sm text-[var(--color-link)] underline underline-offset-2"
    aria-expanded={showAll}
    onclick={() => (showAll = !showAll)}
  >
    {showAll ? 'Weniger anzeigen' : `Alle ${files.length} anzeigen`}
  </button>
{/if}
