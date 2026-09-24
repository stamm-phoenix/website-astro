<script lang="ts">
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import type { NikolausSlot } from '../lib/types';

  interface Props {
    slots: NikolausSlot[];
    /** Key of the selected slot. */
    selected: string | null;
    /** Key of the slot the family has already booked; shown as "Ihr Termin". */
    currentSlot?: string | null;
    /** Prefix for element IDs, so the picker can appear on several pages. */
    idPrefix: string;
    error?: string;
    notice?: string | null;
    onselect?: (key: string) => void;
  }

  let {
    slots,
    selected = $bindable(),
    currentSlot = null,
    idPrefix,
    error,
    notice = null,
    onselect,
  }: Props = $props();

  let selectedDate = $state<string | null>(null);

  const days = $derived.by(() => {
    const byDate: Array<{ date: string; slots: NikolausSlot[]; free: number }> = [];
    for (const slot of slots) {
      let day = byDate.find((d) => d.date === slot.date);
      if (!day) {
        day = { date: slot.date, slots: [], free: 0 };
        byDate.push(day);
      }
      day.slots.push(slot);
      if (slot.available > 0 && slot.key !== currentSlot) day.free += 1;
    }
    return byDate;
  });

  const initialDate = $derived(slots.find((s) => s.key === currentSlot)?.date ?? null);
  const activeDay = $derived(days.find((d) => d.date === (selectedDate ?? initialDate)) ?? days[0]);

  function selectSlot(key: string): void {
    selected = key;
    onselect?.(key);
  }
</script>

<div class="mt-4 flex flex-wrap gap-2" role="group" aria-label="Tag auswählen">
  {#each days as day (day.date)}
    {@const isActive = activeDay?.date === day.date}
    <button
      type="button"
      class="day-tab rounded-full border px-4 py-2 text-sm font-semibold transition"
      class:day-tab-active={isActive}
      aria-pressed={isActive}
      onclick={() => (selectedDate = day.date)}
    >
      {formatNikolausDate(day.date).replace(/ \d{4}$/, '')}
      <span class="ml-1 font-normal opacity-80">
        · {day.free > 0 ? `${day.free} Zeiten frei` : 'ausgebucht'}
      </span>
    </button>
  {/each}
</div>

{#if notice}
  <p
    class="mt-4 rounded-md border border-[var(--color-dpsg-red)]/30 bg-[var(--color-dpsg-red)]/5 px-4 py-3 text-sm text-[var(--color-dpsg-red)]"
    role="alert"
  >
    {notice}
  </p>
{/if}

{#if activeDay}
  <div
    id="{idPrefix}-slots"
    class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    role="radiogroup"
    aria-label={`Uhrzeiten am ${formatNikolausDate(activeDay.date)}`}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${idPrefix}-slot-error` : undefined}
  >
    {#each activeDay.slots as slot (slot.key)}
      {@const isCurrent = slot.key === currentSlot}
      {@const full = slot.available === 0 && !isCurrent}
      {@const checked = selected === slot.key}
      <label
        class="slot"
        class:slot-full={full}
        class:slot-current={isCurrent}
        class:slot-checked={checked}
      >
        <input
          type="radio"
          name="{idPrefix}-slot"
          class="sr-only"
          value={slot.key}
          {checked}
          disabled={full || isCurrent}
          onchange={() => selectSlot(slot.key)}
        />
        <span class="block text-base font-semibold tabular-nums">
          {slot.time} – {slot.endTime}
        </span>
        <span class="block text-xs">
          {#if isCurrent}
            Ihr aktueller Termin
          {:else if full}
            ausgebucht
          {:else if slot.available === 1}
            noch 1 Team frei
          {:else}
            noch {slot.available} Teams frei
          {/if}
        </span>
      </label>
    {/each}
  </div>
{/if}

{#if error}
  <p id="{idPrefix}-slot-error" class="mt-3 text-sm text-[var(--color-dpsg-red)]">
    {error}
  </p>
{/if}

<style>
  .day-tab {
    border-color: var(--color-brand-200);
    color: var(--color-brand-800);
    background: white;
  }
  .day-tab:hover {
    background: var(--color-brand-50);
  }
  .day-tab-active,
  .day-tab-active:hover {
    background: var(--color-brand-800);
    border-color: var(--color-brand-800);
    color: white;
  }

  .slot {
    display: block;
    cursor: pointer;
    border-radius: 0.5rem;
    border: 2px solid var(--color-brand-200);
    background: white;
    padding: 0.75rem;
    color: var(--color-brand-900);
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      transform 0.15s ease;
  }
  .slot:hover {
    border-color: var(--color-brand-500);
    transform: translateY(-1px);
  }
  .slot:has(input:focus-visible) {
    outline: 3px solid var(--color-dpsg-red);
    outline-offset: 2px;
  }
  .slot-checked,
  .slot-checked:hover {
    border-color: var(--color-dpsg-red);
    background: var(--color-dpsg-red);
    color: white;
  }
  .slot-full,
  .slot-full:hover {
    cursor: not-allowed;
    border-style: dashed;
    border-color: var(--color-neutral-200);
    background: var(--color-neutral-100);
    color: #8a8579;
    transform: none;
  }
  .slot-full span:first-child {
    text-decoration: line-through;
  }
  .slot-current,
  .slot-current:hover {
    cursor: default;
    border-color: var(--color-brand-800);
    background: var(--color-brand-50);
    transform: none;
  }
</style>
