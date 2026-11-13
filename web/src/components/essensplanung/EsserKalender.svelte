<script lang="ts">
  import { datumKurz } from '../../lib/essensplanung';
  import { kalenderZeilen } from '../../lib/essensplanungPlan';
  import type { PlanungAnsicht } from '../../../../api/lib/essen-planung-model';
  import type { esserJeMahlzeit } from '../../../../api/lib/essen-teilnehmende-model';

  /**
   * The eaters per meal as a table like the calendar of the plan: the days as columns, the meals
   * as rows with their names on the left; a meal a day does not have is hatched.
   */

  interface Props {
    ansicht: PlanungAnsicht;
    esser: ReturnType<typeof esserJeMahlzeit>;
    gruppenName: Map<number, string>;
  }
  let { ansicht, esser, gruppenName }: Props = $props();
  const zeilen = $derived(kalenderZeilen(ansicht.tage));
</script>

<table class="w-full border-collapse text-sm" aria-labelledby="esser-heading">
  <thead>
    <tr>
      <th
        scope="col"
        class="sticky left-0 z-10 w-36 min-w-[5.5rem] border-r border-b border-neutral-300 bg-neutral-100 px-2 py-1.5 text-left text-xs font-semibold text-neutral-700"
      >
        Mahlzeit
      </th>
      {#each ansicht.tage as tag (tag.id)}
        <th
          scope="col"
          class="min-w-[10.5rem] border-b border-l border-neutral-300 bg-neutral-100 px-2 py-1.5 text-left font-semibold text-brand-900"
        >
          Tag {tag.nummer}
          <span class="font-normal text-neutral-700">· {datumKurz(tag.datum)}</span>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each zeilen as zeile, z (z)}
      {@const streifen = z % 2 === 1 ? 'bg-neutral-50' : 'bg-surface'}
      <tr>
        <th
          scope="row"
          class="sticky left-0 z-10 border-r border-b border-neutral-300 px-2 py-1.5 text-left align-top font-semibold break-words text-brand-900 hyphens-auto {z %
            2 ===
          1
            ? 'bg-neutral-100'
            : 'bg-surface'}"
        >
          {zeile.name}
        </th>
        {#each ansicht.tage as tag (tag.id)}
          {@const mahlzeit = zeile.mahlzeiten.get(tag.id)}
          {#if mahlzeit}
            {@const zahl = esser.get(mahlzeit.id)}
            <td
              class="border-b border-l border-neutral-200 px-2 py-1.5 align-top {streifen}"
              data-esser={mahlzeit.kennung}
            >
              <p class="text-[0.7rem] text-neutral-700">
                <span class="font-mono">{mahlzeit.kennung}</span>{#if mahlzeit.ohneGruppen.length}
                  · ohne {mahlzeit.ohneGruppen.map((id) => gruppenName.get(id)).join(', ')}{/if}
              </p>
              <p class="font-bold text-neutral-900 tabular-nums">
                <span data-zahl>{zahl?.personen ?? 0}</span>
                <span class="text-xs font-normal">Personen</span>
              </p>
              <p class="text-xs text-neutral-700 tabular-nums">
                mit allem <span data-zahl>{zahl?.je.alles.personen ?? 0}</span> · veg.
                <span data-zahl>{zahl?.je.vegetarisch.personen ?? 0}</span> · vegan
                <span data-zahl>{zahl?.je.vegan.personen ?? 0}</span>
              </p>
            </td>
          {:else}
            <td
              class="border-b border-l border-neutral-200 bg-neutral-50 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-neutral-200)_6px_7px)]"
              aria-label="Tag {tag.nummer}: keine Mahlzeit {zeile.name}"
            ></td>
          {/if}
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
