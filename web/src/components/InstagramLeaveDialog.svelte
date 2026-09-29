<script lang="ts">
  import { rememberInstagramConfirmation } from '../lib/instagramStore.svelte';

  interface Props {
    /** Post to open; the dialog is shown while set */
    href: string | null;
    onclose: () => void;
  }
  let { href, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let remember = $state(false);

  $effect(() => {
    if (!dialog) return;
    if (href && !dialog.open) dialog.showModal();
    if (!href && dialog.open) dialog.close();
  });

  function proceed(): void {
    if (remember) rememberInstagramConfirmation();
    // Closed only after the click, so the link still has its href when the browser follows it
    setTimeout(onclose);
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="instagram-leave-heading"
  aria-describedby="instagram-leave-text"
  class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-white p-0 shadow-lift"
  onclose={() => {
    if (href) onclose();
  }}
>
  <div class="space-y-4 p-5">
    <h2 id="instagram-leave-heading" class="font-serif text-xl font-semibold text-brand-900">
      Weiter zu Instagram?
    </h2>
    <p id="instagram-leave-text" class="text-sm text-neutral-700">
      Der Beitrag öffnet sich in einem neuen Tab auf Instagram. Dabei verlässt du unsere Website,
      und Instagram (Meta Platforms Ireland Ltd.) verarbeitet deine Daten nach seiner eigenen
      Datenschutzerklärung.
    </p>
    <label class="flex items-center gap-2 text-sm text-neutral-800">
      <input
        type="checkbox"
        bind:checked={remember}
        class="size-4 accent-[var(--color-dpsg-red)]"
      />
      Bei diesem Besuch nicht mehr fragen
    </label>
    <div class="flex flex-wrap justify-end gap-2">
      <button type="button" class="btn-secondary" onclick={onclose}>Abbrechen</button>
      <a {href} target="_blank" rel="noopener noreferrer" class="btn-primary" onclick={proceed}>
        Zu Instagram<span class="sr-only"> (öffnet in neuem Tab)</span>
      </a>
    </div>
  </div>
</dialog>

<style>
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
</style>
