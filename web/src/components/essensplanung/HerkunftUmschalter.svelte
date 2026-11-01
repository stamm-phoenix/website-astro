<script lang="ts">
  import { herkunftAnzeige, zeigeHerkunft } from './einkaufHerkunft.svelte';

  /** Switches the dishes each thing is for on and off, in all shopping lists of the page. */
</script>

<label
  class="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold text-brand-900 any-pointer-coarse:min-h-11 print:hidden"
>
  <input
    type="checkbox"
    class="size-4 accent-[var(--color-brand-900)] any-pointer-coarse:size-6"
    checked={herkunftAnzeige.an}
    onchange={(event) => zeigeHerkunft(event.currentTarget.checked)}
  />
  Für welche Gerichte
</label>
