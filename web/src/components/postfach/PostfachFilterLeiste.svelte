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
   * The filters of a mailbox in two groups, the state and who is responsible, plus „Ungelesen“
   * as a switch. They combine; each count says what that choice would show with the others kept.
   */
  interface Props {
    filter: PostfachFilter;
    anzahl: FilterAnzahl;
    /** Left of „Ungelesen“, e.g. choosing all shown conversations. */
    vorne?: Snippet;
  }
  let { filter = $bindable(), anzahl, vorne }: Props = $props();

  const NOMEN = ['E-Mail', 'E-Mails'] as const;
</script>

<div class="space-y-2 border-b border-neutral-200 p-2">
  <div class="space-y-2">
    <div>
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
          tone: option.value === 'erledigt' ? ('success' as const) : undefined,
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
  <div class="flex min-h-11 items-center justify-between gap-2">
    <div class="min-w-0">{@render vorne?.()}</div>
    <button
      type="button"
      class="ungelesen"
      aria-pressed={filter.ungelesen}
      onclick={() => (filter = { ...filter, ungelesen: !filter.ungelesen })}
    >
      <span class="punkt" aria-hidden="true"></span>Ungelesen<span class="anzahl" aria-hidden="true"
        >{anzahl.ungelesen}</span
      ><span class="sr-only"
        >, {anzahl.ungelesen} {anzahl.ungelesen === 1 ? NOMEN[0] : NOMEN[1]}</span
      >
    </button>
  </div>
</div>

<style>
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
  .ungelesen {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.75rem;
    padding: 0 0.875rem;
    border: 1px solid var(--color-neutral-300);
    border-radius: 9999px;
    background: var(--color-surface);
    color: var(--color-neutral-700);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .ungelesen[aria-pressed='true'] {
    border-color: var(--color-brand-900);
    background: var(--color-neutral-100);
    color: var(--color-brand-900);
    box-shadow: inset 0 0 0 1px var(--color-brand-900);
  }
  .punkt {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: var(--color-dpsg-red);
  }
  .anzahl {
    min-width: 1.5rem;
    padding: 0 0.375rem;
    border-radius: 9999px;
    background: var(--color-neutral-100);
    font-size: 0.75rem;
    line-height: 1.25rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .ungelesen[aria-pressed='true'] .anzahl {
    background: var(--color-brand-900);
    color: var(--color-surface);
  }
  @media (forced-colors: active) {
    .ungelesen[aria-pressed='true'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
