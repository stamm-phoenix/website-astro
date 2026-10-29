<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { geplanterVerbrauch } from '../../lib/essensplanungLager';
  import type { esserRechner } from '../../lib/essensplanungRechnung';
  import { einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { EinplanungStatus, Verbrauch } from '../../../../api/lib/essen-kochen-model';
  import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * Ticks off a planned dish after its meal: cooked, with what it really used (as planned unless
   * changed, unticked for not used), or left out. Shows the status also on paper.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    einplanung: Einplanung;
    /** Name of the dish, for the labels. */
    name: string;
    esser: ReturnType<typeof esserRechner>;
    bearbeiten: boolean;
    /** The status next to the name, or the part to tick off below the dish. */
    teil: 'status' | 'abhaken';
  }
  let { kontext, mahlzeit, einplanung, name, esser, bearbeiten, teil }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const kennung = $derived(`${mahlzeit.kennung}_${einplanung.position}`);

  interface Zeile {
    planungZutatId: number;
    name: string;
    einheit: Verbrauch['einheit'];
    menge: string;
    verwendet: boolean;
  }

  let offen = $state(false);
  let zeilen = $state<Zeile[]>([]);
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  let speichert = $state(false);
  /** The version the rows were filled from; saving on it finds changes of others meanwhile. */
  let etag = '';
  $effect(() => guardUnsavedChanges(() => offen && geaendert));

  /** The rows as saved when cooked, else as planned at this meal. */
  function fuelle(): void {
    const gericht = ansicht.gerichte.find((g) => g.id === einplanung.gerichtId);
    const quelle =
      einplanung.status === 'gekocht'
        ? einplanung.verbrauch
        : geplanterVerbrauch(gericht, mahlzeit, einplanung.faktor, esser);
    const namen = new Map(ansicht.zutaten.map((z) => [z.id, z.name]));
    zeilen = quelle.map((v) => ({
      planungZutatId: v.planungZutatId,
      name: namen.get(v.planungZutatId) ?? 'Zutat',
      einheit: v.einheit,
      menge: mengeFeld(v.menge),
      verwendet: v.menge > 0 || einplanung.status !== 'gekocht',
    }));
    etag = einplanung.etag;
    fehler = null;
    geaendert = false;
  }

  function umschalten(event: Event): void {
    offen = (event.currentTarget as HTMLDetailsElement).open;
    if (offen) fuelle();
  }

  async function setzen(status: EinplanungStatus): Promise<void> {
    if (speichert) return;
    fehler = null;
    const verbrauch: Verbrauch[] = [];
    if (status === 'gekocht') {
      for (const zeile of zeilen) {
        const zahl = zeile.verwendet ? leseMenge(zeile.menge) : 0;
        if (zahl === null || Number.isNaN(zahl) || zahl < 0) {
          fehler = `Bitte für ${zeile.name} eine Menge wie 1,5 eintragen oder „verwendet“ abwählen.`;
          return;
        }
        verbrauch.push({
          planungZutatId: zeile.planungZutatId,
          menge: zahl,
          einheit: zeile.einheit,
        });
      }
    }
    speichert = true;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/einplanungen/${einplanung.id}/status`, {
          etag,
          status,
          verbrauch,
        }),
      status === 'gekocht'
        ? `${name} ist als gekocht abgehakt.`
        : status === 'ausgelassen'
          ? `${name} ist als ausgelassen abgehakt.`
          : `${name} ist wieder offen.`
    );
    speichert = false;
    if (!ok) {
      fehler = kontext.fehler;
      return;
    }
    geaendert = false;
    offen = false;
  }
</script>

{#if teil === 'status' && einplanung.status !== 'offen'}
  <span
    class="rounded-full px-2 py-0.5 text-sm font-semibold {einplanung.status === 'gekocht'
      ? 'bg-success-soft text-success'
      : 'bg-neutral-100 text-neutral-700'}"
    >{einplanung.status === 'gekocht' ? 'gekocht' : 'ausgelassen'}</span
  >
{/if}
{#if teil === 'abhaken' && bearbeiten}
  <details class="basis-full print:hidden" open={offen} ontoggle={umschalten}>
    <summary
      class="flex min-h-11 cursor-pointer list-none items-center gap-1 py-2 text-sm font-semibold text-link [&::-webkit-details-marker]:hidden"
      aria-label="{name} bei {kennung} abhaken"
      >{einplanung.status === 'gekocht' ? 'Verbrauch ändern' : 'Abhaken'}<AufklappPfeil
        class="text-link"
      /></summary
    >
    {#if offen}
      <div class="space-y-2 pb-2">
        {#if zeilen.length}
          <p class="text-sm text-neutral-700">
            Was wurde tatsächlich verbraucht? Vorgeschlagen ist die geplante Menge.
          </p>
          <ul class="space-y-1" aria-label="Verbrauch von {name} bei {kennung}">
            {#each zeilen as zeile, index (`${zeile.planungZutatId}:${zeile.einheit}`)}
              <li class="flex flex-wrap items-center gap-2">
                <label class="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    class="h-5 w-5"
                    bind:checked={zeilen[index].verwendet}
                    onchange={() => (geaendert = true)}
                  />
                  <span class="sr-only">{zeile.name} bei {kennung} verwendet</span>
                </label>
                <span class="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">{zeile.name}</span>
                <input
                  class="form-input w-24 tabular-nums"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-label="Verbrauch von {zeile.name} bei {kennung}"
                  disabled={!zeile.verwendet || speichert}
                  bind:value={zeilen[index].menge}
                  oninput={() => (geaendert = true)}
                />
                <span class="w-20 text-sm">{einheitText(zeile.einheit)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-neutral-700">Das Gericht hat keine Zutaten mit Menge.</p>
        {/if}
        {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
        <div class="flex flex-wrap gap-2">
          <ActionButton
            type="button"
            variant="primary"
            disabled={speichert || kontext.busy}
            onclick={() => void setzen('gekocht')}
            >{einplanung.status === 'gekocht' ? 'Verbrauch speichern' : 'Gekocht'}</ActionButton
          >
          {#if einplanung.status !== 'ausgelassen'}
            <ActionButton
              type="button"
              disabled={speichert || kontext.busy}
              onclick={() => void setzen('ausgelassen')}>Ausgelassen</ActionButton
            >
          {/if}
          {#if einplanung.status !== 'offen'}
            <ActionButton
              type="button"
              disabled={speichert || kontext.busy}
              onclick={() => void setzen('offen')}>Wieder offen</ActionButton
            >
          {/if}
        </div>
      </div>
    {/if}
  </details>
{/if}
