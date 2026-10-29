<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import { postenMenge } from '../../lib/essensplanungEinkauf';
  import type { EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { meldeVerloren, type PlanKontext } from './planKontext';
  import { lebendig, sichtbar } from './einkaufLive';

  /**
   * One thing in the live mode of a shopping trip: a tap opens the amount (the planned one unless
   * changed) and a replacement, „Abhaken“ saves it. Ticked off things can be changed or taken back.
   */

  interface Props {
    kontext: PlanKontext;
    einkaufId: number;
    posten: EinkaufListenPosten;
    /** Read-only for a while (maintenance): what is typed stays, saving waits. */
    gesperrt?: boolean;
    /** Whether this thing's amount is open; only one at a time. */
    offen: boolean;
    onoeffnen: (offen: boolean) => void;
  }
  let { kontext, einkaufId, posten, gesperrt = false, offen, onoeffnen }: Props = $props();
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
  let etag = $state<string | null>(null);
  /**
   * Someone else ticked it off, changed it or took it back meanwhile: what they did, shown with
   * the input kept; saving again takes the input over it.
   */
  let konflikt = $state<string | null>(null);

  /** Something was typed into the open amount and is not saved. */
  let geaendert = $state(false);
  // Leaving the page asks first, also after a failed save
  $effect(() => guardUnsavedChanges(() => geaendert));

  // A row with unsaved input that falls off the list (someone ticked its needs off on another
  // trip) names the input, unless it comes back drawn again at once
  $effect(() => {
    const id = `${einkaufId}:${posten.planungZutatId}`;
    const name = posten.name;
    sichtbar.set(id, (sichtbar.get(id) ?? 0) + 1);
    return () => {
      sichtbar.set(id, (sichtbar.get(id) ?? 1) - 1);
      if (!sichtbar.get(id)) sichtbar.delete(id);
      if (!geaendert) return;
      const eingabe = [
        untrack(() => menge).trim()
          ? `${untrack(() => menge)} ${einheitText(untrack(() => einheit))}`
          : '',
        untrack(() => ersatz).trim() ? `→ ${untrack(() => ersatz)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const text = `${name} steht in diesem Einkauf nicht mehr auf der Liste, jemand hat es anderswo abgehakt${eingabe ? ` (deine Eingabe: ${eingabe})` : ''}.`;
      setTimeout(() => {
        // Still in the live mode of this trip, and not drawn again
        if (lebendig.has(einkaufId) && !sichtbar.has(id)) meldeVerloren(kontext, text);
      });
    };
  });

  /** Whether the fields were filled for the open amount. */
  let gefuellt = false;
  // Opened before this row was drawn again (e.g. its category came with the central lists)
  $effect(() => {
    if (offen && !gefuellt) untrack(fuellen);
  });

  function oeffnen(): void {
    if (offen) {
      onoeffnen(false);
      return;
    }
    // What was typed stays until it is saved or cancelled, also when another thing was open
    if (!geaendert) fuellen();
    onoeffnen(true);
  }

  /** Closes the amount and drops what was typed. */
  function abbrechen(): void {
    geaendert = false;
    gefuellt = false;
    onoeffnen(false);
  }

  function fuellen(): void {
    gefuellt = true;
    geaendert = false;
    const h = posten.haken;
    menge = h ? (h.erhalten > 0 ? mengeFeld(h.erhalten) : '') : mengeFeld(posten.menge);
    einheit = h?.einheit ?? posten.einheit ?? einheiten[0] ?? 'stueck';
    ersatz = h?.ersatz ?? '';
    etag = h?.etag ?? null;
    fehler = null;
    konflikt = null;
  }

  async function abhaken(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || gesperrt) return;
    const zahl = menge.trim() ? leseMenge(menge) : 0;
    if (zahl === null || Number.isNaN(zahl) || zahl < 0) {
      fehler = 'Bitte eine Menge wie 2,5 eintragen oder das Feld leer lassen.';
      return;
    }
    speichert = true;
    let abgelehnt: unknown = null;
    const ok = await kontext.aendern(async () => {
      try {
        return await kontext.api.senden('PUT', `/einkaeufe/${einkaufId}/posten`, {
          etag,
          planungZutatId: posten.planungZutatId,
          einheit,
          erhalten: zahl,
          ersatz,
        });
      } catch (error: unknown) {
        abgelehnt = error;
        throw error;
      }
    }, `${posten.name} abgehakt.`);
    speichert = false;
    if (ok) {
      konflikt = null;
      abbrechen();
      return;
    }
    if (abgelehnt instanceof ApiError && abgelehnt.status === 409) {
      // The page shows the current state now; saving again goes on that version
      await tick();
      const h = posten.haken;
      etag = h?.etag ?? null;
      konflikt = h
        ? `${h.von || 'Jemand'} hat das inzwischen abgehakt${hakenText(h) ? `: ${hakenText(h)}` : ''}. Deine Eingabe ist noch da; „Trotzdem speichern“ ersetzt es.`
        : 'Das Häkchen wurde inzwischen aufgehoben. Deine Eingabe ist noch da; „Trotzdem speichern“ hakt es wieder ab.';
      fehler = null;
      return;
    }
    // A field the server refused is named at the input, which keeps what was typed
    const felder = abgelehnt instanceof ApiError ? abgelehnt.fields : undefined;
    fehler =
      felder?.erhalten ??
      felder?.einheit ??
      felder?.ersatz ??
      felder?.planungZutatId ??
      kontext.fehler;
  }

  async function aufheben(): Promise<void> {
    const h = posten.haken;
    if (!h) return;
    const ok = await kontext.aendern(
      () => kontext.api.senden('DELETE', `/einkauf-posten/${h.id}`, undefined, h.etag),
      `${posten.name} ist wieder offen.`
    );
    if (ok) abbrechen();
  }

  /** „3 l → Pepsi Cola“. */
  function hakenText(h: NonNullable<EinkaufListenPosten['haken']>): string {
    const text = h.erhalten > 0 ? kochMenge(h.erhalten, h.einheit, posten.abtropfgewicht) : '';
    return [text, h.ersatz ? `→ ${h.ersatz}` : ''].filter(Boolean).join(' ');
  }
  const erhalten = $derived(posten.haken ? hakenText(posten.haken) : '');
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
    <form
      class="space-y-2 px-2 pb-3"
      onsubmit={abhaken}
      oninput={() => (geaendert = true)}
      aria-label="{posten.name} abhaken"
    >
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
      {#if konflikt}<p class="text-sm text-warning" role="alert">{konflikt}</p>{/if}
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <!-- As when opened: a tick of someone else meanwhile shows up only as a conflict -->
        <ActionButton
          type="submit"
          variant="primary"
          disabled={speichert || gesperrt || kontext.busy}
          >{konflikt ? 'Trotzdem speichern' : etag !== null ? 'Speichern' : 'Abhaken'}</ActionButton
        >
        {#if posten.haken}
          <ActionButton
            type="button"
            disabled={gesperrt || kontext.busy}
            onclick={() => void aufheben()}>Häkchen aufheben</ActionButton
          >
        {/if}
        <ActionButton type="button" onclick={abbrechen}>Abbrechen</ActionButton>
      </div>
    </form>
  {/if}
</li>
