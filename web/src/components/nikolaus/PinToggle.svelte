<script lang="ts">
  interface Props {
    fixed: boolean;
    title: string;
    label: string;
    onclick: () => void;
    compact?: boolean;
  }
  let { fixed, title, label, onclick, compact = false }: Props = $props();
  const stateLabel = $derived(
    `${compact ? 'Posten' : 'Team'} ${fixed ? 'festgehalten' : 'festhalten'}`
  );
</script>

<button
  type="button"
  class={compact
    ? 'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-sm border border-neutral-300 px-2 text-xs font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-accent-500 aria-[pressed=true]:bg-accent-500/10 aria-[pressed=true]:text-brand-900'
    : 'inline-flex min-h-11 items-center gap-2 rounded-sm border border-neutral-300 px-3 text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-accent-500 aria-[pressed=true]:bg-accent-500/10 aria-[pressed=true]:text-brand-900'}
  aria-pressed={fixed}
  aria-label={`${stateLabel} ${label}`}
  title={`${stateLabel}. ${title}`}
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
  {stateLabel}
</button>
