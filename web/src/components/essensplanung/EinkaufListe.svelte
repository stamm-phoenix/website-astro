<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import type { EinkaufListe, EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import { postenMenge } from '../../lib/essensplanungEinkauf';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanKontext } from './planKontext';

  /**
   * The list of one shopping trip by category; while editing, a thing can be moved to another
   * trip or get a fixed amount.
   */

  interface Props {
    kontext: PlanKontext;
    liste: EinkaufListe;
    bearbeiten: boolean;
  }
  let { kontext, liste, bearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const einkauf = $derived(liste.einkauf);
  const andere = $derived(ansicht.einkaeufe.filter((e) => e.id !== einkauf.id && !e.abgeschlossen));
  const aendern = $derived(bearbeiten && !einkauf.abgeschlossen);

  /** The open adjustment: its key and what is typed there. */
  let offen = $state<string | null>(null);
  let ziel = $state('');
  let feste = $state('');
  let festeEinheit = $state<GerichtEinheit>('g');
  let fehler = $state<string | null>(null);

  function einheiten(posten: EinkaufListenPosten): readonly GerichtEinheit[] {
    const art = ansicht.zutaten.find((z) => z.id === posten.planungZutatId)?.einheitenart;
    return art ? EINHEITEN_JE_ART[art] : [];
  }

  function oeffnen(posten: EinkaufListenPosten): void {
    if (offen === posten.key) {
      offen = null;
      return;
    }
    offen = posten.key;
    fehler = null;
    ziel = andere[0] ? String(andere[0].id) : '';
    const regel = einkauf.regeln.find((r) => r.planungZutatId === posten.planungZutatId);
    feste = mengeFeld(regel?.menge ?? posten.menge);
    festeEinheit = regel?.einheit ?? posten.einheit ?? einheiten(posten)[0] ?? 'g';
  }

  async function verschieben(posten: EinkaufListenPosten): Promise<void> {
    const nach = andere.find((e) => String(e.id) === ziel);
    if (!nach) return;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('POST', `/einkaeufe/${einkauf.id}/verschieben`, {
          planungZutatId: posten.planungZutatId,
          nachEinkaufId: nach.id,
        }),
      `${posten.name} kaufst du jetzt bei „${nach.name}“.`
    );
    if (ok) offen = null;
    else fehler = kontext.fehler;
  }

  async function regel(
    posten: Pick<EinkaufListenPosten, 'planungZutatId' | 'name'>,
    art: 'ohne' | 'fest' | null
  ): Promise<void> {
    fehler = null;
    let menge: number | null = null;
    if (art === 'fest') {
      menge = leseMenge(feste);
      if (menge === null || Number.isNaN(menge) || menge < 0) {
        fehler = 'Bitte eine Menge wie 2,5 eintragen.';
        return;
      }
    }
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/einkaeufe/${einkauf.id}/regeln`, {
          planungZutatId: posten.planungZutatId,
          art,
          menge,
          einheit: art === 'fest' ? festeEinheit : null,
        }),
      art === 'fest'
        ? `${posten.name}: feste Menge gespeichert.`
        : art === 'ohne'
          ? `${posten.name} ist nicht mehr in diesem Einkauf.`
          : `${posten.name} wird wieder berechnet.`
    );
    if (ok) offen = null;
    else fehler = kontext.fehler;
  }

  /** „3 l → Pepsi Cola“ for what was ticked off. */
  function erhalten(posten: EinkaufListenPosten): string {
    const h = posten.haken!;
    const menge = h.erhalten > 0 ? kochMenge(h.erhalten, h.einheit, posten.abtropfgewicht) : '';
    return [menge, h.ersatz ? `→ ${h.ersatz}` : ''].filter(Boolean).join(' ');
  }
</script>

{#each liste.kategorien as kategorie (kategorie.name)}
  <div>
    <h5 class="text-sm font-semibold text-neutral-700">{kategorie.name}</h5>
    <ul
      class="divide-y divide-neutral-200 border-y border-neutral-200"
      aria-label="{einkauf.name}: {kategorie.name}"
    >
      {#each kategorie.posten as posten (posten.key)}
        <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
          <p class="min-w-0 [overflow-wrap:anywhere]">
            {#if posten.haken}
              <span class="text-success" aria-hidden="true">✓</span>
              <span class="line-through">{postenMenge(posten)} {posten.name}</span>
              {#if erhalten(posten)}<span class="font-semibold">{erhalten(posten)}</span>{/if}
              <span class="sr-only">abgehakt</span>
            {:else}
              <span class="font-semibold tabular-nums">{postenMenge(posten)}</span>
              {posten.name}
            {/if}
            {#if posten.regel === 'fest'}<span class="text-sm text-neutral-700">· feste Menge</span>
            {:else if posten.regel === 'mit'}<span class="text-sm text-neutral-700"
                >· hierher verschoben</span
              >{/if}
          </p>
          {#if aendern && !posten.haken}
            <button
              type="button"
              class="flex min-h-11 items-center gap-1 text-sm font-semibold text-link print:hidden"
              aria-expanded={offen === posten.key}
              aria-label="{posten.name} in {einkauf.name} anpassen"
              onclick={() => oeffnen(posten)}>Anpassen<AufklappPfeil class="text-link" /></button
            >
          {/if}
          {#if offen === posten.key}
            <div class="basis-full space-y-2 pb-2">
              {#if andere.length}
                <div class="flex flex-wrap items-center gap-2">
                  <select
                    class="form-input min-h-11 w-auto"
                    aria-label="Einkauf für {posten.name}"
                    bind:value={ziel}
                  >
                    {#each andere as e (e.id)}
                      <option value={String(e.id)}>{e.name}</option>
                    {/each}
                  </select>
                  <ActionButton
                    type="button"
                    disabled={kontext.busy}
                    onclick={() => void verschieben(posten)}>Verschieben</ActionButton
                  >
                </div>
              {/if}
              {#if einheiten(posten).length}
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    class="form-input w-24 tabular-nums"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="Feste Menge von {posten.name}"
                    bind:value={feste}
                  />
                  <select
                    class="form-input min-h-11 w-auto"
                    aria-label="Einheit der festen Menge von {posten.name}"
                    bind:value={festeEinheit}
                  >
                    {#each einheiten(posten) as e (e)}
                      <option value={e}>{einheitText(e)}</option>
                    {/each}
                  </select>
                  <ActionButton
                    type="button"
                    disabled={kontext.busy}
                    onclick={() => void regel(posten, 'fest')}>Feste Menge</ActionButton
                  >
                </div>
              {/if}
              <div class="flex flex-wrap gap-2">
                <ActionButton
                  type="button"
                  disabled={kontext.busy}
                  onclick={() => void regel(posten, 'ohne')}>Nicht in diesem Einkauf</ActionButton
                >
                {#if posten.regel}
                  <ActionButton
                    type="button"
                    disabled={kontext.busy}
                    onclick={() => void regel(posten, null)}>Wieder berechnen</ActionButton
                  >
                {/if}
              </div>
              {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{:else}
  <p class="text-neutral-700">Nichts zu kaufen.</p>
{/each}
{#if liste.ohne.length}
  <div class="space-y-1">
    <h5 class="text-sm font-semibold text-neutral-700">Nicht in diesem Einkauf</h5>
    <ul class="flex flex-wrap gap-2" aria-label="Nicht in {einkauf.name}">
      {#each liste.ohne as zutat (zutat.planungZutatId)}
        <li class="flex items-center gap-1">
          <span>{zutat.name}</span>
          {#if aendern}
            <ActionButton
              type="button"
              disabled={kontext.busy}
              aria-label="{zutat.name} zurück in {einkauf.name}"
              onclick={() => void regel(zutat, null)}>Zurückholen</ActionButton
            >
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
