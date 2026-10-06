<script lang="ts" generics="T extends string">
  interface Option {
    value: T;
    label: string;
    count?: number;
  }
  interface Props {
    label: string;
    options: readonly Option[];
    value: T;
    onselect: (value: T) => void;
    class?: string;
  }
  let { label, options, value, onselect, class: className = '' }: Props = $props();
</script>

<div role="group" aria-label={label} class={`flex flex-wrap gap-x-5 gap-y-1 ${className}`}>
  {#each options as option (option.value)}
    <button
      type="button"
      class="filter-tab"
      aria-pressed={value === option.value}
      onclick={() => onselect(option.value)}
    >
      {option.label}{#if option.count !== undefined}<span class="ml-1 tabular-nums"
          >({option.count})</span
        >{/if}
    </button>
  {/each}
</div>

<style>
  .filter-tab {
    min-height: 2.75rem;
    padding-block: 0.5rem;
    color: var(--color-neutral-700);
    font-size: 0.875rem;
    text-decoration: underline 2px transparent;
    text-underline-offset: 0.4em;
  }
  .filter-tab[aria-pressed='true'] {
    font-weight: 600;
    color: var(--color-brand-900);
    text-decoration-color: var(--color-accent-500);
  }
  @media (hover: hover) {
    .filter-tab:not([aria-pressed='true']):hover {
      color: var(--color-brand-900);
      text-decoration-color: var(--color-neutral-300);
    }
  }
</style>
