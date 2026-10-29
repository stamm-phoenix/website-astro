<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Content wider than the screen, e.g. a calendar of many days: it scrolls sideways, says so
   * while there is more to see, and can be reached and scrolled with the keyboard then.
   */
  interface Props {
    /** Name of the area for screen readers, e.g. „Esser je Mahlzeit“. */
    label: string;
    /** „Weitere Tage siehst du, wenn du seitlich wischst.“ */
    hinweis: string;
    children: Snippet;
  }
  let { label, hinweis, children }: Props = $props();

  let bereich = $state<HTMLDivElement | null>(null);
  /** As wide as the content, so a day added later changes its size too. */
  let inhalt = $state<HTMLDivElement | null>(null);
  let breiter = $state(false);

  $effect(() => {
    const element = bereich;
    const innen = inhalt;
    if (!element || !innen) return;
    const messen = (): void => {
      breiter = element.scrollWidth > element.clientWidth + 1;
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    beobachter.observe(innen);
    return () => beobachter.disconnect();
  });
</script>

{#if breiter}
  <p class="text-sm text-neutral-700">{hinweis}</p>
{/if}
<!-- Focusable only while it scrolls, so the arrow keys reach the hidden part -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={bereich}
  class="overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2"
  role="region"
  aria-label={label}
  tabindex={breiter ? 0 : undefined}
>
  <div bind:this={inhalt} class="w-max min-w-full">
    {@render children()}
  </div>
</div>
