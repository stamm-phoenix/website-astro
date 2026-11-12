<script lang="ts">
  /**
   * A setting that is on or off, as a switch with its label and its state in words („An“,
   * „Aus“), so it is not read as an action among the buttons.
   */
  interface Props {
    label: string;
    checked: boolean;
    disabled?: boolean;
  }
  let { label, checked = $bindable(), disabled = false }: Props = $props();
</script>

<label class="inline-flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
  <span class="font-semibold text-brand-900">{label}</span>
  <input type="checkbox" class="schalter shrink-0" role="switch" bind:checked {disabled} />
  <span class="text-neutral-800" aria-hidden="true">{checked ? 'An' : 'Aus'}</span>
</label>

<style>
  .schalter {
    appearance: none;
    position: relative;
    width: 2.75rem;
    height: 1.5rem;
    border: 2px solid var(--color-brand-900);
    border-radius: 999px;
    background: var(--color-surface);
    cursor: pointer;
  }
  .schalter::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-brand-900);
    transition: transform var(--motion-quick) ease-out;
  }
  .schalter:checked {
    background: var(--color-action);
    border-color: var(--color-action);
  }
  .schalter:checked::before {
    transform: translateX(20px);
    background: var(--color-on-action);
  }
  .schalter:focus-visible {
    outline: 2px solid var(--color-link);
    outline-offset: 2px;
  }
  .schalter:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
