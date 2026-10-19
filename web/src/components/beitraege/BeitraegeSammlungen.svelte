<script lang="ts">
  import { formatEuro } from '../../lib/format';
  import { isErledigt, sammlungStand, sammlungZahlen } from '../../lib/beitraege';
  import type { Beitrag, BeitragSammlung } from '../../lib/types';

  interface Props {
    batches: BeitragSammlung[];
    /** All Beiträge, to count the paid and cancelled ones per Sammlung. */
    fees: Beitrag[];
    /** Opens a Sammlung by its ID, or all Beiträge with `alle`. */
    onopen: (view: string) => void;
  }
  let { batches, fees, onopen }: Props = $props();

  const zahlen = $derived(
    new Map(
      batches.map((batch) => [
        batch.id,
        sammlungZahlen(fees.filter((fee) => fee.batchId === batch.id)),
      ])
    )
  );

  let search = $state('');
  let hideDone = $state(false);

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return batches
      .filter((batch) => !hideDone || !isErledigt(batch))
      .filter((batch) => !query || batch.name.toLowerCase().includes(query));
  });

  /** Follows the link without reloading the page; a new tab still gets the real link. */
  function follow(event: MouseEvent, view: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onopen(view);
  }
</script>

<section aria-labelledby="beitraege-sammlungen" class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <h2 id="beitraege-sammlungen" class="font-serif text-xl text-brand-900">
      Sammlungen ({batches.length})
    </h2>
    <a href="?ansicht=alle" class="btn-secondary" onclick={(event) => follow(event, 'alle')}
      >Alle Beiträge einzeln ansehen</a
    >
  </div>
  <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
    <label class="block w-full text-sm sm:w-72">
      <span class="font-semibold text-neutral-700">Suche</span>
      <input
        type="search"
        bind:value={search}
        placeholder="Name der Aktion"
        class="form-input mt-1 w-full"
      />
    </label>
    <label class="flex min-h-11 items-center gap-3 text-sm text-neutral-700">
      <input type="checkbox" bind:checked={hideDone} class="size-5" />
      Erledigte ausblenden
    </label>
  </div>

  {#if visible.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">
      {search.trim()
        ? 'Keine Sammlung passt zur Suche.'
        : hideDone
          ? 'Bei allen Sammlungen ist alles bezahlt.'
          : 'In CampFlow gibt es noch keine Beiträge.'}
    </p>
  {:else}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Sammlungen">
      {#each visible as batch (batch.id)}
        {@const stand = zahlen.get(batch.id) ?? { paid: 0, cancelled: 0, due: 0 }}
        <li>
          <a
            href={`?sammlung=${encodeURIComponent(batch.id)}`}
            class="group flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6"
            onclick={(event) => follow(event, batch.id)}
          >
            <span class="min-w-0 sm:w-1/2">
              <span class="block font-semibold text-link underline-offset-4 group-hover:underline"
                >{batch.name}</span
              >
              <span class="mt-1 block text-sm text-neutral-700">
                {batch.feeCount}
                {batch.feeCount === 1 ? 'Beitrag' : 'Beiträge'} · {formatEuro(batch.totalCent)}
              </span>
            </span>
            <span class="block min-w-0 flex-1">
              <progress
                class="beitrag-progress h-2 w-full"
                class:done={stand.paid >= stand.due}
                max={stand.due || 1}
                value={stand.due === 0 ? 1 : stand.paid}
                aria-hidden="true"
              ></progress>
              <span
                class="mt-1 block text-sm {isErledigt(batch) ? 'text-success' : 'text-neutral-700'}"
                >{sammlungStand(batch, stand)}</span
              >
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .beitrag-progress {
    display: block;
    appearance: none;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--color-neutral-200);
  }
  .beitrag-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .beitrag-progress::-webkit-progress-value {
    background: var(--color-brand-900);
  }
  .beitrag-progress::-moz-progress-bar {
    background: var(--color-brand-900);
  }
  .beitrag-progress.done::-webkit-progress-value {
    background: var(--color-success);
  }
  .beitrag-progress.done::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
