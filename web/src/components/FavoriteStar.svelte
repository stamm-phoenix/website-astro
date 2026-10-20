<script lang="ts">
  import { favoritesStore, favoriteToggle } from '../lib/staffFavoritesStore.svelte';
  import type { StaffModule } from '../lib/staffModules';

  interface Props {
    module: StaffModule;
    /** Smaller for the sidebar. */
    compact?: boolean;
  }
  let { module, compact = false }: Props = $props();

  const STAR = 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z';

  const toggle = $derived(favoriteToggle(module));
  const active = $derived(favoritesStore.modules.includes(module.href));
</script>

<!--
  With a mouse the star shows while the row is hovered (or the star has the focus). On a touch
  screen a long press on the row toggles the favorite, so the star only marks the favorites there
  and lets taps through to the row.
-->
{#if toggle}
  <button
    type="button"
    class="favorite-star flex shrink-0 items-center justify-center text-brand-900 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 {compact
      ? 'size-11 pointer-fine:size-9'
      : 'size-11'} {active ? 'pointer-coarse:opacity-100' : ''}"
    aria-pressed={active}
    aria-label="{module.title} als Favorit"
    title={active ? 'Aus deinen Favoriten entfernen' : 'Zu deinen Favoriten hinzufügen'}
    onclick={toggle}
  >
    <!-- The outline stays; the filling grows out of the middle of the star when it is added -->
    <svg
      aria-hidden="true"
      class={compact ? 'size-4' : 'size-5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
      ><path d={STAR} /><path
        class={['star-fill', active && 'active']}
        d={STAR}
        fill="currentColor"
      /></svg
    >
  </button>
{/if}

<style>
  /* No bounce: the scale stays below 1, so a quick second tap shrinks it back without overshoot */
  .star-fill {
    opacity: 0;
    transform: scale(0.4);
    transform-origin: 12px 12.5px;
    transition:
      transform var(--motion-quick) var(--motion-enter),
      opacity var(--motion-quick) ease-out;
  }
  .star-fill.active {
    opacity: 1;
    transform: none;
  }
</style>
