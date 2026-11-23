<script lang="ts">
  import {
    MAX_ZEITBLOECKE_PRO_TAG,
    istNachUhrzeit,
    kurzerWochentag,
  } from '../../lib/kurzbeschreibung';
  import type { ZeitplanTag } from '../../lib/kurzbeschreibung';
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import MehrAktionen, { type MehrAktion } from '../ui/MehrAktionen.svelte';

  const ZEILEN_BEISPIEL = '8-9 Uhr Frühstück\n9:30-12 Uhr Geländespiel\n20 Uhr Lagerfeuer';

  /**
   * The buttons under the blocks of one day of the Zeitplan, in the grid of the action blocks:
   * adding blocks (one by one or several lines at once) first, then sorting; copying the day
   * before and removing the day are rarely needed and stand behind „⋯ Mehr“.
   */
  interface Props {
    tag: ZeitplanTag;
    /** The day before, to copy its blocks from. */
    vortag: ZeitplanTag | null;
    /** Number of days of the Zeitplan; the last day stays. */
    tageAnzahl: number;
    /** Text of the open field for several lines; `undefined` while the field is closed. */
    zeilen: string | undefined;
    onzeilen: (text: string) => void;
    onaddblock: () => void;
    ontoggle: () => void;
    onapply: () => void;
    onsort: () => void;
    oncopy: () => void;
    onremove: () => void;
  }
  let {
    tag,
    vortag,
    tageAnzahl,
    zeilen,
    onzeilen,
    onaddblock,
    ontoggle,
    onapply,
    onsort,
    oncopy,
    onremove,
  }: Props = $props();

  const mehr = $derived<MehrAktion[]>([
    ...(vortag && vortag.bloecke.length > 0 && tag.bloecke.length === 0
      ? [{ label: `Ablauf vom ${kurzerWochentag(vortag.datum)} übernehmen`, onclick: oncopy }]
      : []),
    // The last day stays: no days at all would show the days of the Aktion again
    ...(tageAnzahl > 1
      ? [{ label: 'Tag entfernen', onclick: onremove, variant: 'danger' as const }]
      : []),
  ]);
  /** A single entry stands as its own button; a long label needs the full width. */
  const mehrBreit = $derived(mehr.length === 1 && mehr[0].label.length > 16);
</script>

{#if zeilen !== undefined}
  <label class="mt-3 block">
    <span class="form-label">Mehrere Blöcke, einer pro Zeile</span>
    <textarea
      id={`tag-${tag.datum}-zeilen`}
      class="form-input min-h-28 font-mono text-sm"
      rows="5"
      value={zeilen}
      oninput={(e) => onzeilen(e.currentTarget.value)}
      placeholder={ZEILEN_BEISPIEL}></textarea>
  </label>
{/if}

<Aktionsraster class="mt-2">
  {#if zeilen !== undefined}
    <ActionButton variant="primary" disabled={!zeilen.trim()} onclick={onapply}>
      Blöcke übernehmen
    </ActionButton>
    <ActionButton onclick={ontoggle}>Abbrechen</ActionButton>
  {:else}
    <ActionButton
      id={`tag-${tag.datum}-neu`}
      disabled={tag.bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG}
      onclick={onaddblock}
    >
      Block hinzufügen
    </ActionButton>
    <ActionButton onclick={ontoggle}>Zeilen einfügen</ActionButton>
  {/if}
  {#if !istNachUhrzeit(tag.bloecke)}
    <ActionButton onclick={onsort}>Nach Uhrzeit sortieren</ActionButton>
  {/if}
  <MehrAktionen
    aktionen={mehr}
    title="Weitere Aktionen zu diesem Tag"
    class={mehrBreit ? 'col-span-2' : ''}
  />
</Aktionsraster>
