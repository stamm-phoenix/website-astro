<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { hatExterneBilder, mailDokument, textAlsHtml } from '../../lib/postfachAnsicht';

  /**
   * The body of a mail in a sandboxed frame: no scripts, no forms, no requests; its own CSP
   * blocks images from the internet until the person asks for them. The frame grows with its
   * content, so the page scrolls as one.
   */
  interface Props {
    html: string | null;
    text: string | null;
    betreff: string;
  }
  let { html, text, betreff }: Props = $props();

  let externeBilder = $state(false);
  let frame = $state<HTMLIFrameElement | null>(null);
  let hoehe = $state(120);

  const inhalt = $derived(html ?? textAlsHtml(text ?? ''));
  const mitBildern = $derived(html !== null && hatExterneBilder(html));
  /**
   * Plain text follows the dark theme of the site. HTML mails stay light, as in Outlook: their
   * colours (dark text, coloured tables) assume a white background.
   */
  let seiteDunkel = $state(false);
  const dunkel = $derived(html === null && seiteDunkel);
  const dokument = $derived(mailDokument(inhalt, externeBilder, dunkel));

  function istDunkel(): boolean {
    const choice = document.documentElement.dataset.theme;
    return (
      choice === 'dark' ||
      (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }

  onMount(() => {
    const folgen = (): void => {
      seiteDunkel = istDunkel();
    };
    folgen();
    const beobachter = new MutationObserver(folgen);
    beobachter.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const vorliebe = matchMedia('(prefers-color-scheme: dark)');
    vorliebe.addEventListener('change', folgen);
    return () => {
      beobachter.disconnect();
      vorliebe.removeEventListener('change', folgen);
    };
  });

  function messen(): void {
    // The body, not the root: the root is at least as high as the frame and would only grow
    const body = frame?.contentDocument?.body;
    if (!body) return;
    const next = Math.max(40, Math.ceil(body.getBoundingClientRect().height), body.scrollHeight);
    if (Math.abs(next - hoehe) > 1) hoehe = next;
  }

  let observer: ResizeObserver | null = null;
  let frameRequest = 0;
  // In the next frame, so the new height is not set while the browser still reports sizes
  function spaeterMessen(): void {
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(messen);
  }
  onDestroy(() => {
    observer?.disconnect();
    cancelAnimationFrame(frameRequest);
  });

  function geladen(): void {
    const doc = frame?.contentDocument;
    if (!doc) return;
    // Links open in a new tab without access to this page
    for (const link of doc.querySelectorAll('a[href]')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
    messen();
    // Images arrive later and change the height
    for (const image of doc.images) image.addEventListener('load', spaeterMessen, { once: true });
    // A new document (e.g. after „Bilder anzeigen“) gets a new observer
    observer?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(spaeterMessen);
      observer.observe(doc.body);
    }
  }
</script>

{#if mitBildern && !externeBilder}
  <p class="mb-2 flex flex-wrap items-center gap-x-3 text-sm text-neutral-700">
    <span>Bilder aus dem Internet sind ausgeblendet.</span>
    <button
      type="button"
      class="text-link min-h-11 underline underline-offset-4"
      onclick={() => (externeBilder = true)}>Bilder anzeigen</button
    >
  </p>
{/if}
<!-- Same origin without scripts: the page can measure the height, the mail cannot run code -->
<iframe
  bind:this={frame}
  title="Inhalt der E-Mail „{betreff}“"
  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  srcdoc={dokument}
  onload={geladen}
  class="block w-full rounded border border-neutral-200 p-3 {dunkel ? 'bg-[#1b1f24]' : 'bg-white'}"
  style:height="{hoehe + 24}px"
></iframe>
