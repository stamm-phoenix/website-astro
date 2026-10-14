<script lang="ts">
  import { onMount } from 'svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatDate } from '../lib/campflowFields';
  import { localDate } from '../lib/dateUtils';
  import { KJR_ABGABE_MONATE, offeneKjrFristen } from '../lib/kjrFristen';

  // Shown below the StaffDashboard in its style. Nothing is shown while loading, on errors (the
  // dashboard already reports them for the Aktionen) or without open deadlines: it is a reminder
  const fristen = $derived(offeneKjrFristen(campflowEventsStore.data ?? [], localDate()));

  function restzeit(tage: number): string {
    if (tage === 0) return 'heute';
    if (tage === 1) return 'morgen';
    return `noch ${tage} Tage`;
  }

  onMount(() => {
    void fetchCampflowEvents();
  });
</script>

{#if fristen.length > 0}
  <section aria-labelledby="kjr-fristen-heading" class="mt-8">
    <h2 id="kjr-fristen-heading" class="text-2xl font-serif font-semibold text-brand-900">
      Zuschussanträge beim KJR
    </h2>
    <p class="mt-2 text-sm text-neutral-700">
      Die Abrechnung einer Aktion muss spätestens {KJR_ABGABE_MONATE} Monate nach ihrem Ende beim KJR
      sein. Offene Fristen der Aktionen, die vorbei sind:
    </p>
    <ul class="mt-3 divide-y divide-neutral-200" data-testid="kjr-fristen">
      {#each fristen as frist (frist.event.id)}
        <li class="py-3">
          <a
            href="/leitendenbereich/abrechnung/{frist.event.id}"
            class="text-link font-semibold break-words">{frist.event.title}</a
          >
          <p class="text-sm text-neutral-700">
            Ende {formatDate(frist.ende)} ·
            <span class={frist.bald ? 'font-semibold text-warning' : ''}>
              Abgabe bis {formatDate(frist.frist)}, {restzeit(frist.tage)}
            </span>
          </p>
        </li>
      {/each}
    </ul>
    <a href="/leitendenbereich/abrechnung" class="text-link text-sm">Zur Abrechnung</a>
  </section>
{/if}
