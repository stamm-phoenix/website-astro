<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import {
    FAHRT_LABEL,
    freiePlaetze,
    withDriver,
    withMove,
    withRemoved,
  } from '../../lib/fahrtenPlan';
  import type { Fahrt, FahrtAnpassungen, FahrtPerson, FahrtPlan } from '../../lib/fahrtenPlan';
  import { FAHRER_PRIORITAETEN, PRIORITAET_LABEL } from '../../lib/fahrtenPrioritaet';
  import type { FahrerPrioritaet } from '../../lib/fahrtenPrioritaet';

  interface Props {
    /** The person picked in the plan, or `null` while the dialog is closed. */
    person: FahrtPerson | null;
    fahrt: Fahrt;
    plan: FahrtPlan;
    anpassungen: FahrtAnpassungen;
    prioritaet: FahrerPrioritaet;
    /** Applies a change of the plan of this direction; the dialog closes. */
    onanpassungen: (next: FahrtAnpassungen) => void;
    /** Sets how willing the person is to drive; the dialog stays open. */
    onprioritaet: (prioritaet: FahrerPrioritaet) => void;
    onclose: () => void;
  }

  let {
    person,
    fahrt,
    plan,
    anpassungen,
    prioritaet,
    onanpassungen,
    onprioritaet,
    onclose,
  }: Props = $props();

  /** Where the person sits now; read from the plan, so it follows a changed priority. */
  const auto = $derived(
    person
      ? (plan.autos.find(
          (a) => a.fahrer.id === person.id || a.mitfahrende.some((p) => p.id === person.id)
        ) ?? null)
      : null
  );
  const isDriver = $derived(person !== null && auto?.fahrer.id === person.id);
  const seats = $derived(person?.plaetze[fahrt] ?? 0);
  const offersSeats = $derived(
    person !== null && (person.plaetze.hin > 0 || person.plaetze.rueck > 0)
  );
  const targets = $derived(plan.autos.filter((a) => a !== auto && freiePlaetze(a) > 0));

  function seatsText(count: number): string {
    return count === 1 ? '1 Platz' : `${count} Plätze`;
  }
</script>

<ModalDialog
  open={person !== null}
  title={person?.name ?? ''}
  size="narrow"
  dismissOnBackdrop
  {onclose}
>
  {#if person}
    {@const current = person}
    <div class="space-y-4 overflow-y-auto px-5 py-4">
      <p class="text-sm text-neutral-700" aria-live="polite">
        {FAHRT_LABEL[fahrt]} ·
        {isDriver
          ? `fährt, ${seatsText(seats)}`
          : auto
            ? `fährt bei ${auto.fahrer.name} mit`
            : 'ohne Platz'}
      </p>

      {#if offersSeats}
        <fieldset>
          <legend class="form-label">Fahren</legend>
          <div class="grid gap-1 sm:grid-cols-3">
            {#each FAHRER_PRIORITAETEN as option (option)}
              <label class="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  class="size-5"
                  name="fahrer-prioritaet"
                  value={option}
                  checked={prioritaet === option}
                  onchange={() => onprioritaet(option)}
                />
                {PRIORITAET_LABEL[option]}
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}

      {#if !isDriver}
        <div>
          <h3 class="form-label">Mitfahren bei</h3>
          {#if targets.length === 0}
            <p class="text-sm text-neutral-700">In keinem anderen Auto ist ein Platz frei.</p>
          {:else}
            <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
              {#each targets as target (target.fahrer.id)}
                <li>
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left hover:underline"
                    onclick={() =>
                      onanpassungen(withMove(anpassungen, current.id, target.fahrer.id))}
                  >
                    <span class="font-semibold text-brand-900">{target.fahrer.name}</span>
                    <span class="text-sm tabular-nums text-neutral-700"
                      >{freiePlaetze(target)} frei</span
                    >
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="flex flex-wrap gap-2">
        {#if !isDriver && auto}
          <ActionButton onclick={() => onanpassungen(withMove(anpassungen, current.id, null))}
            >Ohne Platz</ActionButton
          >
        {/if}
        {#if !isDriver && seats > 0}
          <ActionButton
            variant="primary"
            onclick={() => onanpassungen(withDriver(anpassungen, current.id, true))}
            >Fahren lassen ({seatsText(seats)})</ActionButton
          >
        {/if}
        {#if isDriver}
          <ActionButton onclick={() => onanpassungen(withDriver(anpassungen, current.id, false))}
            >Fährt nicht</ActionButton
          >
        {/if}
        <ActionButton
          variant="danger"
          onclick={() => onanpassungen(withRemoved(anpassungen, current.id, true))}
          >Nicht einplanen</ActionButton
        >
        <ActionButton onclick={onclose}>Schließen</ActionButton>
      </div>
    </div>
  {/if}
</ModalDialog>
