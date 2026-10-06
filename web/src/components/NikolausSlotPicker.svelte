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
    const byDate: Array<{ date: string; slots: NikolausSlot[]; free: number; closed: boolean }> =
      [];
    for (const slot of slots) {
      let day = byDate.find((d) => d.date === slot.date);
      if (!day) {
        day = { date: slot.date, slots: [], free: 0, closed: slot.closed };
        byDate.push(day);
      }
      day.slots.push(slot);
      if (slot.available > 0 && slot.key !== currentSlot) day.free += 1;
    }
    return byDate;
  });

  const initialDate = $derived(slots.find((s) => s.key === currentSlot)?.date ?? null);
  const activeDay = $derived(
    days.find((d) => d.date === (selectedDate ?? initialDate)) ??
      days.find((d) => !d.closed) ??
      days[0]
  );

  function selectSlot(key: string): void {
    selected = key;
    onselect?.(key);
  }
</script>

<div
  class="mt-4 flex flex-wrap gap-x-6 border-b border-neutral-200"
  role="group"
  aria-label="Tag auswählen"
>
  {#each days as day (day.date)}
    {@const isActive = activeDay?.date === day.date}
    <button
      type="button"
      class="day-tab -mb-px min-h-11 border-b-2 py-2 text-left text-sm font-semibold transition"
      class:day-tab-active={isActive}
      aria-pressed={isActive}
      onclick={() => (selectedDate = day.date)}
    >
      {formatNikolausDate(day.date).replace(/ \d{4}$/, '')}
      <span class="ml-1 font-normal opacity-80">
        · {day.closed
          ? 'Anmeldung geschlossen'
          : day.free > 0
            ? `${day.free} Zeiten frei`
            : 'ausgebucht'}
      </span>
    </button>
  {/each}
</div>

{#if notice}
  <p class="mt-4 border-l-4 border-danger py-1 pl-4 text-sm font-semibold text-danger" role="alert">
    {notice}
  </p>
{/if}

{#if activeDay?.closed}
  <p
    class="mt-5 border-l-4 border-[var(--color-brand-300)] py-1 pl-4 text-sm text-brand-900"
    role="status"
  >
    Die Online-Anmeldung für {formatNikolausDate(activeDay.date).replace(/ \d{4}$/, '')} ist geschlossen,
    weil wir an diesem Tag die Touren planen. In dringenden Fällen schreiben Sie uns bitte an
    <a class="font-semibold underline" href="mailto:kontakt@stamm-phoenix.de"
      >kontakt@stamm-phoenix.de</a
    >.
  </p>
{:else if activeDay}
  <div
    id="{idPrefix}-slots"
    class="mt-5 grid grid-cols-1 gap-x-6 border-b border-neutral-200 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
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
          value={slot.key}
          {checked}
          disabled={full || isCurrent}
          onchange={() => selectSlot(slot.key)}
        />
        <span>
          <span class="slot-time block text-base font-semibold tabular-nums">
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
        </span>
      </label>
    {/each}
  </div>
{/if}

{#if error}
  <p id="{idPrefix}-slot-error" class="mt-3 text-sm text-danger">
    {error}
  </p>
{/if}

<style>
  .day-tab {
    border-color: transparent;
    color: var(--color-neutral-700);
  }
  .day-tab:hover {
    color: var(--color-brand-900);
    border-color: var(--color-neutral-300);
  }
  .day-tab-active,
  .day-tab-active:hover {
    border-color: var(--color-accent-500);
    color: var(--color-brand-900);
  }

  .slot {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    min-height: 3rem;
    cursor: pointer;
    border-top: 1px solid var(--color-neutral-200);
    padding: 0.75rem 0.5rem;
    color: var(--color-brand-900);
  }
  .slot input {
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
    margin-top: 0.2rem;
    accent-color: var(--color-action);
  }
  /* Theme changes update text and background together, without a contrast dip. */
  .slot:hover {
    background: var(--color-brand-50);
  }
  .slot:has(input:focus-visible) {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  .slot-checked,
  .slot-checked:hover {
    box-shadow: inset 3px 0 0 var(--color-accent-500);
    color: var(--color-brand-900);
  }
  .slot-full,
  .slot-full:hover {
    cursor: not-allowed;
    background: none;
    color: var(--color-neutral-500);
  }
  .slot-full input {
    opacity: 0.4;
  }
  .slot-full .slot-time {
    text-decoration: line-through;
  }
  .slot-current,
  .slot-current:hover {
    cursor: default;
    background: none;
    box-shadow: inset 3px 0 0 var(--color-brand-800);
  }
</style>
