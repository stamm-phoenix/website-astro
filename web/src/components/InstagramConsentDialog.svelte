<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import {
    rememberInstagramConfirmation,
    type InstagramConsentKind,
    type InstagramConsentRequest,
  } from '../lib/instagramStore.svelte';

  interface Props {
    /** The dialog is shown while set */
    request: InstagramConsentRequest | null;
    onclose: () => void;
  }
  let { request, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let remember = $state(false);

  const TEXTS: Record<InstagramConsentKind, { title: string; text: string; action: string }> = {
    link: {
      title: 'Weiter zu Instagram?',
      text: 'Der Beitrag öffnet sich in einem neuen Tab auf Instagram. Dabei verlässt du unsere Website, und Instagram (Meta Platforms Ireland Ltd.) verarbeitet deine Daten nach seiner eigenen Datenschutzerklärung.',
      action: 'Zu Instagram',
    },
    video: {
      title: 'Video von Instagram laden?',
      text: 'Das Video wird hier auf unserer Seite abgespielt, aber direkt von einem Server von Instagram (Meta Platforms Ireland Ltd.) geladen. Dabei wird deine IP-Adresse an Meta übermittelt.',
      action: 'Video abspielen',
    },
  };

  // Keeps the last texts while the dialog closes
  let kind = $state<InstagramConsentKind>('link');
  $effect(() => {
    if (request) kind = request.kind;
  });
  const texts = $derived(TEXTS[kind]);

  $effect(() => {
    if (!dialog) return;
    if (request && !dialog.open) {
      remember = false;
      dialog.showModal();
    }
    if (!request && dialog.open) dialog.close();
  });

  function followLink(): void {
    if (remember) rememberInstagramConfirmation('link');
    // Closed only after the click, so the link still has its href when the browser follows it
    setTimeout(onclose);
  }

  function playVideo(): void {
    if (request?.kind !== 'video') return;
    if (remember) rememberInstagramConfirmation('video');
    const { onconfirm } = request;
    onclose();
    // Still within the click, so the browser allows the video to start with sound
    onconfirm();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="instagram-consent-heading"
  aria-describedby="instagram-consent-text"
  class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-[var(--radius-md)] border border-neutral-300 bg-surface p-0"
  oncancel={(event) => {
    // Esc: close via our state, so the next request opens the dialog again
    event.preventDefault();
    onclose();
  }}
  onclose={() => {
    if (request) onclose();
  }}
>
  <div class="space-y-4 p-5">
    <h2 id="instagram-consent-heading" class="font-serif text-xl font-semibold text-brand-900">
      {texts.title}
    </h2>
    <p id="instagram-consent-text" class="text-sm text-neutral-700">{texts.text}</p>
    <label class="flex items-center gap-2 text-sm text-neutral-800">
      <input
        type="checkbox"
        bind:checked={remember}
        class="size-4 accent-[var(--color-dpsg-red)]"
      />
      Bei diesem Besuch nicht mehr fragen
    </label>
    <div class="flex flex-wrap justify-end gap-2">
      <ActionButton variant="secondary" type="button" onclick={onclose}>Abbrechen</ActionButton>
      {#if request?.kind === 'link'}
        <a
          href={request.href}
          target="_blank"
          rel="noopener noreferrer"
          class="btn-primary"
          onclick={followLink}
        >
          {texts.action}<span class="sr-only"> (öffnet in neuem Tab)</span>
        </a>
      {:else}
        <ActionButton variant="primary" type="button" onclick={playVideo}
          >{texts.action}</ActionButton
        >
      {/if}
    </div>
  </div>
</dialog>

<style>
  dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 0 0 / 0.4));
  }
</style>
