<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import BelegVorschau from './BelegVorschau.svelte';
  import BezahltVonFeld from './BezahltVonFeld.svelte';
  import { ApiError } from '../../lib/api';
  import { centToInput, formatIsoDate, parseEuroToCent } from '../../lib/belege';
  import { confirmAction } from '../../lib/confirm';
  import { euro } from '../../lib/essensplanungBelege';
  import { todayIso } from '../../lib/format';
  import type { PlanungBeleg } from '../../lib/types';
  import {
    entwurfLeer,
    neuerEntwurf,
    type BelegEntwuerfe,
    type BelegFeld,
    type BelegZeilenEntwurf,
  } from './belegEntwuerfe';
  import { gespeichert, merkeSpeichern, type PlanKontext } from './planKontext';

  /**
   * One receipt as a row of the table. Day, shop, note and amount save when the field is left or
   * Enter is pressed (Escape takes the saved value back), who paid and „erstattet“ at once; each
   * on the version the row had when typing began. A failed save keeps what was typed.
   */

  type Feld = BelegFeld;

  interface Props {
    kontext: PlanKontext;
    beleg: PlanungBeleg;
    bearbeiten: boolean;
    /** Unsaved input of all rows, kept by the list (`belegEntwuerfe.ts`). */
    entwuerfe: BelegEntwuerfe;
    onfoto: () => void;
    onansehen: () => void;
  }
  let { kontext, beleg, bearbeiten, entwuerfe, onfoto, onansehen }: Props = $props();

  let speichert = $state(false);
  /** Fields left while a save of this row ran; they save right after it. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a queue, never rendered
  const wartend = new Set<Feld>();
  let wahl = $state('');
  let name = $state('');

  const entwurf = $derived<BelegZeilenEntwurf | undefined>(entwuerfe[beleg.id]);
  const fehler = $derived(entwurf?.fehler ?? {});

  /** The draft of this row, made on the first input (only in handlers, never while rendering). */
  function eigener(): BelegZeilenEntwurf {
    entwuerfe[beleg.id] ??= neuerEntwurf();
    return entwuerfe[beleg.id];
  }

  /** Drops the draft once nothing is typed and no message is left. */
  function aufraeumen(): void {
    const aktuell = entwuerfe[beleg.id];
    if (aktuell && entwurfLeer(aktuell)) delete entwuerfe[beleg.id];
  }

  const gespeicherterWert = (feld: Feld): string =>
    feld === 'betrag'
      ? centToInput(beleg.betragCent)
      : feld === 'datum'
        ? beleg.datum
        : feld === 'haendler'
          ? beleg.haendler
          : beleg.notiz;
  const wert = (feld: Feld): string => entwurf?.felder[feld] ?? gespeicherterWert(feld);

  // The choice follows the saved payer unless a free name is being typed
  $effect(() => {
    const getippt = entwurf?.name ?? null;
    if (getippt !== null) {
      wahl = 'text';
      name = getippt;
      return;
    }
    wahl = beleg.bezahltVonId !== null ? `m:${beleg.bezahltVonId}` : 'text';
    name = beleg.bezahltVonText;
  });

  function tippen(feld: Feld, text: string): void {
    const eigen = eigener();
    if (eigen.basis === null) eigen.basis = beleg.etag;
    eigen.felder[feld] = text;
  }

  function zuruecksetzen(feld: Feld): void {
    const eigen = entwuerfe[beleg.id];
    if (!eigen) return;
    delete eigen.felder[feld];
    delete eigen.fehler[feld];
    if (!Object.keys(eigen.felder).length && eigen.name === null) eigen.basis = null;
    aufraeumen();
  }

  function setzeFehler(feld: Feld | 'bezahlt', text: string): void {
    eigener().fehler[feld] = text;
  }

  /** Saves fields of this row; field messages of the server stay at the field. */
  async function senden(felder: Record<string, unknown>, erfolg: string): Promise<boolean> {
    let felderFehler: Record<string, string> = {};
    /** Someone else changed or deleted the receipt; the page shows the current state. */
    let konflikt = false;
    speichert = true;
    const etag = entwuerfe[beleg.id]?.basis ?? beleg.etag;
    const id = beleg.id;
    const lauf = kontext.aendern(async () => {
      try {
        return await kontext.api.senden('PATCH', `/belege/${id}`, { ...felder, etag });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) felderFehler = error.fields;
        if (error instanceof ApiError && [404, 409, 412].includes(error.status)) konflikt = true;
        throw error;
      }
    }, erfolg);
    merkeSpeichern(lauf);
    const ok = await lauf;
    speichert = false;
    if (ok) {
      // The row shows the answer only after the update
      await tick();
      // Typed on meanwhile: that goes on the version this save brought
      const eigen = entwuerfe[beleg.id];
      if (eigen)
        eigen.basis = Object.keys(eigen.felder).length || eigen.name !== null ? beleg.etag : null;
    }
    // Fields left during the save follow now; after a failure they stay drafts
    const naechste = [...wartend];
    wartend.clear();
    if (ok && naechste.length)
      void (async () => {
        for (const weiter of naechste) await feldSpeichern(weiter);
      })();
    if (!ok) {
      const eigen = eigener();
      // After a conflict the page shows the current state, and saving again goes on it, on
      // purpose. Any other failure (no connection, server, a rejected value) keeps the version
      // typing began with, so a change of someone else meanwhile still is a conflict.
      const offen = Object.keys(eigen.felder).length > 0 || eigen.name !== null;
      eigen.basis = konflikt || !offen ? null : etag;
      if (felderFehler.betragCent) eigen.fehler.betrag = felderFehler.betragCent;
      if (felderFehler.datum) eigen.fehler.datum = felderFehler.datum;
      if (felderFehler.haendler) eigen.fehler.haendler = felderFehler.haendler;
      if (felderFehler.notiz) eigen.fehler.notiz = felderFehler.notiz;
      if (felderFehler.bezahltVonId || felderFehler.bezahltVonText)
        eigen.fehler.bezahlt = felderFehler.bezahltVonId ?? felderFehler.bezahltVonText;
    }
    return ok;
  }

  async function feldSpeichern(feld: Feld): Promise<void> {
    const text = entwuerfe[beleg.id]?.felder[feld];
    if (text === undefined) return;
    if (speichert) {
      wartend.add(feld);
      return;
    }
    if (text === gespeicherterWert(feld)) {
      zuruecksetzen(feld);
      return;
    }
    let felder: Record<string, unknown>;
    if (feld === 'betrag') {
      const cent = parseEuroToCent(text);
      if (cent === null) {
        setzeFehler('betrag', 'Bitte einen Betrag größer als 0 € angeben, z. B. 12,34.');
        return;
      }
      felder = { betragCent: cent };
    } else if (feld === 'datum') {
      if (!text) {
        setzeFehler('datum', 'Bitte ein gültiges Datum angeben.');
        return;
      }
      felder = { datum: text };
    } else felder = { [feld]: text };
    delete eigener().fehler[feld];
    const ok = await senden(felder, 'Beleg gespeichert.');
    // Only what was sent; typing on meanwhile stays a draft
    if (ok && entwuerfe[beleg.id]?.felder[feld] === text) zuruecksetzen(feld);
  }

  function taste(event: KeyboardEvent, feld: Feld): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void feldSpeichern(feld);
    } else if (event.key === 'Escape') {
      zuruecksetzen(feld);
    }
  }

  /** A free name for „Bezahlt von“ is typed; it saves on the version the row had then. */
  function nameTippen(text: string): void {
    const eigen = eigener();
    if (eigen.basis === null) eigen.basis = beleg.etag;
    eigen.name = text;
  }

  function nameVerwerfen(): void {
    const eigen = entwuerfe[beleg.id];
    if (eigen) {
      eigen.name = null;
      delete eigen.fehler.bezahlt;
      if (!Object.keys(eigen.felder).length) eigen.basis = null;
      aufraeumen();
    }
    wahl = beleg.bezahltVonId !== null ? `m:${beleg.bezahltVonId}` : 'text';
    name = beleg.bezahltVonText;
  }

  async function bezahltSpeichern(mitglied: number | null, text: string): Promise<void> {
    if (entwuerfe[beleg.id]) delete entwuerfe[beleg.id].fehler.bezahlt;
    if (mitglied === null && !text.trim()) {
      setzeFehler('bezahlt', 'Bitte angeben, wer bezahlt hat.');
      return;
    }
    if (
      mitglied === beleg.bezahltVonId &&
      (mitglied !== null || text.trim() === beleg.bezahltVonText)
    ) {
      nameVerwerfen();
      return;
    }
    const ok = await senden(
      { bezahltVonId: mitglied, bezahltVonText: mitglied === null ? text : '' },
      'Beleg gespeichert.'
    );
    // A name typed on meanwhile stays a draft
    if (ok && (mitglied !== null || entwuerfe[beleg.id]?.name === text)) nameVerwerfen();
  }

  async function erstatten(feld: HTMLInputElement): Promise<void> {
    const erstattet = feld.checked;
    const ok = await senden(
      { erstattet },
      erstattet ? 'Als erstattet markiert.' : '„Erstattet“ aufgehoben.'
    );
    if (!ok) feld.checked = beleg.erstattet;
  }

  async function loeschen(): Promise<void> {
    if (!(await gespeichert())) return;
    const { id, etag } = beleg;
    const was = [beleg.haendler, euro(beleg.betragCent)].filter(Boolean).join(' über ');
    if (
      !(await confirmAction({
        title: `Beleg ${was} löschen?`,
        message: beleg.foto ? 'Das Foto wird mit gelöscht.' : 'Der Beleg verschwindet für alle.',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/belege/${id}`, undefined, etag),
      'Beleg gelöscht.'
    );
  }

  const zelle = 'px-1.5 py-1 align-middle max-md:block max-md:px-0';
  const eingabe = 'form-input mt-0 min-h-8 px-1.5 py-0.5 text-sm any-pointer-coarse:min-h-11';
</script>

{#snippet textFeld(feld: Feld, label: string, klasse: string, typ = 'text', max = 100)}
  <input
    type={typ}
    class="{eingabe} {klasse}"
    aria-label="{label}, Beleg vom {formatIsoDate(beleg.datum)}"
    placeholder={label}
    aria-invalid={fehler[feld] ? 'true' : undefined}
    title={fehler[feld]}
    maxlength={typ === 'text' ? max : undefined}
    max={typ === 'date' ? todayIso() : undefined}
    inputmode={feld === 'betrag' ? 'decimal' : undefined}
    value={wert(feld)}
    oninput={(event) => tippen(feld, event.currentTarget.value)}
    onkeydown={(event) => taste(event, feld)}
    onblur={() => void feldSpeichern(feld)}
  />
{/snippet}

<!-- On a phone each receipt is a small card of two columns; the header row is hidden -->
<tr
  class="border-t border-neutral-200 max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-center max-md:gap-x-2 max-md:py-2 {beleg.erstattet
    ? 'bg-neutral-50'
    : ''}"
>
  {#if bearbeiten}
    <td class={zelle}>{@render textFeld('datum', 'Datum', 'w-[8.5rem]', 'date')}</td>
    <td class={zelle}>{@render textFeld('haendler', 'Händler oder was', 'w-full md:min-w-36')}</td>
    <td class="{zelle} text-right"
      >{@render textFeld('betrag', 'Betrag in €', 'w-24 text-right')}</td
    >
    <td class="{zelle} md:min-w-44">
      <BezahltVonFeld
        id="beleg-{beleg.id}-bezahlt"
        label="Bezahlt von, Beleg vom {formatIsoDate(beleg.datum)}"
        mitglieder={kontext.ansicht.mitglieder}
        bisher={beleg.bezahltVonId}
        bisherName={beleg.bezahltVon}
        bind:wahl
        bind:text={name}
        disabled={speichert}
        invalid={!!fehler.bezahlt}
        onwahl={(neu) => void bezahltSpeichern(Number(neu.slice(2)), '')}
        ontextwahl={nameTippen}
        ontext={(text) => void bezahltSpeichern(null, text)}
        onescape={nameVerwerfen}
      />
      {#if fehler.bezahlt}<span class="text-xs text-danger">{fehler.bezahlt}</span>{/if}
    </td>
    <td class={zelle}>
      <label
        class="inline-flex cursor-pointer items-center gap-1.5 text-sm any-pointer-coarse:min-h-11"
        title={beleg.erstattet && beleg.erstattetVon ? `von ${beleg.erstattetVon}` : undefined}
      >
        <input
          type="checkbox"
          class="size-4"
          checked={beleg.erstattet}
          disabled={speichert}
          onchange={(event) => void erstatten(event.currentTarget)}
        />
        <span class={beleg.erstattet ? 'text-success' : 'text-neutral-700'}
          >{beleg.erstattet ? 'erstattet' : 'offen'}</span
        >
      </label>
    </td>
    <td class={zelle}>{@render textFeld('notiz', 'Notiz', 'w-full md:min-w-32', 'text', 500)}</td>
  {:else}
    <td class="{zelle} whitespace-nowrap">{formatIsoDate(beleg.datum)}</td>
    <td class="{zelle} [overflow-wrap:anywhere]">{beleg.haendler || '–'}</td>
    <td class="{zelle} text-right whitespace-nowrap tabular-nums">{euro(beleg.betragCent)}</td>
    <td class={zelle}>{beleg.bezahltVon}</td>
    <td class="{zelle} {beleg.erstattet ? 'text-success' : 'text-neutral-700'}"
      >{beleg.erstattet ? 'erstattet' : 'offen'}</td
    >
    <td class="{zelle} [overflow-wrap:anywhere]">{beleg.notiz}</td>
  {/if}
  <td class={zelle}>
    {#if beleg.foto}
      <BelegVorschau {kontext} {beleg} onoeffnen={onansehen} />
    {:else if bearbeiten}
      <ActionButton
        class="min-h-8 px-2 py-0.5 text-xs any-pointer-coarse:min-h-11"
        aria-label="Foto hinzufügen, Beleg vom {formatIsoDate(beleg.datum)}"
        onclick={onfoto}>+ Foto</ActionButton
      >
    {:else}
      <span class="text-xs text-neutral-700">ohne</span>
    {/if}
  </td>
  {#if bearbeiten}
    <td class="{zelle} whitespace-nowrap">
      <div class="flex gap-1">
        {#if beleg.foto}
          <ActionButton
            class="min-h-8 px-2 py-0.5 text-xs any-pointer-coarse:min-h-11"
            aria-label="Foto ersetzen, Beleg vom {formatIsoDate(beleg.datum)}"
            onclick={onfoto}>Foto ändern</ActionButton
          >
        {/if}
        <ActionButton
          variant="danger"
          class="min-h-8 px-2 py-0.5 text-xs any-pointer-coarse:min-h-11"
          aria-label="Beleg vom {formatIsoDate(beleg.datum)} löschen"
          disabled={speichert || kontext.busy}
          onclick={() => void loeschen()}>Löschen</ActionButton
        >
      </div>
    </td>
  {/if}
</tr>
