<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'danger';
    children: Snippet;
    /** The rendered button, e.g. to move the focus to it. */
    element?: HTMLButtonElement | null;
  }

  let {
    variant = 'secondary',
    class: className = '',
    type = 'button',
    children,
    element = $bindable(null),
    ...attributes
  }: Props = $props();
</script>

<button bind:this={element} {type} class={`btn-${variant} ${className}`} {...attributes}>
  {@render children()}
</button>
