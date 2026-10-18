<script lang="ts">
  interface Props {
    intro: string;
    /** Open from the start, for intros the page cannot be used without. */
    open?: boolean;
  }
  let { intro, open = false }: Props = $props();
</script>

<!-- The intro waits behind „Was ist das?“, so the content and the main action start high up on a
     phone. A <details> works without JavaScript, also where Astro renders this without hydration. -->
<details class="staff-intro group" {open}>
  <summary
    class="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-link underline underline-offset-4"
  >
    <svg
      aria-hidden="true"
      class="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M12 17h.01M12 8v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg
    >
    <span class="group-open:hidden">Was ist das?</span>
    <span class="hidden group-open:inline">Erklärung ausblenden</span>
  </summary>
  <p class="mt-1 max-w-prose text-neutral-800">{intro}</p>
</details>

<style>
  summary::-webkit-details-marker {
    display: none;
  }
</style>
