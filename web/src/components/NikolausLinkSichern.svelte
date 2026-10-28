<script lang="ts">
  import { onDestroy } from 'svelte';
  import ActionButton from './ui/ActionButton.svelte';

  interface Props {
    /** Management token of the booking. */
    token: string;
  }

  let { token }: Props = $props();

  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let bookmarkHint = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The token may only come from the session storage, so the link is built explicitly
  function bookingUrl(): string {
    return `${window.location.origin}${window.location.pathname}#${new URLSearchParams({ token })}`;
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(bookingUrl());
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (copyState = 'idle'), 2500);
  }

  /** Browsers no longer let pages add bookmarks, so the button explains how to do it. */
  function bookmark(): void {
    // The bookmark takes the address bar, which must carry the token
    const url = bookingUrl();
    if (window.location.href !== url) window.history.replaceState(window.history.state, '', url);
    if (window.matchMedia('(pointer: coarse)').matches) {
      bookmarkHint =
        'Öffnen Sie das Menü Ihres Browsers (⋮ oder das Teilen-Symbol) und wählen Sie „Lesezeichen hinzufügen“.';
    } else {
      const keys = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ + D' : 'Strg + D';
      bookmarkHint = `Drücken Sie jetzt ${keys}, um diese Seite als Lesezeichen zu speichern.`;
    }
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="mt-3 flex flex-wrap items-center gap-2">
  <ActionButton onclick={() => void copy()}>Link kopieren</ActionButton>
  <ActionButton onclick={bookmark}>Als Lesezeichen speichern</ActionButton>
</div>
<p role="status" class="mt-2 text-sm empty:hidden">
  {#if copyState === 'copied'}<span class="text-success">Der Link ist in der Zwischenablage.</span
    >{:else if copyState === 'failed'}<span class="text-danger"
      >Kopieren ging nicht. Kopieren Sie den Link bitte aus der Adresszeile.</span
    >{:else if bookmarkHint}{bookmarkHint}{/if}
</p>
