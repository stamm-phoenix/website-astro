<script lang="ts">
  /**
   * The arrow of a `<summary>` that shows it opens: down while closed, up while open. It must be
   * a direct child of the summary, so an open `<details>` further out does not turn it.
   */
  interface Props {
    class?: string;
  }
  let { class: className = '' }: Props = $props();
</script>

<svg
  class="aufklapp-pfeil size-5 shrink-0 text-neutral-700 transition-transform print:hidden {className}"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
>

<style>
  :global(details[open] > summary > .aufklapp-pfeil) {
    transform: rotate(180deg);
  }
</style>
