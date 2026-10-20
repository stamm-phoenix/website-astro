<script lang="ts">
  import { averageMembers } from '../../lib/anwesenheit';
  import type { MonthStats } from '../../lib/anwesenheit';

  interface Props {
    /** Months of one Stufe, newest first, as `monthlyStats` returns them. */
    stats: MonthStats[];
  }
  let { stats }: Props = $props();

  /** Months shown in the chart at most, the newest ones. */
  const MONTHS = 12;
  const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const MONTH_SHORT = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });

  function monthDate(month: string): Date {
    return new Date(`${month}-01T00:00:00Z`);
  }

  function formatNumber(value: number): string {
    return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  }

  /** The newest months without gaps, oldest first; a month without entries has no stats. */
  const months = $derived.by(() => {
    if (stats.length === 0) return [];
    const byMonth = new Map(stats.map((entry) => [entry.month, entry]));
    const oldest = stats[stats.length - 1].month;
    const result: { month: string; stats: MonthStats | undefined }[] = [];
    const date = monthDate(stats[0].month);
    for (let i = 0; i < MONTHS; i++) {
      const month = date.toISOString().slice(0, 7);
      if (month < oldest) break;
      result.unshift({ month, stats: byMonth.get(month) });
      date.setUTCMonth(date.getUTCMonth() - 1);
    }
    return result;
  });

  /** Gridlines from 0 to a round maximum, at most six. */
  const ticks = $derived.by(() => {
    const max = Math.max(1, ...months.map((m) => (m.stats ? averageMembers(m.stats) : 0)));
    let step = max <= 10 ? 2 : 5;
    while (Math.ceil(max / step) > 5) step *= 2;
    const top = Math.ceil(max / step) * step;
    return Array.from({ length: top / step + 1 }, (_, index) => index * step);
  });
  const top = $derived(ticks[ticks.length - 1]);

  let active = $state<string | null>(null);
  /** The month of the readout: the one pointed at, else the newest. */
  const shown = $derived(
    months.find((m) => m.month === active) ?? months[months.length - 1] ?? null
  );
</script>

{#if months.length > 0}
  <figure class="space-y-2">
    <figcaption class="font-semibold text-brand-900">
      Kinder im Schnitt pro Gruppenstunde
    </figcaption>
    {#if shown}
      <p class="text-sm text-neutral-700">
        {MONTH_LABEL.format(monthDate(shown.month))}:
        {#if shown.stats && shown.stats.termine > 0}
          <strong class="text-base text-brand-900 tabular-nums"
            >{formatNumber(averageMembers(shown.stats))}</strong
          >
          Kinder im Schnitt bei {shown.stats.termine}
          {shown.stats.termine === 1 ? 'Gruppenstunde' : 'Gruppenstunden'}
        {:else}
          keine Gruppenstunde erfasst
        {/if}
        {#if shown.stats && shown.stats.cancelled > 0}
          · {shown.stats.cancelled} ausgefallen
        {/if}
      </p>
    {/if}
    <div
      class="chart"
      role="img"
      aria-label="Säulendiagramm der Kinder im Schnitt pro Monat. Die Zahlen stehen in der Tabelle „Zahlen pro Monat“."
    >
      <div class="plot" aria-hidden="true">
        {#each ticks as tick (tick)}
          <div class="gridline" style:bottom="{(tick / top) * 100}%">
            <span class="tick">{tick}</span>
          </div>
        {/each}
        <ol class="bars">
          {#each months as entry (entry.month)}
            {@const value = entry.stats ? averageMembers(entry.stats) : 0}
            <li
              class={['column', { active: shown?.month === entry.month }]}
              onpointerenter={() => (active = entry.month)}
              onpointerleave={() => (active = null)}
            >
              {#if value > 0}
                <span class="bar" style:height="{(value / top) * 100}%"></span>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
      <ol class="labels" aria-hidden="true">
        {#each months as entry (entry.month)}
          <li>{MONTH_SHORT.format(monthDate(entry.month)).replace('.', '')}</li>
        {/each}
      </ol>
    </div>
  </figure>
{/if}

<style>
  .chart {
    --axis: 1.75rem;
  }
  .plot {
    position: relative;
    height: 10rem;
    margin-left: var(--axis);
    border-bottom: 1px solid var(--color-neutral-300);
  }
  .gridline {
    position: absolute;
    right: 0;
    left: 0;
    border-top: 1px solid var(--color-neutral-200);
  }
  .tick {
    position: absolute;
    right: calc(100% + 0.375rem);
    transform: translateY(-50%);
    color: var(--color-neutral-700);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .bars,
  .labels {
    display: flex;
    gap: 2px;
  }
  .bars {
    position: absolute;
    inset: 0;
  }
  .column {
    display: flex;
    flex: 1;
    align-items: flex-end;
    justify-content: center;
  }
  .bar {
    width: min(100%, 2.5rem);
    border-radius: 4px 4px 0 0;
    background: var(--color-brand-500);
  }
  .column.active .bar {
    outline: 2px solid var(--color-brand-900);
    outline-offset: 1px;
  }
  .labels {
    margin-left: var(--axis);
    padding-top: 0.25rem;
  }
  .labels li {
    flex: 1;
    overflow: hidden;
    color: var(--color-neutral-700);
    font-size: 0.75rem;
    text-align: center;
  }
  @media (forced-colors: active) {
    .bar {
      background: CanvasText;
    }
  }
</style>
