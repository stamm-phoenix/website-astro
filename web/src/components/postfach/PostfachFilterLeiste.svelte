<script lang="ts">
  import type { Snippet } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import {
    STAND_FILTER,
    ZUSTAENDIG_FILTER,
    type FilterAnzahl,
    type PostfachFilter,
  } from '../../lib/postfachAnsicht';

  /**
   * The filters of a mailbox in two groups, the status and who is responsible. They combine;
   * each count says what that choice would show with the other kept.
   */
  interface Props {
    filter: PostfachFilter;
    anzahl: FilterAnzahl;
    /** Below the filters, e.g. choosing all shown conversations. */
    vorne?: Snippet;
  }
  let { filter = $bindable(), anzahl, vorne }: Props = $props();

  const NOMEN = ['E-Mail', 'E-Mails'] as const;
  const TON = { neu: undefined, handlungsbedarf: 'warning', erledigt: 'success' } as const;
</script>

<div class="space-y-2 border-b border-neutral-200 p-2">
  <div class="space-y-2">
    <div class="stand">
      <span class="gruppe" aria-hidden="true">Stand</span>
      <FilterTabs
        label="Stand"
        variant="segmented"
        fill
        countStyle="badge"
        countNouns={NOMEN}
        options={STAND_FILTER.map((option) => ({
          ...option,
          count: anzahl.stand[option.value],
          tone: option.value === 'alle' ? undefined : TON[option.value],
        }))}
        value={filter.stand}
        onselect={(stand) => (filter = { ...filter, stand })}
      />
    </div>
    <div>
      <span class="gruppe" aria-hidden="true">Zuständig</span>
      <FilterTabs
        label="Zuständig"
        variant="segmented"
        fill
        countStyle="badge"
        countNouns={NOMEN}
        options={ZUSTAENDIG_FILTER.map((option) => ({
          ...option,
          count: anzahl.zustaendig[option.value],
        }))}
        value={filter.zustaendig}
        onselect={(zustaendig) => (filter = { ...filter, zustaendig })}
      />
    </div>
  </div>
  {#if vorne}
    <div class="flex min-h-11 items-center">{@render vorne()}</div>
  {/if}
</div>

<style>
  /* Four statuses do not fit one row of a phone or of the list column: two rows of two */
  .stand {
    container-type: inline-size;
  }
  .stand :global(.segments-fill) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @container (min-width: 34rem) {
    .stand :global(.segments-fill) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  /* Above its group, so the segments get the whole width of the list */
  .gruppe {
    display: block;
    margin: 0 0 0.25rem 0.125rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-neutral-700);
  }
</style>
