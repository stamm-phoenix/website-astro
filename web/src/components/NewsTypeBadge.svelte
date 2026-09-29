<script lang="ts">
  interface Props {
    type: 'blog' | 'instagram';
  }
  let { type }: Props = $props();
</script>

<!-- Marks the kind of post in „Neues aus dem Stamm“; the text is also read out -->
<span
  class="absolute top-2 left-2 z-[1] inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm"
  class:badge-blog={type === 'blog'}
  class:badge-instagram={type === 'instagram'}
>
  {#if type === 'blog'}
    <svg
      class="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
    Blog
  {:else}
    <svg
      class="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
    </svg>
    Instagram
  {/if}
</span>

<style>
  .badge-blog {
    background: var(--color-brand-900);
    color: white;
  }

  .badge-instagram {
    background: rgb(255 255 255 / 0.92);
    color: var(--color-brand-900);
  }
</style>
