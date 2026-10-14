<script lang="ts">
  interface Props {
    open: boolean;
    /** id of the panel the button opens. */
    controls: string;
    id?: string;
    onclick: () => void;
    /** The button element, for focus and outside-click checks. */
    ref?: HTMLButtonElement;
  }

  let { open, controls, id, onclick, ref = $bindable() }: Props = $props();
</script>

<!-- The hamburger of the site header; its three lines turn into a cross while the menu is open -->
<button
  bind:this={ref}
  {id}
  type="button"
  aria-controls={controls}
  aria-expanded={open}
  aria-label={open ? 'Menü schließen' : 'Menü öffnen'}
  class="menu-toggle inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md p-2 text-neutral-700 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 active:bg-neutral-200"
  {onclick}
>
  <span class="relative flex h-6 w-6 flex-col items-center justify-center" aria-hidden="true">
    <span class="hamburger-line absolute block h-0.5 w-6 bg-neutral-900" class:open></span>
    <span class="hamburger-line absolute block h-0.5 w-6 bg-neutral-900" class:open></span>
    <span class="hamburger-line absolute block h-0.5 w-6 bg-neutral-900" class:open></span>
  </span>
</button>

<style>
  .hamburger-line {
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: center;
  }
  .hamburger-line:nth-child(1) {
    transform: translateY(-0.45rem);
  }
  .hamburger-line:nth-child(2) {
    transform: translateY(0);
  }
  .hamburger-line:nth-child(3) {
    transform: translateY(0.45rem);
  }
  .hamburger-line.open:nth-child(1) {
    transform: rotate(45deg);
  }
  .hamburger-line.open:nth-child(2) {
    opacity: 0;
    transform: scaleX(0);
  }
  .hamburger-line.open:nth-child(3) {
    transform: rotate(-45deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .hamburger-line {
      transition: none;
    }
  }
</style>
