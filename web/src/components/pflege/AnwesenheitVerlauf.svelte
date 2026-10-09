<script lang="ts">
  import { monthlyStats } from '../../lib/anwesenheit';
  import type { AnwesenheitMeeting } from '../../lib/types';

  interface Props {
    stufe: string;
    meetings: AnwesenheitMeeting[];
  }
  let { stufe, meetings }: Props = $props();

  const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const stats = $derived(monthlyStats(meetings, stufe));
</script>

<section aria-labelledby="anwesenheit-verlauf" class="space-y-3">
  <h2 id="anwesenheit-verlauf" class="font-serif text-2xl text-brand-900">
    {stufe}: Verlauf & Statistik
  </h2>
  {#if stats.length === 0}
    <p class="text-sm text-neutral-700">Für diese Stufe ist noch nichts erfasst.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-neutral-300 text-neutral-700">
          <tr>
            <th scope="col" class="py-2 pr-4 font-semibold">Monat</th>
            <th scope="col" class="py-2 pr-4 text-right font-semibold">Termine</th>
            <th scope="col" class="py-2 pr-4 text-right font-semibold">Kinder im Schnitt</th>
            <th scope="col" class="py-2 text-right font-semibold">Gäste</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200">
          {#each stats as row (row.month)}
            <tr>
              <th scope="row" class="py-2 pr-4 font-normal">
                {MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00Z`))}
              </th>
              <td class="py-2 pr-4 text-right tabular-nums">{row.termine}</td>
              <td class="py-2 pr-4 text-right tabular-nums">
                {(row.members / row.termine).toLocaleString('de-DE', {
                  maximumFractionDigits: 1,
                })}
              </td>
              <td class="py-2 text-right tabular-nums">{row.guests}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
