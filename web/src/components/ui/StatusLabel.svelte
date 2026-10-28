<script lang="ts">
  import type { StatusTone } from '../../lib/status';
  interface Props {
    label: string;
    tone?: StatusTone;
    dot?: boolean;
  }
  let { label, tone = 'neutral', dot = false }: Props = $props();
</script>

<span class="status-label" data-tone={tone}>
  {#if dot}<span class="status-dot" aria-hidden="true"></span>{/if}
  {label}
</span>

<style>
  .status-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 50%;
    background: currentColor;
  }
  .status-label {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-neutral-700);
  }
  [data-tone='success'] {
    color: var(--color-success);
  }
  [data-tone='warning'] {
    color: var(--color-warning);
  }
  [data-tone='danger'] {
    color: var(--color-danger);
  }
</style>
