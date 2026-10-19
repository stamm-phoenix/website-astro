<script lang="ts" generics="T extends CalendarItem">
  import type { Snippet } from 'svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { localDate } from '../lib/dateUtils';
  import {
    SWIPE_START,
    commits,
    moveTrack,
    panelDuration,
    releaseVelocity,
    settleDuration,
    settleEasing,
    settleTransition,
    startTrack,
    type SwipeTrack,
  } from '../lib/swipe';
  import type { CalendarItem } from '../lib/types';

  interface Props {
    /** Items to show; items without date are not shown in the grid. */
    rows: T[];
    /** Shown month as `YYYY-MM`. */
    month: string;
    onmonth: (month: string) => void;
    /** Renders an item (an `<li>`) in the list below the grid. */
    card: Snippet<[T]>;
    /** Colour classes (background, text, border) of an item's bar. */
    barClass: (row: T) => string;
    /** Explains the bar colours below the grid. */
    legend?: Snippet;
  }

  let { rows, month, onmonth, card, barClass, legend }: Props = $props();

  /** Day whose Aktionen are listed below the grid; `null` lists the whole month. */
  let selectedDay = $state<string | null>(null);

  /** Sideways shift of the grid while a finger moves it, in pixels. */
  let offset = $state(0);
  /** Duration of the settle back to rest; 0 while the finger moves it. */
  let settleMs = $state(0);
  /** Curve of the settle back, starting at the speed of the released finger. */
  let settleCurve = $state('var(--motion-enter)');
  let swipe: { track: SwipeTrack; axis: 'x' | null; width: number } | null = null;

  /** Bars per week row; further Aktionen are counted per day as „+N“. */
  const MAX_LANES = 3;
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const today = localDate();
  const currentMonth = today.slice(0, 7);

  const monthFormatter = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dayFormatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  function toDate(day: string): Date {
    return new Date(`${day}T00:00:00Z`);
  }

  function addDays(day: string, days: number): string {
    const date = toDate(day);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function shiftMonth(value: string, delta: number): string {
    const date = toDate(`${value}-01`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    return date.toISOString().slice(0, 7);
  }

  const monthLabel = $derived(monthFormatter.format(toDate(`${month}-01`)));

  /** Weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
  const weeks = $derived.by(() => {
    const first = `${month}-01`;
    const offset = (toDate(first).getUTCDay() + 6) % 7;
    const nextMonth = `${shiftMonth(month, 1)}-01`;
    const result: string[][] = [];
    let day = addDays(first, -offset);
    while (day < nextMonth || result.at(-1)?.length !== 7) {
      if (!result.length || result.at(-1)!.length === 7) result.push([]);
      result.at(-1)!.push(day);
      day = addDays(day, 1);
    }
    return result;
  });

  /** A part of an Aktion within one week, drawn as one bar across its days. */
  interface Segment {
    row: T;
    /** Column of the first day in this week (0 = Monday). */
    column: number;
    span: number;
    lane: number;
    /** Whether the Aktion starts or ends in this week (rounded ends) or continues. */
    starts: boolean;
    ends: boolean;
  }

  function rowEnd(row: T & { start: string }): string {
    return row.end && row.end > row.start ? row.end : row.start;
  }

  /**
   * Bars per week: each Aktion takes the first lane free on all its days. Earlier and longer
   * Aktionen come first, so multi-day bars stay in the same lane over several weeks where possible.
   */
  const weekLayouts = $derived(
    weeks.map((week) => {
      const weekStart = week[0]!;
      const weekEnd = week[6]!;
      const candidates = rows
        .filter((r): r is T & { start: string } => r.start !== null)
        .filter((r) => r.start <= weekEnd && rowEnd(r) >= weekStart)
        .sort(
          (a, b) =>
            a.start.localeCompare(b.start) ||
            rowEnd(b).localeCompare(rowEnd(a)) ||
            a.title.localeCompare(b.title, 'de')
        );
      const laneEnds: number[] = [];
      const segments: Segment[] = [];
      const hidden = [0, 0, 0, 0, 0, 0, 0];
      for (const row of candidates) {
        const end = rowEnd(row);
        const column = row.start < weekStart ? 0 : week.indexOf(row.start);
        const last = end > weekEnd ? 6 : week.indexOf(end);
        let lane = laneEnds.findIndex((laneEnd) => laneEnd < column);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = last;
        if (lane >= MAX_LANES) {
          for (let i = column; i <= last; i++) hidden[i]!++;
          continue;
        }
        segments.push({
          row,
          column,
          span: last - column + 1,
          lane,
          starts: row.start >= weekStart,
          ends: end <= weekEnd,
        });
      }
      return { segments, hidden };
    })
  );

  /** Rows per day; multi-day Aktionen appear on every day they cover. */
  const rowsByDay = $derived.by(() => {
    const first = weeks[0]?.[0] ?? '';
    const last = weeks.at(-1)?.at(-1) ?? '';
    const byDay: Record<string, T[]> = Object.create(null);
    const sorted = rows
      .filter((r): r is T & { start: string } => r.start !== null)
      .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'de'));
    for (const row of sorted) {
      const end = row.end && row.end > row.start ? row.end : row.start;
      if (end < first || row.start > last) continue;
      for (let day = row.start < first ? first : row.start; day <= end && day <= last;) {
        (byDay[day] ??= []).push(row);
        day = addDays(day, 1);
      }
    }
    return byDay;
  });

  const monthRows = $derived(
    rows
      .filter((r) => {
        if (!r.start) return false;
        const end = r.end && r.end > r.start ? r.end : r.start;
        return r.start.slice(0, 7) <= month && end.slice(0, 7) >= month;
      })
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
  );

  const listed = $derived(selectedDay ? (rowsByDay[selectedDay] ?? []) : monthRows);

  $effect(() => {
    // A selected day belongs to the month it was chosen in
    if (selectedDay && selectedDay.slice(0, 7) !== month) selectedDay = null;
  });

  function dayLabel(day: string, count: number): string {
    const text = dayFormatter.format(toDate(day));
    return `${text}: ${count === 0 ? 'keine Aktion' : count === 1 ? '1 Aktion' : `${count} Aktionen`}`;
  }

  /** Back to rest at the speed the finger left it (towards rest, in pixels per millisecond). */
  function settle(velocity: number): void {
    settleMs = settleDuration(offset, velocity, panelDuration());
    settleCurve = settleEasing(offset, velocity, settleMs);
    offset = 0;
  }

  /**
   * Swipes to the next or previous month like the arrow buttons: the grid follows the finger
   * sideways. Vertical movement and pinching stay with the browser, so the page still scrolls.
   * Months have no first or last one, so every swipe can change the month.
   */
  function swipeArea(area: HTMLElement): () => void {
    function start(event: TouchEvent): void {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0]!;
      swipe = {
        track: startTrack(touch.clientX, touch.clientY, event.timeStamp),
        axis: null,
        width: area.clientWidth,
      };
    }

    function move(event: TouchEvent): void {
      if (!swipe) return;
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0]!;
      const dx = touch.clientX - swipe.track.startX;
      const dy = touch.clientY - swipe.track.startY;
      if (swipe.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          swipe = null;
          return;
        }
        swipe.axis = 'x';
      }
      if (event.cancelable) event.preventDefault();
      moveTrack(swipe.track, touch.clientX, touch.clientY, event.timeStamp);
      settleMs = 0;
      offset = dx;
    }

    function end(event: TouchEvent): void {
      const ended = swipe;
      swipe = null;
      if (!ended || ended.axis !== 'x') return;
      const dx = ended.track.lastX - ended.track.startX;
      const velocity = releaseVelocity(ended.track, 'x', event.timeStamp);
      const step = dx < 0 ? 1 : -1;
      // Distance and speed in the direction of the swipe
      if (commits(-step * dx, -step * velocity, ended.width / 4)) {
        // The new month appears in place; it does not slide in from the old position
        settleMs = 0;
        offset = 0;
        onmonth(shiftMonth(month, step));
      } else {
        settle(step * velocity);
      }
    }

    function cancel(): void {
      if (swipe?.axis === 'x') settle(0);
      swipe = null;
    }

    area.addEventListener('touchstart', start, { passive: true });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', cancel);
    return () => {
      area.removeEventListener('touchstart', start);
      area.removeEventListener('touchmove', move);
      area.removeEventListener('touchend', end);
      area.removeEventListener('touchcancel', cancel);
    };
  }

  function select(day: string): void {
    if (day.slice(0, 7) !== month) {
      onmonth(day.slice(0, 7));
      selectedDay = day;
      return;
    }
    selectedDay = selectedDay === day ? null : day;
  }
