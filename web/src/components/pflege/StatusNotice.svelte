<script lang="ts">
  interface Props {
    /** Text of the last action's result; nothing is shown while empty. */
    message: string | null;
    /** `warning` for actions that worked only partly, e.g. a mail that could not be sent. */
    kind?: 'success' | 'warning' | 'error';
    class?: string;
  }

  const KIND_CLASS = {
    success: 'border-success text-success',
    warning: 'border-warning text-warning',
    error: 'border-danger text-danger',
  };

  let { message, kind = 'success', class: className = '' }: Props = $props();
</script>

<!-- The live region stays in the DOM so screen readers announce every new message -->
<div role="status" aria-live="polite" class={className}>
  {#if message}
    <p class="border-l-2 py-1 pl-3 text-sm font-semibold {KIND_CLASS[kind]}">
      {message}
    </p>
  {/if}
</div>
