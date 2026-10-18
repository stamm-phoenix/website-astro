<script lang="ts">
  import { NOTICE_CLASS } from '../../lib/status';
  import type { NoticeKind } from '../../lib/status';
  import { tick } from 'svelte';
  import Toast from '../ui/Toast.svelte';
  import MessageText from '../ui/MessageText.svelte';

  interface Props {
    /** Text of the last action's result; nothing is shown while empty. */
    message: string | null;
    /** `warning` for actions that worked only partly, e.g. a mail that could not be sent. */
    kind?: NoticeKind;
    class?: string;
    /** Repeats an action's result in a popup when the notice is scrolled away or behind a dialog. */
    popup?: boolean;
  }

  let { message, kind = 'success', class: className = '', popup = false }: Props = $props();
  let region = $state<HTMLElement | null>(null);
  /** Copy of the message in a popup when the notice itself is out of view. */
  let floating = $state<string | null>(null);

  /** Whether the notice is scrolled away or behind a modal dialog it is not part of. */
  function outOfView(element: HTMLElement): boolean {
    const modal = document.querySelector('dialog:modal');
    if (modal && !modal.contains(element)) return true;
    const rect = element.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    return rect.bottom <= Math.max(header, 0) || rect.top >= window.innerHeight;
  }

  $effect(() => {
    const text = message;
    floating = null;
    if (!text || !popup) return;
    // Lists reload and dialogs close right after an action; check once the page has settled.
    void tick()
      .then(() => new Promise(requestAnimationFrame))
      .then(() => {
        if (message === text && region && outOfView(region)) floating = text;
      });
  });
</script>

<!-- The live region stays in the DOM so screen readers announce every new message -->
<div role="status" aria-live="polite" class={className} bind:this={region}>
  {#if message}
    <p class="border-l-2 py-1 pl-3 text-sm font-semibold {NOTICE_CLASS[kind]}">
      <MessageText text={message} />
    </p>
  {/if}
</div>
<Toast message={floating} {kind} announce={false} onclose={() => (floating = null)} />
