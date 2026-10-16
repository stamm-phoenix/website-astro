<script lang="ts">
  interface Props {
    /** Folder path inside the library; empty for the top folder. */
    path: string;
    /** Makes the folders above the last one clickable. */
    onselect?: (path: string) => void;
    /** Extra folder that does not exist yet, shown after the path. */
    pending?: string[];
    /** Larger, with a folder symbol: the path as the navigation of the photo view. */
    large?: boolean;
    class?: string;
  }
  let { path, onselect, pending = [], large = false, class: className = '' }: Props = $props();

  const segments = $derived(path ? path.split('/') : []);
  const crumbs = $derived([
    { name: 'Fotos', path: '' },
    ...segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') })),
  ]);
</script>

<ol
  class={`flex flex-wrap items-center gap-x-1 gap-y-0.5 ${large ? 'text-base' : 'text-sm'} ${className}`}
>
  {#if large}
    <li aria-hidden="true" class="flex items-center">
      <svg
        class="mr-1 size-5 text-brand-700"
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
    </li>
  {/if}
  {#each crumbs as crumb, index (crumb.path)}
    {@const last = index === crumbs.length - 1}
    <li class={`flex min-w-0 items-center gap-1 ${large ? 'min-h-11' : ''}`}>
      {#if index > 0}<span aria-hidden="true" class="text-neutral-700">›</span>{/if}
      {#if onselect && !last}
        <button
          type="button"
          class="min-h-11 break-all text-left text-[var(--color-link)] underline underline-offset-2"
          onclick={() => onselect(crumb.path)}>{crumb.name}</button
        >
      {:else}
        <span
          class="break-all font-semibold text-brand-900"
          aria-current={last && onselect ? 'location' : undefined}>{crumb.name}</span
        >
      {/if}
    </li>
  {/each}
  {#each pending as name (name)}
    <li class="flex min-w-0 items-center gap-1">
      <span aria-hidden="true" class="text-neutral-700">›</span>
      <span class="break-all font-semibold text-brand-900">{name}</span>
      <span class="text-xs text-neutral-700">(neu)</span>
    </li>
  {/each}
</ol>
