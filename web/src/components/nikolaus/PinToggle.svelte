<script lang="ts">
  interface Props {
    fixed: boolean;
    title: string;
    label: string;
    onclick: () => void;
    compact?: boolean;
  }
  let { fixed, title, label, onclick, compact = false }: Props = $props();
</script>

<button
  type="button"
  class={compact
    ? 'flex size-10 shrink-0 items-center justify-center text-neutral-500 hover:text-brand-900 aria-[pressed=true]:text-accent-500'
    : 'inline-flex min-h-9 items-center gap-1.5 border-b-2 border-transparent text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-accent-500 aria-[pressed=true]:text-brand-900'}
  aria-pressed={fixed}
  {title}
  {onclick}
>
  <svg
    aria-hidden="true"
    class={compact ? 'size-5' : 'size-4'}
    viewBox="0 0 24 24"
    fill={fixed ? 'currentColor' : 'none'}
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
  </svg>
  {#if compact}<span class="sr-only">{label}</span>{:else}Fixiert<span class="sr-only">
      {label}</span
    >{/if}
</button>