</script>

<section class="space-y-4" aria-labelledby="aktionen-monat-titel">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 id="aktionen-monat-titel" class="font-serif text-xl font-semibold text-brand-900">
      {monthLabel}
    </h2>
    <div class="flex flex-wrap gap-2">
      <ActionButton
        variant="secondary"
        type="button"
        aria-label="Vorheriger Monat"
        onclick={() => onmonth(shiftMonth(month, -1))}
        ><span aria-hidden="true">‹</span></ActionButton
      >
      <ActionButton
        variant="secondary"
        type="button"
        disabled={month === currentMonth}
        onclick={() => onmonth(currentMonth)}>Heute</ActionButton
      >
      <ActionButton
        variant="secondary"
        type="button"
        aria-label="Nächster Monat"
        onclick={() => onmonth(shiftMonth(month, 1))}
        ><span aria-hidden="true">›</span></ActionButton
      >
    </div>
  </div>

  <!-- A sideways swipe changes the month; the clip keeps the moved grid from widening the page -->
  <div class="month-swipe" {@attach swipeArea}>
    <div
      class="surface overflow-hidden p-0"
      style:translate={offset ? `${offset}px 0` : null}
      style:transition={settleTransition('translate', settleMs, settleCurve)}
    >
      <div
        class="grid grid-cols-7 border-b border-[var(--color-neutral-200)] bg-[var(--color-brand-50)] text-center text-xs font-semibold text-brand-800"
        aria-hidden="true"
      >
        {#each WEEKDAYS as weekday (weekday)}
          <div class="py-2">{weekday}</div>
        {/each}
      </div>
      {#each weeks as week, index (week[0])}
        {@const layout = weekLayouts[index]!}
        <div
          class="relative grid grid-cols-7 border-b border-[var(--color-neutral-200)] last:border-b-0"
        >
          {#each week as day, column (day)}
            {@const dayRows = rowsByDay[day] ?? []}
            {@const outside = day.slice(0, 7) !== month}
            <button
              type="button"
              class="flex min-h-16 min-w-0 flex-col items-stretch border-r border-[var(--color-neutral-200)] p-1 text-left last:border-r-0 hover:bg-[var(--color-brand-50)] focus-visible:relative focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-900 sm:min-h-28 sm:p-1.5 {outside
                ? 'bg-[var(--color-neutral-100)]/60 text-neutral-500'
                : ''} {selectedDay === day ? 'bg-[var(--color-brand-100)]!' : ''}"
              aria-pressed={selectedDay === day}
              aria-label={dayLabel(day, dayRows.length)}
              onclick={() => select(day)}
            >
              <span
                class="flex size-6 items-center justify-center self-end rounded-sm text-xs font-semibold sm:self-start {day ===
                today
                  ? 'calendar-today'
                  : outside
                    ? ''
                    : 'text-brand-900'}"
                aria-hidden="true">{Number(day.slice(8, 10))}</span
              >
              {#if layout.hidden[column]}
                <span
                  class="mt-auto text-[10px] font-semibold text-neutral-700 sm:text-[11px]"
                  aria-hidden="true"
                  >+{layout.hidden[column]}<span class="hidden sm:inline"> weitere</span></span
                >
              {/if}
            </button>
          {/each}

          <!-- Bars lie over the day buttons; clicks go through to the day below -->
          <div
            class="pointer-events-none absolute inset-x-0 top-8 z-10 grid grid-cols-7 content-start gap-y-0.5 sm:top-9"
            aria-hidden="true"
          >
            {#each layout.segments as segment (segment.row.key)}
              <span
                class="h-1.5 min-w-0 border sm:h-auto sm:truncate sm:px-1 sm:py-px sm:text-[11px] sm:leading-tight {barClass(
                  segment.row
                )} {segment.starts
                  ? 'ml-1 rounded-l-full border-l sm:rounded-l'
                  : 'rounded-l-none border-l-0'} {segment.ends
                  ? 'mr-1 rounded-r-full border-r sm:rounded-r'
                  : 'rounded-r-none border-r-0'}"
                style="grid-column: {segment.column +
                  1} / span {segment.span}; grid-row: {segment.lane + 1};"
                title={segment.row.title}
                ><span class="hidden sm:inline"
                  >{segment.starts ? '' : '… '}{segment.row.title || 'Ohne Titel'}</span
                ></span
              >
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>

  {@render legend?.()}

  <div aria-live="polite" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-serif text-lg font-semibold text-brand-900">
        {selectedDay
          ? `Aktionen am ${dayFormatter.format(toDate(selectedDay))}`
          : `Alle Aktionen im ${monthLabel}`}
      </h3>
      {#if selectedDay}
        <ActionButton variant="secondary" type="button" onclick={() => (selectedDay = null)}
          >Ganzen Monat zeigen</ActionButton
        >
      {/if}
    </div>
    {#if listed.length === 0}
      <p class="surface p-6 text-sm text-neutral-700">
        {selectedDay
          ? 'An diesem Tag gibt es keine Aktion.'
          : 'In diesem Monat gibt es keine Aktion.'}
      </p>
    {:else}
      <ul class="grid gap-3">
        {#each listed as row (row.key)}
          {@render card(row)}
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  /* Sideways movement is the swipe's; scrolling up and down and zooming stay with the browser */
  .month-swipe {
    overflow-x: clip;
    touch-action: pan-y pinch-zoom;
  }
</style>
