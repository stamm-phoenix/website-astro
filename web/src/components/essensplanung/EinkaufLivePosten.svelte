<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import type { PostenHerkunft as Herkunft } from '../../lib/essensplanungHerkunft';
  import PostenHerkunft from './PostenHerkunft.svelte';
  import { FELD, KNOPF, herkunftAnzeige } from './einkaufHerkunft.svelte';
  import { ApiError } from '../../lib/api';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import { postenMenge } from '../../lib/essensplanungEinkauf';
  import type { EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import {
    EINHEITEN_JE_ART,
    einheitText,
    einheitenGleicherBasis,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
  import { meldeVerloren, type PlanKontext } from './planKontext';
  import {
    entwuerfe,
    lebendig,
    merkeEntwurf,
    offeneZeile,
    sichtbar,
    vergissEntwurf,
  } from './einkaufLive';

  /**
   * One thing in the live mode of a shopping trip: the box ticks it off with the amount of the
   * fields (the planned one unless changed) or takes the tick back. Amount and replacement stand
   * in the row on wide screens and open with „Menge“ on phones; Enter in a field saves.
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
    /** The dishes it is for, shown with „Für welche Gerichte“. */
    herkunft?: Herkunft;
  }
  let {
    kontext,
    einkaufId,
    posten,
    gesperrt = false,
    offen,
    onoeffnen,
    herkunft,
  }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  const einheiten = $derived.by((): readonly GerichtEinheit[] => {
    // A thing with an amount is bought in its unit (g or kg, or its own like „Dose“)
    if (posten.einheit) return einheitenGleicherBasis(posten.einheit);
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
  /** Where the unsaved input is kept while the trip shows its list or form. */
  const entwurfKey = untrack(() => `${einkaufId}:${posten.planungZutatId}`);
  // Input kept from before the trip showed its list or form
  const frueher = entwuerfe.get(entwurfKey);
  if (frueher) {
    menge = frueher.menge;
    einheit = frueher.einheit;
    ersatz = frueher.ersatz;
    etag = frueher.etag;
    konflikt = frueher.konflikt;
    geaendert = true;
  }
  // Kept outside the row, so switching the view keeps it; leaving the page asks first, also after
  // a failed save
  $effect(() => {
    if (geaendert) merkeEntwurf(entwurfKey, { menge, einheit, ersatz, etag, konflikt });
    else vergissEntwurf(entwurfKey);
  });

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
        if (lebendig.has(einkaufId) && !sichtbar.has(id)) {
          vergissEntwurf(id);
          meldeVerloren(kontext, text);
        }
      });
    };
  });

  /** False once this row is gone (another view): a late answer then leaves it alone. */
  let aktiv = true;
  $effect(() => () => {
    aktiv = false;
  });
  // Nothing typed: the fields show the thing as it is now, planned or ticked off, also when
  // someone else changes it; from the first key on they keep what is typed
  $effect(() => {
    void [posten.haken, posten.menge, posten.einheit, einheiten];
    if (!geaendert) untrack(fuellen);
  });

  function oeffnen(): void {
    onoeffnen(!offen);
  }

  /** Drops what was typed and closes the amount; the fields show the saved state again. */
  function abbrechen(): void {
    geaendert = false;
    onoeffnen(false);
  }

  function fuellen(): void {
    const h = posten.haken;
    menge = h ? (h.erhalten > 0 ? mengeFeld(h.erhalten) : '') : mengeFeld(posten.menge);
    einheit = h?.einheit ?? posten.einheit ?? einheiten[0] ?? 'stueck';
    ersatz = h?.ersatz ?? '';
    etag = h?.etag ?? null;
    fehler = null;
    konflikt = null;
  }

  /** The box: open things are ticked off with what the fields say, ticked off ones reopened. */
  function haken(): void {
    if (speichert || gesperrt || kontext.busy) return;
    if (posten.haken && !geaendert) void aufheben();
    else void speichern();
  }

  /** Arrow keys go from box to box, as in a table. */
  function pfeil(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const boxen = [
      ...((event.currentTarget as HTMLElement)
        .closest('[data-live-liste]')
        ?.querySelectorAll<HTMLElement>('[data-live-haken]') ?? []),
    ];
    const index = boxen.indexOf(event.currentTarget as HTMLElement);
    const ziel = boxen[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!ziel) return;
    event.preventDefault();
    ziel.focus();
  }

  /** Enter in a field saves, like ticking off. */
  function taste(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    void speichern();
  }

  async function speichern(): Promise<void> {
    if (speichert || gesperrt) return;
    const zahl = menge.trim() ? leseMenge(menge) : 0;
    if (zahl === null || Number.isNaN(zahl) || zahl < 0) {
      fehler = 'Bitte eine Menge wie 2,5 eintragen oder das Feld leer lassen.';
      geaendert = true;
      onoeffnen(true);
      return;
    }
    speichert = true;
    /** What is sent; typed on while it is saved, the newer input stays. */
    const gesendet = { menge, einheit, ersatz };
    // Everything read now: the answer may come when this row is gone (another view)
    const einkauf = einkaufId;
    const zutatId = posten.planungZutatId;
    const key = entwurfKey;
    const zeile = posten.key;
    const body = { etag, planungZutatId: zutatId, einheit, erhalten: zahl, ersatz };
    let abgelehnt: unknown = null;
    const ok = await kontext.aendern(async () => {
      try {
        return await kontext.api.senden('PUT', `/einkaeufe/${einkauf}/posten`, body);
      } catch (error: unknown) {
        abgelehnt = error;
        throw error;
      }
    }, `${posten.name} abgehakt.`);
    speichert = false;
    if (ok) {
      // The kept input is settled here, not by the row, which may be gone: saved as it is, it
      // goes; typed on meanwhile, it stays on the version just saved
      const kept = entwuerfe.get(key);
      if (
        !kept ||
        (kept.menge === gesendet.menge &&
          kept.einheit === gesendet.einheit &&
          kept.ersatz === gesendet.ersatz)
      ) {
        vergissEntwurf(key);
        if (!aktiv && offeneZeile.get(einkauf) === zeile) offeneZeile.delete(einkauf);
      } else {
        const neu =
          kontext.ansicht.einkaeufe
            .find((e) => e.id === einkauf)
            ?.posten.find((p) => p.planungZutatId === zutatId)?.etag ?? null;
        merkeEntwurf(key, { ...kept, etag: neu, konflikt: null });
      }
      if (!aktiv) return;
      konflikt = null;
      if (menge === gesendet.menge && einheit === gesendet.einheit && ersatz === gesendet.ersatz) {
        abbrechen();
        return;
      }
      // Saved, but typed on meanwhile: that stays open and unsaved, on the version just saved
      await tick();
      etag = posten.haken?.etag ?? null;
      fehler = null;
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
      // Kept and shown, also when only the box was clicked
      geaendert = true;
      onoeffnen(true);
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
    geaendert = true;
    onoeffnen(true);
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

<li class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 md:flex-nowrap">
  <button
    type="button"
    role="checkbox"
    aria-checked={!!posten.haken}
    aria-label="{posten.name} abhaken"
    data-live-haken
    disabled={gesperrt}
    class="flex size-8 shrink-0 items-center justify-center rounded any-pointer-coarse:size-11"
    onclick={haken}
    onkeydown={pfeil}
  >
    <span
      class="flex size-6 items-center justify-center rounded border-2 text-base font-bold {posten.haken
        ? 'border-success bg-success-soft text-success'
        : 'border-neutral-500 bg-surface'} {speichert ? 'opacity-50' : ''}"
      aria-hidden="true">{posten.haken ? '✓' : ''}</span
    >
  </button>
  <div class="min-w-0 flex-1 [overflow-wrap:anywhere]">
    {#if posten.haken}
      <span class="text-neutral-700 line-through">{postenMenge(posten)} {posten.name}</span>
      {#if erhalten}<span class="font-semibold">{erhalten}</span>{/if}
      {#if posten.haken.von}<span class="text-xs text-neutral-700">· {posten.haken.von}</span>{/if}
    {:else}
      <span class="font-semibold tabular-nums">{postenMenge(posten)}</span>
      {posten.name}
    {/if}
    {#if herkunftAnzeige.an}<PostenHerkunft {herkunft} name={posten.name} />{/if}
  </div>
  <button
    type="button"
    class="flex min-h-8 shrink-0 items-center gap-1 rounded px-2 text-sm font-semibold text-link any-pointer-coarse:min-h-11 md:hidden"
    aria-expanded={offen}
    aria-label="{posten.name}: Menge und Ersatz"
    onclick={oeffnen}
    ><span aria-hidden="true">Menge</span><AufklappPfeil
      class="text-link transition-transform {offen ? 'rotate-180' : ''}"
    /></button
  >
  <form
    class="{offen
      ? 'flex'
      : 'hidden'} basis-full flex-wrap items-center gap-2 pb-2 pl-12 md:flex md:basis-auto md:flex-nowrap md:pb-0 md:pl-0"
    onsubmit={(event) => {
      event.preventDefault();
      void speichern();
    }}
    oninput={() => (geaendert = true)}
    aria-label="{posten.name} abhaken"
  >
    <span class="flex items-center gap-1">
      <input
        class="{FELD} w-20 text-right tabular-nums"
        inputmode="decimal"
        autocomplete="off"
        aria-label="Erhaltene Menge von {posten.name}"
        placeholder="–"
        bind:value={menge}
        onkeydown={taste}
      />
      {#if einheiten.length > 1}
        <select class="{FELD} w-24" aria-label="Einheit von {posten.name}" bind:value={einheit}>
          {#each einheiten as e (e)}
            <option value={e}>{einheitText(e)}</option>
          {/each}
        </select>
      {:else}
        <span class="w-24 px-2 text-sm">{einheitText(einheit)}</span>
      {/if}
    </span>
    <input
      class="{FELD} flex-1 md:w-44 md:flex-none"
      maxlength="100"
      autocomplete="off"
      aria-label="Ersatz für {posten.name}"
      placeholder="Ersatz"
      bind:value={ersatz}
      onkeydown={taste}
    />
    {#if offen || geaendert || konflikt}
      <span class="flex flex-wrap gap-1 {geaendert || konflikt ? '' : 'md:hidden'}">
        <!-- As when the typing started: a tick of someone else meanwhile is a conflict -->
        <ActionButton
          type="submit"
          variant="primary"
          class={KNOPF}
          disabled={speichert || gesperrt || kontext.busy}
          >{konflikt ? 'Trotzdem speichern' : etag !== null ? 'Speichern' : 'Abhaken'}</ActionButton
        >
        {#if posten.haken}
          <ActionButton
            type="button"
            class="{KNOPF} md:hidden"
            disabled={gesperrt || kontext.busy}
            onclick={() => void aufheben()}>Häkchen aufheben</ActionButton
          >
        {/if}
        <ActionButton type="button" class={KNOPF} onclick={abbrechen}>Abbrechen</ActionButton>
      </span>
    {/if}
  </form>
  {#if konflikt}<p class="basis-full pl-12 text-sm text-warning" role="alert">{konflikt}</p>{/if}
  {#if fehler}<p class="basis-full pl-12 text-sm text-danger" role="alert">{fehler}</p>{/if}
</li>
