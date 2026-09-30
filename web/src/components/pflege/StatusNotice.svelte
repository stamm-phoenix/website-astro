<script lang="ts">
  interface Props {
    /** Text of the last action's result; nothing is shown while empty. */
    message: string | null;
    /** `warning` for actions that worked only partly, e.g. a mail that could not be sent. */
    kind?: 'success' | 'warning' | 'error';
    class?: string;
  }

  const KIND_CLASS = {
    success:
      'border-[var(--color-dpsg-pfadfinder)]/30 bg-[var(--color-dpsg-pfadfinder)]/5 text-[var(--color-dpsg-pfadfinder)]',
    warning: 'border-[#8a4a00]/30 bg-[#fff1e0] text-[#8a4a00]',
    error:
      'border-[var(--color-dpsg-red)]/30 bg-[var(--color-dpsg-red)]/5 text-[var(--color-dpsg-red)]',
  };

  let { message, kind = 'success', class: className = '' }: Props = $props();
</script>

<!-- The live region stays in the DOM so screen readers announce every new message -->
<div role="status" aria-live="polite" class={className}>
  {#if message}
    <p class="rounded-md border px-4 py-3 text-sm {KIND_CLASS[kind]}">
      {message}
    </p>
  {/if}
</div>
