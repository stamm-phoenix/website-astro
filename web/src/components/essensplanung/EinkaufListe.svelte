<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import type { EinkaufListe, EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import { postenMenge } from '../../lib/essensplanungEinkauf';
  import {
    EINHEITEN_JE_ART,
    einheitText,
    einheitenGleicherBasis,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanKontext } from './planKontext';
  import { festeEntwuerfe, merkeFest, vergissFest } from './einkaufLive';
  import type { PostenHerkunft as Herkunft } from '../../lib/essensplanungHerkunft';
  import PostenHerkunft from './PostenHerkunft.svelte';
  import { FELD, KNOPF, herkunftAnzeige } from './einkaufHerkunft.svelte';

  /**
   * The list of one shopping trip by category; while editing, a thing can be moved to another
   * trip or get a fixed amount.
   */

  interface Props {
    kontext: PlanKontext;
    liste: EinkaufListe;
    bearbeiten: boolean;
    /** The dishes a thing is for. */
    herkunft: (posten: EinkaufListenPosten) => Herkunft | undefined;
  }
  let { kontext, liste, bearbeiten, herkunft }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const einkauf = $derived(liste.einkauf);
  const andere = $derived(ansicht.einkaeufe.filter((e) => e.id !== einkauf.id && !e.abgeschlossen));
  /** Trips a thing can move to: open ones where it is not ticked off yet. */
  function ziele(posten: Pick<EinkaufListenPosten, 'planungZutatId'>) {
    return andere.filter((e) => !e.posten.some((p) => p.planungZutatId === posten.planungZutatId));
  }
  const aendern = $derived(bearbeiten && !einkauf.abgeschlossen);

  /** The open adjustment: its key and what is typed there. */
  let offen = $state<string | null>(null);
  let ziel = $state('');
  let feste = $state('');
  let festeEinheit = $state<GerichtEinheit>('g');
  let fehler = $state<string | null>(null);
  /**
   * A change of this list is being saved: its fields and the other rows wait, so what is typed
   * and the answer always belong to the same thing.
   */
  let speichert = $state(false);
  async function gesperrt<T>(work: () => Promise<T>): Promise<T> {
    speichert = true;
    try {
      return await work();
    } finally {
      speichert = false;
    }
  }

  function einheiten(posten: EinkaufListenPosten): readonly GerichtEinheit[] {
    // A thing with an amount is bought in its unit (g or kg, or its own like „Dose“)
    if (posten.einheit) return einheitenGleicherBasis(posten.einheit);
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
    ziel = ziele(posten)[0] ? String(ziele(posten)[0].id) : '';
    const regel = einkauf.regeln.find((r) => r.planungZutatId === posten.planungZutatId);
    festStart = {
      menge: mengeFeld(regel?.menge ?? posten.menge),
      einheit: regel?.einheit ?? posten.einheit ?? einheiten(posten)[0] ?? 'g',
    };
    // An amount typed before and not saved comes back
    const entwurf = festeEntwuerfe.get(festKey(posten));
    feste = entwurf?.menge ?? festStart.menge;
    festeEinheit = entwurf?.einheit ?? festStart.einheit;
  }

  /** The fixed amount the open row started with. */
  let festStart = { menge: '', einheit: 'g' as GerichtEinheit };
  const festKey = (posten: Pick<EinkaufListenPosten, 'planungZutatId'>) =>
    `${einkauf.id}:${posten.planungZutatId}`;

  /** Keeps a fixed amount typed and not saved, so it survives opening another thing. */
  function festGetippt(posten: EinkaufListenPosten): void {
    if (feste === festStart.menge && festeEinheit === festStart.einheit)
      vergissFest(festKey(posten));
    else merkeFest(festKey(posten), { menge: feste, einheit: festeEinheit });
  }

  async function verschieben(posten: EinkaufListenPosten): Promise<void> {
    const nach = ziele(posten).find((e) => String(e.id) === ziel);
    if (!nach) return;
    const einkaufId = einkauf.id;
    const ok = await gesperrt(() =>
      kontext.aendern(
        () =>
          kontext.api.senden('POST', `/einkaeufe/${einkaufId}/verschieben`, {
            planungZutatId: posten.planungZutatId,
            nachEinkaufId: nach.id,
          }),
        `${posten.name} kaufst du jetzt bei „${nach.name}“.`
      )
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
    // Everything read now: the row waits while it is saved, and the answer belongs to this thing
    const body = {
      planungZutatId: posten.planungZutatId,
      art,
      menge,
      einheit: art === 'fest' ? festeEinheit : null,
    };
    const einkaufId = einkauf.id;
    const key = festKey(posten);
    const zeile = offen;
    let abgelehnt: unknown = null;
    const ok = await gesperrt(() =>
      kontext.aendern(
        () =>
          kontext.api
            .senden('PUT', `/einkaeufe/${einkaufId}/regeln`, body)
            .catch((error: unknown) => {
              abgelehnt = error;
              throw error;
            }),
        art === 'fest'
          ? `${posten.name}: feste Menge gespeichert.`
          : art === 'ohne'
            ? `${posten.name} ist nicht mehr in diesem Einkauf.`
            : `${posten.name} wird wieder berechnet.`
      )
    );
    if (ok) {
      // Saved or decided otherwise: the typed fixed amount of this thing is done with
      vergissFest(key);
      if (offen === zeile) offen = null;
    } else {
      // A field the server refused is named in the row, which keeps what was typed
      const felder = abgelehnt instanceof ApiError ? abgelehnt.fields : undefined;
      fehler = felder?.menge ?? felder?.einheit ?? felder?.planungZutatId ?? kontext.fehler;
    }
  }

  /**
   * Takes back „not on this trip“; a trip it was moved to gives it back too, so both are worked
   * out again.
   */
  async function zurueckholen(zutat: { planungZutatId: number; name: string }): Promise<void> {
    fehler = null;
    const einkaufId = einkauf.id;
    const ok = await gesperrt(() =>
      kontext.aendern(
        () =>
          kontext.api.senden('POST', `/einkaeufe/${einkaufId}/zurueckholen`, {
            planungZutatId: zutat.planungZutatId,
          }),
        `${zutat.name} wird wieder berechnet.`
      )
    );
    if (!ok) fehler = kontext.fehler;
  }

  /** „3 l → Pepsi Cola“ for what was ticked off. */
  function erhalten(posten: EinkaufListenPosten): string {
    const h = posten.haken!;
    const menge = h.erhalten > 0 ? kochMenge(h.erhalten, h.einheit, posten.abtropfgewicht) : '';
    return [menge, h.ersatz ? `→ ${h.ersatz}` : ''].filter(Boolean).join(' ');
  }
</script>

{#each liste.kategorien as kategorie (kategorie.name)}
  <section>
    <h4
      class="border-b border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-bold tracking-wide text-neutral-700 uppercase"
    >
      {kategorie.name}
    </h4>
    <ul class="divide-y divide-neutral-200" aria-label="{einkauf.name}: {kategorie.name}">
      {#each kategorie.posten as posten (posten.key)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-sm">
          <p class="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {#if posten.haken}
              <span class="text-success" aria-hidden="true">✓</span>
              <span class="line-through">{postenMenge(posten)} {posten.name}</span>
              {#if erhalten(posten)}<span class="font-semibold">{erhalten(posten)}</span>{/if}
              <span class="sr-only">abgehakt</span>
            {:else}
              <span class="font-semibold tabular-nums">{postenMenge(posten)}</span>
              {posten.name}
            {/if}
            {#if posten.regel === 'fest'}<span class="text-xs text-neutral-700">· feste Menge</span>
            {:else if posten.regel === 'mit'}<span class="text-xs text-neutral-700"
                >· hierher verschoben</span
              >{/if}
            {#if herkunftAnzeige.an}<PostenHerkunft
                herkunft={herkunft(posten)}
                name={posten.name}
              />{/if}
          </p>
          {#if aendern && !posten.haken}
            <button
              type="button"
              class="flex min-h-8 items-center gap-1 rounded px-1 text-sm font-semibold text-link any-pointer-coarse:min-h-11 print:hidden"
              aria-expanded={offen === posten.key}
              aria-label="{posten.name} in {einkauf.name} anpassen"
              disabled={speichert}
              onclick={() => oeffnen(posten)}
              >Anpassen<AufklappPfeil
                class="text-link {offen === posten.key ? 'rotate-180' : ''}"
              /></button
            >
          {/if}
          {#if offen === posten.key}
            <fieldset
              class="flex basis-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-neutral-300 pt-1 pb-1"
              disabled={speichert}
            >
              {#if ziele(posten).length}
                <span class="flex items-center gap-1">
                  <select
                    class="{FELD} w-auto"
                    aria-label="Einkauf für {posten.name}"
                    bind:value={ziel}
                  >
                    {#each ziele(posten) as e (e.id)}
                      <option value={String(e.id)}>{e.name}</option>
                    {/each}
                  </select>
                  <ActionButton
                    type="button"
                    class={KNOPF}
                    disabled={kontext.busy}
                    onclick={() => void verschieben(posten)}>Verschieben</ActionButton
                  >
                </span>
              {/if}
              {#if einheiten(posten).length}
                <span class="flex items-center gap-1">
                  <input
                    class="{FELD} w-20 text-right tabular-nums"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="Feste Menge von {posten.name}"
                    bind:value={feste}
                    oninput={() => festGetippt(posten)}
                    onkeydown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      void regel(posten, 'fest');
                    }}
                  />
                  <select
                    class="{FELD} w-auto"
                    aria-label="Einheit der festen Menge von {posten.name}"
                    bind:value={festeEinheit}
                    onchange={() => festGetippt(posten)}
                  >
                    {#each einheiten(posten) as e (e)}
                      <option value={e}>{einheitText(e)}</option>
                    {/each}
                  </select>
                  <ActionButton
                    type="button"
                    class={KNOPF}
                    disabled={kontext.busy}
                    onclick={() => void regel(posten, 'fest')}>Feste Menge</ActionButton
                  >
                </span>
              {/if}
              <span class="flex flex-wrap gap-1">
                <ActionButton
                  type="button"
                  class={KNOPF}
                  disabled={kontext.busy}
                  onclick={() => void regel(posten, 'ohne')}>Nicht in diesem Einkauf</ActionButton
                >
                {#if posten.regel}
                  <ActionButton
                    type="button"
                    class={KNOPF}
                    disabled={kontext.busy}
                    onclick={() => void regel(posten, null)}>Wieder berechnen</ActionButton
                  >
                {/if}
              </span>
              {#if fehler}<p class="basis-full text-sm text-danger" role="alert">{fehler}</p>{/if}
            </fieldset>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{:else}
  <p class="text-neutral-700">Nichts zu kaufen.</p>
{/each}
{#if liste.ohne.length}
  <section class="space-y-1">
    <h4
      class="border-b border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-bold tracking-wide text-neutral-700 uppercase"
    >
      Nicht in diesem Einkauf
    </h4>
    <ul class="flex flex-wrap gap-x-4 gap-y-1 px-2 text-sm" aria-label="Nicht in {einkauf.name}">
      {#each liste.ohne as zutat (zutat.planungZutatId)}
        <li class="flex items-center gap-1">
          <span>{zutat.name}</span>
          {#if aendern}
            <ActionButton
              type="button"
              class={KNOPF}
              disabled={kontext.busy}
              aria-label="{zutat.name} zurück in {einkauf.name}"
              onclick={() => void zurueckholen(zutat)}>Zurückholen</ActionButton
            >
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
