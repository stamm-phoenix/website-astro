<script lang="ts">
  interface Props {
    /** Shown while the photo of the receipt to open is loading. */
    sichtbar: boolean;
  }
  let { sichtbar }: Props = $props();
</script>

<div
  role="status"
  aria-live="polite"
  class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
>
  {#if sichtbar}
    <span
      class="flex items-center gap-3 rounded-full border border-neutral-200 bg-surface px-5 py-3 text-sm font-semibold text-brand-900 shadow-lift"
    >
      <span aria-hidden="true" class="kreis"></span>
      Beleg wird geöffnet …
    </span>
  {/if}
</div>

<style>
  .kreis {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    border: 2px solid var(--color-neutral-300);
    border-top-color: var(--color-action);
    animation: drehen 0.8s linear infinite;
  }
  @keyframes drehen {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .kreis {
      animation-duration: 2.4s;
    }
  }
</style>
