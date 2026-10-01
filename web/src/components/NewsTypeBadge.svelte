<script lang="ts">
  interface Props {
    type: 'blog' | 'instagram';
    /** Stand-alone line in the text flow; without it, the badge sits inside a meta line */
    inline?: boolean;
  }
  let { type, inline = false }: Props = $props();
</script>

<!-- Marks the kind of post in „Neues aus dem Stamm“ as plain text (no label box); the text is also read out -->
<span class="inline-flex w-fit items-center gap-1.5 text-neutral-700" class:text-sm={inline}>
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
