<script lang="ts">
  import { einplanungKennung, faktorText } from '../../lib/essensplanungEinplanung';
  import type { Platz } from '../../lib/essensplanungEinplanung';

  /** Where a dish is planned: „Eingeplant: 1_2_1 Mittagessen ×0,5, …“. */

  interface Props {
    plaetze: Platz[];
  }
  let { plaetze }: Props = $props();

  const text = $derived(
    plaetze
      .map(({ mahlzeit, einplanung }) =>
        [einplanungKennung(mahlzeit, einplanung.id), mahlzeit.name, faktorText(einplanung.faktor)]
          .filter(Boolean)
          .join(' ')
      )
      .join(', ')
  );
</script>

<p class="text-sm text-neutral-700">
  {#if plaetze.length}Eingeplant: {text}{:else}Noch nicht eingeplant.{/if}
</p>
