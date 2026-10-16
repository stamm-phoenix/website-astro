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
    /** Shows the label in front of the options, e.g. when two rows sit together. */
    showLabel?: boolean;
    disabled?: boolean;
  }
  let {
    label,
    options,
    value,
    onselect,
    class: className = '',
    variant = 'tabs',
    countNouns = ['Eintrag', 'Einträge'],
    showLabel = false,
    disabled = false,
  }: Props = $props();
  const id = $props.id();
</script>

{#snippet group(groupClass: string)}
  <div
    role="group"
    aria-label={showLabel ? undefined : label}
    aria-labelledby={showLabel ? `${id}-label` : undefined}
    class={`${variant === 'segmented' ? 'segments' : 'flex flex-wrap gap-x-5 gap-y-1'} ${groupClass}`}
  >
    {#each options as option (option.value)}
      <button
        type="button"
        class="filter-tab"
        aria-pressed={value === option.value}
        aria-describedby={option.count === undefined ? undefined : `${id}-${option.value}`}
        {disabled}
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
{/snippet}

{#if showLabel}
  <div class={`flex flex-wrap items-center gap-x-3 ${className}`}>
    <span class="text-sm font-semibold text-neutral-700"
      ><span id="{id}-label">{label}</span><span aria-hidden="true">:</span></span
    >
    {@render group('')}
  </div>
{:else}
  {@render group(className)}
{/if}

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
    font-weight: 600;
    box-shadow: none;
  }
  .segments .filter-tab[aria-pressed='true'] {
    background: var(--color-neutral-100);
    box-shadow: inset 0 0 0 1px var(--color-brand-900);
  }

  /* The underline is drawn under the whole button, so the count is included. */
  .filter-tab {
    min-width: 2.75rem;
    min-height: 2.75rem;
    text-align: center;
    padding-block: 0.5rem;
    color: var(--color-neutral-700);
    font-size: 0.875rem;
    white-space: nowrap;
    box-shadow: inset 0 -2px 0 transparent;
  }
  .filter-tab[aria-pressed='true'] {
    font-weight: 600;
    color: var(--color-brand-900);
    box-shadow: inset 0 -2px 0 var(--color-accent-500);
  }
  /* Contrast mode drops shadows and backgrounds, so mark the choice with an outline. */
  @media (forced-colors: active) {
    .filter-tab[aria-pressed='true'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
  .filter-tab:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (hover: hover) {
    .filter-tab:not([aria-pressed='true'], :disabled):hover {
      color: var(--color-brand-900);
      box-shadow: inset 0 -2px 0 var(--color-neutral-300);
    }
    .segments .filter-tab:not([aria-pressed='true'], :disabled):hover {
      box-shadow: none;
    }
  }
</style>
