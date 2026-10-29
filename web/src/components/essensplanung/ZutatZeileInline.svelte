<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { nachDemTippen } from '../../lib/nachDemTippen';
  import {
    ernaehrung,
    fuerText,
    gleicheZeile,
    leseMenge,
    mengeFeld,
    zeileBody,
    type ZeilenInhalt,
  } from '../../lib/essensplanungGerichte';
  import { allergeneText, unvertraeglichkeitenText } from '../../lib/essensplanungDruck';
  import {
    EINHEITEN_JE_ART,
    einheitText,
    mengeText,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { GerichtEinheit, GerichtZutat, PlanungZutat } from '../../lib/types';
  import { meldeVerloren, merkeSpeichern, type PlanKontext } from './planKontext';

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
    /** Asks and removes the line; whether it was removed. */
    onloeschen: () => Promise<boolean>;
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
  /** The saved line the input started from, and its values as the fields show them. */
  let basis = $state({
    stand: untrack(() => zeileBody(zeile)) as ZeilenInhalt,
    menge: '',
    einheit: 'g' as GerichtEinheit,
    hinweis: '',
  });
  /** Typed but not saved yet, or saving; changes of others then leave the fields alone. */
  let entwurf = $state(false);
  /** Someone else changed the line under the input: only Enter saves it over theirs. */
  let konflikt = $state(false);

  function uebernehme(current: GerichtZutat): void {
    basis = basisVon(current, einheiten[0] ?? 'g');
    menge = basis.menge;
    einheit = basis.einheit;
    hinweis = basis.hinweis;
    fehler = null;
    konflikt = false;
  }

  /**
   * Whether the fields differ from the saved line. Amounts compare as numbers: „1.5“ typed is
   * saved and shown as „1,5“. A function too, as a derived read when the row goes may be stale.
   */
  function anders(): boolean {
    return (
      leseMenge(menge) !== leseMenge(basis.menge) ||
      hinweis.trim() !== basis.hinweis ||
      (menge.trim() !== '' && einheit !== basis.einheit)
    );
  }
  const geaendert = $derived(anders());
  $effect(() => guardUnsavedChanges(() => entwurf || geaendert));

  // Follow the saved state unless the user is in the row or has unsaved input
  $effect(() => {
    const current = zeile;
    untrack(() => {
      if (!fokus && !entwurf && !geaendert) uebernehme(current);
    });
  });

  /** The save that runs; a further one waits for it and then starts from its result. */
  let lauf: Promise<boolean> | null = null;

  /**
   * Saves typed changes; whether the row is saved afterwards. `bewusst` is Enter, the only way to
   * save over a change of others the row warned about.
   */
  async function speichern(bewusst = false): Promise<boolean> {
    while (lauf) await lauf;
    lauf = speichernJetzt(bewusst);
    try {
      return await lauf;
    } finally {
      lauf = null;
    }
  }

  /** The saved state of a line as the row compares to it. */
  function basisVon(current: GerichtZutat, einheitSonst: GerichtEinheit): typeof basis {
    return {
      stand: zeileBody(current),
      menge: mengeFeld(current.menge),
      einheit: current.einheit ?? einheitSonst,
      hinweis: current.hinweis,
    };
  }

  /** Someone else changed the line under the typed input; the input stays for Enter or Escape. */
  function warne(andereZutat: boolean): void {
    konflikt = true;
    fehler = `Jemand anderes hat ${andereZutat ? `die Zutat gerade zu ${name}` : `${name} gerade`} geändert (jetzt ${mengeText(zeile.menge, zeile.einheit) ?? 'nach Gefühl'}${zeile.hinweis ? `, ${zeile.hinweis}` : ''}). Deine Eingabe steht noch in der Zeile: Enter speichert sie trotzdem, Escape verwirft sie.`;
  }

  async function speichernJetzt(bewusst: boolean): Promise<boolean> {
    // The warning stands until Enter or Escape; leaving the row does not overwrite theirs
    if (konflikt && !bewusst) return false;
    konflikt = false;
    fehler = null;
    if (!geaendert) {
      // A change of others that came in while the row had focus shows now
      if (!fokus && !entwurf) uebernehme(zeile);
      return true;
    }
    const zahl = leseMenge(menge);
    if (Number.isNaN(zahl)) {
      fehler = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
      return false;
    }
    // Someone else saved this line meanwhile: keep the input and let the person decide. Every
    // part counts: an amount typed for sugar must not go to salt, nor become fixed, unasked
    const geprueft = basis.stand;
    if (!gleicheZeile(zeile, geprueft)) {
      basis = basisVon(zeile, basis.einheit);
      warne(zeile.planungZutatId !== geprueft.planungZutatId);
      return false;
    }
    entwurf = true;
    const gesendet = { menge: menge.trim(), einheit, hinweis: hinweis.trim() };
    // Changes wait in a queue: when it is the turn of this one, the newer version is taken only
    // if the line still says what was checked (e.g. only moved meanwhile); a change of others
    // makes it send the checked version, which the server refuses
    const etag = zeile.etag;
    const body = {
      ...geprueft,
      menge: zahl,
      einheit: zahl === null ? null : gesendet.einheit,
      fest: zahl !== null && geprueft.fest,
      hinweis: gesendet.hinweis,
    };
    const ok = await kontext.aendern(() => {
      const current = zeile;
      return kontext.api.senden('PATCH', `/gericht-zutaten/${current.id}`, {
        ...body,
        etag: gleicheZeile(current, geprueft) ? current.etag : etag,
      });
    }, `${name} gespeichert.`);
    entwurf = false;
    if (ok) {
      // Typed on while it saved: that input stays and counts as changed against the saved state
      const weitergetippt =
        menge.trim() !== gesendet.menge ||
        hinweis.trim() !== gesendet.hinweis ||
        einheit !== gesendet.einheit;
      // The answer is read after the save and may already hold a change of others
      const eigenerStand = gleicheZeile(zeile, body);
      if (!weitergetippt && (!fokus || !eigenerStand)) uebernehme(zeile);
      else {
        basis = basisVon(zeile, gesendet.einheit);
        if (!eigenerStand) warne(zeile.planungZutatId !== geprueft.planungZutatId);
      }
    } else if (!gleicheZeile(zeile, geprueft)) {
      // Refused because others changed the line meanwhile: the same choice as above
      basis = basisVon(zeile, gesendet.einheit);
      warne(zeile.planungZutatId !== geprueft.planungZutatId);
    } else fehler = kontext.fehler;
    return ok;
  }

  /** Typed changes are saved first, so the move goes with the saved version. */
  async function verschiebe(neu: number): Promise<void> {
    if (geaendert && !(await speichern())) return;
    onverschiebe(neu);
  }

  /** The dialog starts from what the row shows, so typed changes are saved first. */
  async function aendern(): Promise<void> {
    if (geaendert && !(await speichern())) return;
    onaendern();
  }

  /** Set when this page removes the line itself, which needs no word about lost input. */
  let selbstEntfernt = false;

  /**
   * Typed changes are saved first, so removing asks with the saved version and moving the focus
   * to the question starts no save of its own.
   */
  async function entfernen(): Promise<void> {
    if (geaendert && !(await speichern())) return;
    selbstEntfernt = true;
    // Kept off only when the line went: after „Abbrechen“ the row guards its input again
    if (!(await onloeschen())) selbstEntfernt = false;
  }

  // Someone else removed the line: the row goes, so the unsaved input is shown to copy
  $effect(() => () => {
    if (selbstEntfernt || !anders()) return;
    const id = zeile.id;
    const eingabe = [
      menge.trim() ? `${menge.trim()} ${einheitText(einheit, zutat?.abtropfgewicht)}` : '',
      hinweis.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    const text = `${name} wurde gerade entfernt (deine Eingabe: ${eingabe}).`;
    // Checked after the update: the row also goes when the page closes, and during the update
    // the view may still be the old one
    setTimeout(() => {
      if (!kontext.ansicht.gerichte.some((g) => g.zutaten.some((z) => z.id === id)))
        meldeVerloren(kontext, text);
    });
  });

  /**
   * Leaving the row saves; moving between its own fields does not. A tap elsewhere gets its
   * click first, as the save blocks the buttons of the page while it runs.
   */
  function verlassen(event: FocusEvent): void {
    const zeileElement = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && zeileElement.contains(event.relatedTarget)) return;
    fokus = false;
    nachDemTippen(() => merkeSpeichern(speichern()));
  }

  function taste(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void speichern(true);
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
        maxlength="100"
        placeholder="Hinweis"
        bind:value={hinweis}
        onkeydown={taste}
      />
      <div class="col-span-3 flex flex-wrap gap-1 sm:col-span-1 print:hidden">
        <ActionButton
          type="button"
          aria-label="{name} nach oben"
          disabled={kontext.busy || erste}
          onclick={() => void verschiebe(position - 1)}>↑</ActionButton
        >
        <ActionButton
          type="button"
          aria-label="{name} nach unten"
          disabled={kontext.busy || letzte}
          onclick={() => void verschiebe(position + 1)}>↓</ActionButton
        >
        <ActionButton
          type="button"
          aria-label="{name} ändern"
          disabled={!katalogDa}
          onclick={() => void aendern()}>Ändern</ActionButton
        >
        <ActionButton
          type="button"
          variant="danger"
          aria-label="{name} entfernen"
          disabled={kontext.busy}
          onclick={() => void entfernen()}>✕</ActionButton
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
