<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    ernaehrung,
    fuerText,
    leseMenge,
    mengeFeld,
    zeileBody,
  } from '../../lib/essensplanungGerichte';
  import { allergeneText, unvertraeglichkeitenText } from '../../lib/essensplanungDruck';
  import {
    EINHEITEN_JE_ART,
    einheitText,
    mengeText,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit, GerichtZutat, PlanungZutat } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * One line of a dish. Amount, unit and note are edited right in the row, like in a sheet, and
   * saved when the row is left or Enter is pressed; the rest (for whom, intolerances, fixed) in
   * the dialog behind „Ändern“. While the row has focus, changes of others do not overwrite it.
   */

  interface Props {
    kontext: PlanKontext;
    zeile: GerichtZutat;
    zutat: PlanungZutat | undefined;
    bearbeiten: boolean;
    erste: boolean;
    letzte: boolean;
    /** Names of the intolerances; empty while not loaded. */
    namen: Map<number, string>;
    /** Whether the central lists are loaded, which the dialog needs. */
    katalogDa: boolean;
    onaendern: () => void;
    onverschiebe: (position: number) => void;
    onloeschen: () => void;
    /** Position of the line in its dish, from 1. */
    position: number;
  }
  let {
    kontext,
    zeile,
    zutat,
    bearbeiten,
    erste,
    letzte,
    namen,
    katalogDa,
    onaendern,
    onverschiebe,
    onloeschen,
    position,
  }: Props = $props();

  const name = $derived(zutat?.name ?? 'Zutat');
  const enthalten = $derived(allergeneText(zeile, zutat, namen));
  const einheiten = $derived.by((): readonly GerichtEinheit[] => {
    const art = zutat?.einheitenart;
    const passend = art ? EINHEITEN_JE_ART[art] : [];
    // A unit saved before the kind of unit changed stays choosable, so nothing jumps
    return zeile.einheit && !passend.includes(zeile.einheit)
      ? [...passend, zeile.einheit]
      : passend;
  });

  let menge = $state('');
  let einheit = $state<GerichtEinheit>('g');
  let hinweis = $state('');
  let fokus = $state(false);
  let fehler = $state<string | null>(null);
  /** The saved values the input started from. */
  let basis = $state({ menge: '', einheit: 'g' as GerichtEinheit, hinweis: '' });
  /** Typed but not saved yet, or saving; changes of others then leave the fields alone. */
  let entwurf = $state(false);

  function uebernehme(current: GerichtZutat): void {
    basis = {
      menge: mengeFeld(current.menge),
      einheit: current.einheit ?? einheiten[0] ?? 'g',
      hinweis: current.hinweis,
    };
    menge = basis.menge;
    einheit = basis.einheit;
    hinweis = basis.hinweis;
    fehler = null;
  }

  const geaendert = $derived(
    menge.trim() !== basis.menge ||
      hinweis.trim() !== basis.hinweis ||
      (menge.trim() !== '' && einheit !== basis.einheit)
  );
  $effect(() => guardUnsavedChanges(() => entwurf || geaendert));

  // Follow the saved state unless the user is in the row or has unsaved input
  $effect(() => {
    const current = zeile;
    untrack(() => {
      if (!fokus && !entwurf && !geaendert) uebernehme(current);
    });
  });

  async function speichern(): Promise<void> {
    fehler = null;
    if (!geaendert) return;
    const zahl = leseMenge(menge);
    if (Number.isNaN(zahl)) {
      fehler = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
      return;
    }
    // Someone else saved this line meanwhile: keep the input and let the person decide
    if (
      mengeFeld(zeile.menge) !== basis.menge ||
      (zeile.einheit ?? basis.einheit) !== basis.einheit ||
      zeile.hinweis !== basis.hinweis
    ) {
      basis = {
        menge: mengeFeld(zeile.menge),
        einheit: zeile.einheit ?? basis.einheit,
        hinweis: zeile.hinweis,
      };
      fehler = `Jemand anderes hat ${name} gerade geändert (jetzt ${mengeText(zeile.menge, zeile.einheit) ?? 'nach Gefühl'}). Deine Eingabe steht noch in der Zeile; drücke Enter, um sie zu speichern.`;
      return;
    }
    entwurf = true;
    const ok = await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/gericht-zutaten/${zeile.id}`, {
        ...zeileBody(zeile),
        menge: zahl,
        einheit: zahl === null ? null : einheit,
        fest: zahl !== null && zeile.fest,
        hinweis: hinweis.trim(),
      })
    );
    entwurf = false;
    if (ok) {
      if (!fokus) uebernehme(zeile);
      else
        basis = {
          menge: mengeFeld(zeile.menge),
          einheit: zeile.einheit ?? einheit,
          hinweis: zeile.hinweis,
        };
    } else fehler = kontext.fehler;
  }

  /** Leaving the row saves; moving between its own fields does not. */
  function verlassen(event: FocusEvent): void {
    const zeileElement = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && zeileElement.contains(event.relatedTarget)) return;
    fokus = false;
    void speichern();
  }

  function taste(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void speichern();
    } else if (event.key === 'Escape' && geaendert) {
      event.stopPropagation();
      uebernehme(zeile);
    }
  }
</script>

<li class="space-y-1 py-2">
  {#if bearbeiten}
    <div
      class="grid grid-cols-[5rem_6.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_5rem_6.5rem_minmax(0,1fr)_auto]"
      role="group"
      aria-label="Zeile {position}: {name}"
      onfocusin={() => (fokus = true)}
      onfocusout={verlassen}
    >
      <p class="col-span-3 font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:col-span-1">
        {name}
      </p>
      <label class="sr-only" for="zeile-{zeile.id}-menge">Menge von {name}</label>
      <input
        id="zeile-{zeile.id}-menge"
        class="form-input tabular-nums"
        inputmode="decimal"
        placeholder="nach Gefühl"
        bind:value={menge}
        onkeydown={taste}
      />
      <label class="sr-only" for="zeile-{zeile.id}-einheit">Einheit von {name}</label>
      <select
        id="zeile-{zeile.id}-einheit"
        class="form-input"
        bind:value={einheit}
        disabled={!einheiten.length}
        onkeydown={taste}
      >
        {#each einheiten as wert (wert)}
          <option value={wert}>{einheitText(wert, zutat?.abtropfgewicht)}</option>
        {/each}
      </select>
      <label class="sr-only" for="zeile-{zeile.id}-hinweis">Hinweis zu {name}</label>
      <input
        id="zeile-{zeile.id}-hinweis"
        class="form-input"
        maxlength="200"
        placeholder="Hinweis"
        bind:value={hinweis}
        onkeydown={taste}
      />
      <div class="col-span-3 flex flex-wrap gap-1 sm:col-span-1 print:hidden">
        <ActionButton
          type="button"
          aria-label="{name} nach oben"
          disabled={kontext.busy || erste}
          onclick={() => onverschiebe(position - 1)}>↑</ActionButton
        >
        <ActionButton
          type="button"
          aria-label="{name} nach unten"
          disabled={kontext.busy || letzte}
          onclick={() => onverschiebe(position + 1)}>↓</ActionButton
        >
        <ActionButton
          type="button"
          aria-label="{name} ändern"
          disabled={!katalogDa}
          onclick={onaendern}>Ändern</ActionButton
        >
        <ActionButton
          type="button"
          variant="danger"
          aria-label="{name} entfernen"
          disabled={kontext.busy}
          onclick={onloeschen}>✕</ActionButton
        >
      </div>
    </div>
    {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
  {:else}
    <p class="text-neutral-900 [overflow-wrap:anywhere]">
      {#if zeile.menge !== null}
        <span class="font-semibold tabular-nums"
          >{mengeText(zeile.menge, zeile.einheit, zutat?.abtropfgewicht)}</span
        >
      {/if}
      {name}
      {#if zeile.hinweis}<span class="text-neutral-700">({zeile.hinweis})</span>{/if}
    </p>
  {/if}
  <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
    {#if zeile.fest}<span>feste Menge</span>{/if}
    {#if fuerText(zeile)}<span>{fuerText(zeile)}</span>{/if}
    {#if zeile.nur.length}<span>nur bei {unvertraeglichkeitenText(zeile.nur, namen)}</span>{/if}
    {#if zeile.ohne.length}<span>nicht bei {unvertraeglichkeitenText(zeile.ohne, namen)}</span>{/if}
    {#if enthalten}<span>enthält {enthalten}</span>{/if}
    {#if zutat && ernaehrung(zutat) === 'nicht vegetarisch'}<span>nicht vegetarisch</span>{/if}
  </p>
</li>
