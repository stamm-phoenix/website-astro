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
    variant?: 'tabs' | 'segmented';
    countNouns?: readonly [string, string];
  }
  let {
    label,
    options,
    value,
    onselect,
    class: className = '',
    variant = 'tabs',
    countNouns = ['Eintrag', 'Einträge'],
  }: Props = $props();
  const id = $props.id();
</script>

<div
  role="group"
  aria-label={label}
  class={`${variant === 'segmented' ? 'segments' : 'flex flex-wrap gap-x-5 gap-y-1'} ${className}`}
>
  {#each options as option (option.value)}
    <button
      type="button"
      class="filter-tab"
      aria-pressed={value === option.value}
      aria-describedby={option.count === undefined ? undefined : `${id}-${option.value}`}
      onclick={() => onselect(option.value)}
    >
      {option.label}{#if option.count !== undefined}<span
          aria-hidden="true"
          class="ml-1 tabular-nums">({option.count})</span
        >{/if}
    </button>
    {#if option.count !== undefined}<span class="sr-only" id="{id}-{option.value}"
        >{option.count} {option.count === 1 ? countNouns[0] : countNouns[1]}</span
      >{/if}
  {/each}
</div>

<style>
  .segments {
    display: flex;
    flex-shrink: 0;
    width: max-content;
    max-width: 100%;
    flex-wrap: wrap;
    gap: 0;
    border: 1px solid var(--color-neutral-300);
    border-radius: 0.375rem;
    background: var(--color-surface);
    padding: 0.25rem;
  }
  .segments .filter-tab {
    min-height: 44px;
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.25rem;
    white-space: nowrap;
    font-weight: 600;
    text-decoration: none;
  }
  .segments .filter-tab[aria-pressed='true'] {
    background: var(--color-neutral-100);
    box-shadow: inset 0 0 0 1px var(--color-brand-900);
  }

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
