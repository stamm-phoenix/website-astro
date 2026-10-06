<script lang="ts">
  interface Props {
    label: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
  }
  let { label, tone = 'neutral' }: Props = $props();
</script>

<span class="status-label" data-tone={tone}>{label}</span>

<style>
  .status-label {
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
