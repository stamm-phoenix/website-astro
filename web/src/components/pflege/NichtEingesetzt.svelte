<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { rescuedLabel, type GeretteterWert } from '../../lib/geretteteEingaben';
  import { sanitizeFaqAnswer } from '../../lib/api';
  import { parseHtml } from '../../lib/html';

  /**
   * Input from before a new login in the iPhone app that the dialog could not fill in itself,
   * e.g. a row the form does not have yet; shown inside the dialog, so it can be copied over.
   */
  interface Props {
    values: GeretteterWert[];
    conflict?: boolean;
    canApply?: (kept: GeretteterWert) => boolean;
    onapply?: (kept: GeretteterWert) => boolean;
  }
  let { values, conflict = false, canApply = () => false, onapply }: Props = $props();

  let copied = $state<number | null>(null);
  let failed = $state<number | null>(null);
  let applyFailed = $state<string | null>(null);

  /** Only explicitly marked editor HTML is interpreted; ordinary fields stay plain text. */
  function editorHtml(kept: GeretteterWert): string | null {
    return kept.kind === 'editor' && kept.format === 'html' ? sanitizeFaqAnswer(kept.value) : null;
  }

  async function copy(index: number, kept: GeretteterWert): Promise<void> {
    try {
      const html = editorHtml(kept);
      if (html !== null) {
        const doc = parseHtml(html);
        for (const br of doc.querySelectorAll('br')) br.replaceWith(doc.createTextNode('\n'));
        for (const block of doc.querySelectorAll('p, div, li')) block.append('\n');
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([doc.body.textContent?.trim() ?? ''], { type: 'text/plain' }),
          }),
        ]);
      } else await navigator.clipboard.writeText(kept.display ?? kept.value);
      copied = index;
      failed = null;
    } catch {
      failed = index;
      copied = null;
    }
  }
</script>

<section aria-labelledby="nicht-eingesetzt" class="surface-muted mb-3 space-y-2 p-3 text-sm">
  <h3 id="nicht-eingesetzt" class="font-semibold text-neutral-800">Noch nicht eingesetzt</h3>
  <p class="text-neutral-700">
    {#if conflict}
      Diese Eingaben wurden nicht eingesetzt, damit die inzwischen gespeicherten Änderungen erhalten
      bleiben. Vergleiche sie mit der aktuellen Fassung. Texte kannst du kopieren, Auswahlen gezielt
      mit „Übernehmen“ einsetzen. Die Übernahme ändert zunächst nur dieses Formular.
    {:else}
      Für diese Eingaben fehlt im Formular noch das Feld, zum Beispiel eine weitere Zeile. Leg es
      an, dann setzt das Formular den Wert selbst ein. Sie bleiben gesichert, bis alles eingesetzt
      ist.
    {/if}
  </p>
  <ul class="space-y-2">
    {#each values as kept, index (kept.key)}
      <li class="border-t border-neutral-200 pt-2">
        <p class="font-semibold text-neutral-800">{rescuedLabel(kept)}</p>
        {#if kept.kind === 'checked'}
          <p class="text-neutral-800">{kept.value === 'true' ? 'angehakt' : 'nicht angehakt'}</p>
        {:else}
          {@const html = editorHtml(kept)}
          {#if html}
            <div class="prose prose-sm max-w-none break-words text-neutral-800">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- editorHtml sanitizes via sanitizeFaqAnswer -->
              {@html html}
            </div>
          {:else}
            <p class="whitespace-pre-wrap break-words text-neutral-800">
              {html === '' || (kept.display ?? kept.value) === ''
                ? 'Leer'
                : (kept.display ?? kept.value)}
            </p>
          {/if}
          <div class="mt-1 flex flex-wrap items-center gap-2">
            {#if kept.kind === 'custom'}
              {#if canApply(kept)}
                <ActionButton
                  onclick={() => {
                    applyFailed = onapply?.(kept) ? null : kept.key;
                  }}>{rescuedLabel(kept)} übernehmen</ActionButton
                >
              {:else}
                <p class="text-neutral-700">
                  Vergleiche diese Angabe mit dem Formular und passe sie dort an.
                </p>
              {/if}
              {#if applyFailed === kept.key}<span role="status" class="text-danger"
                  >Die Auswahl konnte nicht übernommen werden. Wähle sie im Formular selbst aus.</span
                >{/if}
            {:else}
              <ActionButton onclick={() => copy(index, kept)}>
                {rescuedLabel(kept)} kopieren
              </ActionButton>
            {/if}
            <span role="status">
              {#if copied === index}<span class="text-success">Kopiert.</span>
              {:else if failed === index}<span class="text-danger"
                  >Kopieren ging nicht, bitte von Hand abschreiben.</span
                >{/if}
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>
