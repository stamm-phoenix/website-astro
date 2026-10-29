<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import { postenMenge } from '../../lib/essensplanungEinkauf';
  import type { EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanKontext } from './planKontext';

  /**
   * One thing in the live mode of a shopping trip: a tap opens the amount (the planned one unless
   * changed) and a replacement, „Abhaken“ saves it. Ticked off things can be changed or taken back.
   */

  interface Props {
    kontext: PlanKontext;
    einkaufId: number;
    posten: EinkaufListenPosten;
    /** Whether this thing's amount is open; only one at a time. */
    offen: boolean;
    onoeffnen: (offen: boolean) => void;
  }
  let { kontext, einkaufId, posten, offen, onoeffnen }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  const einheiten = $derived.by((): readonly GerichtEinheit[] => {
    const art = ansicht.zutaten.find((z) => z.id === posten.planungZutatId)?.einheitenart;
    return art ? EINHEITEN_JE_ART[art] : [];
  });

  let menge = $state('');
  let einheit = $state<GerichtEinheit>('g');
  let ersatz = $state('');
  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  /** The version of what was ticked off when the amount was opened; null for none. */
  let etag: string | null = null;

  function oeffnen(): void {
    if (offen) {
      onoeffnen(false);
      return;
    }
    const h = posten.haken;
    menge = h ? (h.erhalten > 0 ? mengeFeld(h.erhalten) : '') : mengeFeld(posten.menge);
    einheit = h?.einheit ?? posten.einheit ?? einheiten[0] ?? 'stueck';
    ersatz = h?.ersatz ?? '';
    etag = h?.etag ?? null;
    fehler = null;
    onoeffnen(true);
  }

  async function abhaken(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert) return;
    const zahl = menge.trim() ? leseMenge(menge) : 0;
    if (zahl === null || Number.isNaN(zahl) || zahl < 0) {
      fehler = 'Bitte eine Menge wie 2,5 eintragen oder das Feld leer lassen.';
      return;
    }
    speichert = true;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/einkaeufe/${einkaufId}/posten`, {
          etag,
          planungZutatId: posten.planungZutatId,
          einheit,
          erhalten: zahl,
          ersatz,
        }),
      `${posten.name} abgehakt.`
    );
    speichert = false;
    if (ok) onoeffnen(false);
    else fehler = kontext.fehler;
  }

  async function aufheben(): Promise<void> {
    const h = posten.haken;
    if (!h) return;
    const ok = await kontext.aendern(
      () => kontext.api.senden('DELETE', `/einkauf-posten/${h.id}`, undefined, h.etag),
      `${posten.name} ist wieder offen.`
    );
    if (ok) onoeffnen(false);
  }

  /** „3 l → Pepsi Cola“. */
  const erhalten = $derived.by(() => {
    const h = posten.haken;
    if (!h) return '';
    const text = h.erhalten > 0 ? kochMenge(h.erhalten, h.einheit, posten.abtropfgewicht) : '';
    return [text, h.ersatz ? `→ ${h.ersatz}` : ''].filter(Boolean).join(' ');
  });
</script>

<li class="py-1">
  <button
    type="button"
    class="flex min-h-14 w-full items-center gap-3 rounded px-2 text-left text-lg"
    aria-expanded={offen}
    aria-label="{posten.name}{posten.haken ? ' (abgehakt)' : ''}"
    onclick={oeffnen}
  >
    <span
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded border-2 {posten.haken
        ? 'border-success bg-success-soft text-success'
        : 'border-neutral-500'}"
      aria-hidden="true">{posten.haken ? '✓' : ''}</span
    >
    <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">
      {#if posten.haken}
        <span class="text-neutral-700 line-through">{postenMenge(posten)} {posten.name}</span>
        {#if erhalten}<span class="block font-semibold">{erhalten}</span>{/if}
        {#if posten.haken.von}<span class="block text-sm text-neutral-700"
            >von {posten.haken.von}</span
          >{/if}
      {:else}
        <span class="font-semibold tabular-nums">{postenMenge(posten)}</span>
        {posten.name}
      {/if}
    </span>
  </button>
  {#if offen}
    <form class="space-y-2 px-2 pb-3" onsubmit={abhaken} aria-label="{posten.name} abhaken">
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="form-input w-28 text-lg tabular-nums"
          inputmode="decimal"
          autocomplete="off"
          aria-label="Erhaltene Menge von {posten.name}"
          bind:value={menge}
        />
        {#if einheiten.length > 1}
          <select
            class="form-input min-h-11 w-auto"
            aria-label="Einheit von {posten.name}"
            bind:value={einheit}
          >
            {#each einheiten as e (e)}
              <option value={e}>{einheitText(e)}</option>
            {/each}
          </select>
        {:else}
          <span>{einheitText(einheit)}</span>
        {/if}
      </div>
      <input
        class="form-input"
        maxlength="100"
        autocomplete="off"
        aria-label="Ersatz für {posten.name}"
        placeholder="Ersatz, z. B. Pepsi Cola"
        bind:value={ersatz}
      />
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <ActionButton type="submit" variant="primary" disabled={speichert || kontext.busy}
          >{posten.haken ? 'Speichern' : 'Abhaken'}</ActionButton
        >
        {#if posten.haken}
          <ActionButton type="button" disabled={kontext.busy} onclick={() => void aufheben()}
            >Häkchen aufheben</ActionButton
          >
        {/if}
        <ActionButton type="button" onclick={() => onoeffnen(false)}>Abbrechen</ActionButton>
      </div>
    </form>
  {/if}
</li>
