<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * The buttons of an action block in fixed rows of two equal-width buttons, instead of a
   * wrapping row of buttons of different widths. The next step of a workflow spans both
   * columns (`class="col-span-2"`); the other buttons follow grouped by purpose. On wide
   * screens the grid stays at a handy width. Other attributes (`role="group"`, `aria-label`)
   * go to the grid.
   */
  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }
  let { children, class: className, ...attributes }: Props = $props();
</script>

<div
  class={['grid max-w-xl grid-cols-2 gap-2 [&>a]:w-full [&>button]:w-full', className]}
  {...attributes}
>
  {@render children()}
</div>
