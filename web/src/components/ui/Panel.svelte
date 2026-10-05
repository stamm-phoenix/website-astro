<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLElement> {
    children: Snippet;
  }
  let { class: className = '', children, ...attributes }: Props = $props();
</script>

<section class={`surface p-4 sm:p-6 ${className}`} {...attributes}>
  {@render children()}
</section>
