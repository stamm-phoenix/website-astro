<script lang="ts">
  interface Props {
    label: string;
    options: readonly { value: string; label: string; count?: number }[];
    value: string;
    onselect: (value: string) => void;
  }
  let { label, options, value, onselect }: Props = $props();
  const id = $props.id();
</script>

<div
  role="group"
  aria-label={label}
  class="flex min-w-0 rounded-md border border-neutral-300 bg-surface p-1"
>
  {#each options as option (option.value)}
    <button
      type="button"
      class="segment min-h-11 min-w-0 flex-1 rounded-sm px-2 sm:px-3 text-sm font-semibold whitespace-nowrap"
      aria-pressed={value === option.value}
      aria-describedby={option.count === undefined ? undefined : `${id}-${option.value}`}
      onclick={() => onselect(option.value)}
      >{option.label}{#if option.count !== undefined}<span
          aria-hidden="true"
          class="ml-1 tabular-nums">({option.count})</span
        >{/if}</button
    >
    {#if option.count !== undefined}<span class="sr-only" id="{id}-{option.value}"
        >{option.count} {option.count === 1 ? 'Aufgabe' : 'Aufgaben'}</span
      >{/if}
  {/each}
</div>

<style>
  .segment {
    color: var(--color-neutral-700);
  }
  .segment[aria-pressed='true'] {
    background: var(--color-neutral-100);
    color: var(--color-brand-900);
    box-shadow: inset 0 0 0 1px var(--color-brand-900);
  }
  @media (hover: hover) {
    .segment:not([aria-pressed='true']):hover {
      background: var(--color-neutral-100);
    }
  }
</style>
