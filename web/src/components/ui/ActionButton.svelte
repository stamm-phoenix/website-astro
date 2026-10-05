<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'danger';
    children: Snippet;
  }

  let {
    variant = 'secondary',
    class: className = '',
    type = 'button',
    children,
    ...attributes
  }: Props = $props();
</script>

<button {type} class={`btn-${variant} ${className}`} {...attributes}>
  {@render children()}
</button>
