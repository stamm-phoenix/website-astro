<script lang="ts">
  import { formatShortDate } from '../../lib/nikolausAdmin';
  import { HELPER_ROLES, KITCHEN } from '../../lib/nikolausEinteilung';
  import { helperCoverage } from '../../lib/nikolausHelfende';
  import type { StaffNikolausHelfendeData } from '../../lib/types';
  import InfoHint from '../ui/InfoHint.svelte';

  interface Props {
    data: StaffNikolausHelfendeData;
  }
  let { data }: Props = $props();

  const coverage = $derived(helperCoverage(data));
</script>

<section aria-labelledby="helfende-coverage-heading" class="border-t border-neutral-200 pt-6">
  <h2 id="helfende-coverage-heading" class="inline font-serif text-xl font-semibold text-brand-900">
    Meldungen pro Tag und Posten
  </h2>
  <InfoHint
    label="Meldungen pro Tag und Posten"
    text="Gebraucht wird pro Team eine Person pro Posten. Wer sich für mehrere Posten meldet, zählt bei jedem mit."
    class="ml-1"
  />
  <div class="mt-3 overflow-x-auto">
    <table class="w-full min-w-[32rem] text-left text-sm">
      <thead class="border-b-2 border-neutral-300 text-neutral-700">
        <tr>
          <th scope="col" class="py-2 pr-4 font-semibold">Tag</th>
          {#each HELPER_ROLES as role (role)}
            <th scope="col" class="py-2 pr-4 font-semibold">{role}</th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-200">
        {#each coverage as day (day.date)}
          <tr>
            <th scope="row" class="py-2 pr-4 font-semibold"
              >{formatShortDate(day.date)}
              <span class="font-normal text-neutral-700"
                >({day.teams} {day.teams === 1 ? 'Team' : 'Teams'})</span
              ></th
            >
            {#each day.counts as entry (entry.role)}
              <td
                class="py-2 pr-4 tabular-nums {entry.role !== KITCHEN && entry.count < day.teams
                  ? 'font-semibold text-danger'
                  : ''}"
              >
                {entry.count}{entry.role !== KITCHEN ? ` / ${day.teams}` : ''}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
