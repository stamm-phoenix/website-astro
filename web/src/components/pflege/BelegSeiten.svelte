<script lang="ts">
  /** The further pages of a receipt PDF, below the picture of its first page. */
  interface Props {
    /** The pictures of the pages from the second on. */
    seiten: { url: string; width: number; height: number }[];
    /** How many pages the PDF has; a very long one has more than are shown. */
    seitenzahl: number;
    class?: string;
  }
  let { seiten, seitenzahl, class: imgClass = '' }: Props = $props();
</script>

{#each seiten as seite, index (seite.url)}
  <img
    src={seite.url}
    alt="Seite {index + 2} von {seitenzahl} des PDFs"
    width={seite.width}
    height={seite.height}
    loading="lazy"
    class={imgClass}
  />
{/each}
{#if seitenzahl > seiten.length + 1}
  <p class="text-sm text-neutral-700">
    Die Seiten {seiten.length + 2} bis {seitenzahl} siehst du im heruntergeladenen PDF.
  </p>
{/if}
