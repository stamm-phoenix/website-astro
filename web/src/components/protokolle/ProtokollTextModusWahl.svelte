<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import type { TextModus } from '../../lib/protokollEditor';

  /**
   * „Texte schreiben als“ above the agenda (#320, #613) with the Markdown syntax behind the (i).
   * Not in the sticky bar: on phones every row there hides content.
   */
  interface Props {
    value: TextModus;
    onselect: (value: TextModus) => void;
  }
  let { value, onselect }: Props = $props();
</script>

<div class="flex min-w-0 max-w-full items-end gap-1">
  <FilterTabs
    variant="segmented"
    class="min-w-0"
    label="Texte schreiben als"
    showLabel
    options={[
      { value: 'formatiert', label: 'Formatiert' },
      { value: 'markdown', label: 'Markdown je Punkt' },
      { value: 'markdown-dokument', label: 'Ein Markdown-Text' },
    ]}
    {value}
    {onselect}
  />
  <InfoHint label="Markdown" class="markdown-hilfe">
    <p>
      <code>**fett**</code>, <code>*kursiv*</code>, <code>~~durchgestrichen~~</code>
    </p>
    <p>
      <code>- Punkt</code> oder <code>1. Punkt</code>, eingerückt verschachtelt;
      <code>- [ ] offen</code>, <code>- [x] erledigt</code>
    </p>
    <p><code>[Text](https://…)</code>, Adressen werden von selbst zu Links</p>
    <p>
      {#if value === 'markdown-dokument'}
        <code>#### Zwischenüberschrift</code>,
      {:else}
        <code>## Zwischenüberschrift</code>,
      {/if}
      <code>&gt; Zitat</code>, <code>---</code> Linie
    </p>
    <p><code>| A | B |</code> mit <code>|---|---|</code> darunter für Tabellen</p>
    <p><code>`Code`</code>, drei <code>```</code> für einen Codeblock</p>
    {#if value === 'markdown-dokument'}
      <p class="font-semibold">Im Markdown-Text, jeweils am Zeilenanfang:</p>
      <p><code># Titel</code> neuer Punkt, <code>## Titel</code> Unterpunkt</p>
      <p><code>Zeitraum: 12.07.2026 – 19.07.2026</code></p>
      <p><code>Aufgabe: Zelte prüfen; zuständig: Lea, Tom; bis: 20.11.2026</code></p>
      <p>
        <code>Termin: Arbeitseinsatz; am: 22.11.2026; um: 10:00; in: Pfarrheim; zuständig: Lea</code
        >
      </p>
      <p>
        Mit <code>@</code> wählst du Namen aus. Aktion, Projekt und offene Aufgaben des Punkts, in dem
        du schreibst, stehen unter dem Text.
      </p>
    {/if}
  </InfoHint>
</div>

<style>
  :global(.markdown-hilfe code) {
    font-size: 0.8125rem;
    background: var(--color-neutral-100);
    padding: 0 0.2rem;
    border-radius: var(--radius-sm);
  }
</style>
