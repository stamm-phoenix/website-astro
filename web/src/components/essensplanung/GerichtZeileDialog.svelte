<script lang="ts" module>
  import type { GerichtEinheit as Einheit } from '../../../../api/lib/essen-gerichte-model';

  /** What was typed in the row of a new line, taken over into the dialog. */
  export interface ZeilenVorgabe {
    name: string;
    menge: string;
    einheit: Einheit | null;
    hinweis: string;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import GrammRechner from './GrammRechner.svelte';
  import ZeileUnvertraeglichkeiten from './ZeileUnvertraeglichkeiten.svelte';
  import FormField from '../pflege/FormField.svelte';
  import KiUmrechnung from './KiUmrechnung.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    getippteZutat,
    istNeueZutat,
    mitNeuerZutat,
    nurNeu,
    gewaehlteZutat,
    gleicherName,
    leseMenge,
    mengeFeld,
    zutatVorschlaege,
    zutatWahl,
    type ZutatWahl,
  } from '../../lib/essensplanungGerichte';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import { eigeneEinheiten } from '../../lib/essensplanungEinheiten';
  import EinheitFeld from './EinheitFeld.svelte';
  import ZeileGeschaeftFeld from './ZeileGeschaeftFeld.svelte';
  import type { EssenEinheitenart } from '../../../../api/lib/essen-schema';
  import type {
    EssenKatalog,
    Gericht,
    GerichtEinheit,
    GerichtZutat,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';

  /**
   * Adds or changes a line of a dish: the ingredient from the list or the Planung (a name in
   * neither becomes a new one of the Planung's own, filled in by the AI), amount and unit, for whom it is, the intolerances and the shop of the
   * ingredient.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog;
    gericht: Gericht;
    /** The line to change; null adds a new one. */
    zeile: GerichtZutat | null;
    /** What was typed in the row of a new line, taken over into the dialog. */
    vorgabe?: ZeilenVorgabe | null;
    open: boolean;
    onclose: () => void;
  }
  let { kontext, katalog, gericht, zeile, vorgabe = null, open, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let auswahl = $state<ZutatWahl | null>(null);
  let zutatText = $state('');
  let menge = $state('');
  let einheit = $state<GerichtEinheit>('g');
  let hinweis = $state('');
  let fest = $state(false);
  let fuerAlles = $state(true);
  let fuerVegetarisch = $state(true);
  let fuerVegan = $state(true);
  /** Per intolerance: '' for everyone, 'ohne' (not for) or 'nur' (only for). */
  let unvertraeglich = $state<Record<number, '' | 'ohne' | 'nur'>>({});
  let felder = $state<Record<string, string>>({});
  /** Why the last save failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  let geschaeftFeld = $state<ZeileGeschaeftFeld>();

  /** Fills the form whenever the dialog opens; later changes of others leave it alone. */
  $effect(() => {
    if (open) untrack(fuelle);
  });

  /** The version of the line when the dialog opened. */
  let zeileEtag = '';

  function fuelle(): void {
    zeileEtag = zeile?.etag ?? '';
    felder = {};
    fehler = null;
    geoeffnet++;
    neuGewaehlt = false;
    geaendert = false;
    const z = zeile;
    if (z) {
      const zutat = ansicht.zutaten.find((entry) => entry.id === z.planungZutatId);
      auswahl = { art: 'planung', id: z.planungZutatId };
      zutatText = zutat?.name ?? '';
      menge = mengeFeld(z.menge);
      einheit = z.einheit ?? 'g';
      hinweis = z.hinweis;
      fest = z.fest;
      fuerAlles = z.fuerAlles;
      fuerVegetarisch = z.fuerVegetarisch;
      fuerVegan = z.fuerVegan;
      unvertraeglich = Object.fromEntries([
        ...z.ohne.map((id) => [id, 'ohne'] as const),
        ...z.nur.map((id) => [id, 'nur'] as const),
      ]);
    } else {
      auswahl = null;
      zutatText = vorgabe?.name ?? '';
      menge = vorgabe?.menge ?? '';
      einheit = vorgabe?.einheit ?? 'g';
      hinweis = vorgabe?.hinweis ?? '';
      const treffer = zutatText ? getippteZutat(vorschlaege, zutatText) : undefined;
      if (treffer) auswahl = zutatWahl(treffer);
      // Typed in the row already: closing asks before it is lost
      geaendert = Boolean(vorgabe && (vorgabe.name || vorgabe.menge || vorgabe.hinweis));
      fest = false;
      fuerAlles = fuerVegetarisch = fuerVegan = true;
      unvertraeglich = {};
    }
  }
  $effect(() => guardUnsavedChanges(() => open && geaendert));

  const vorschlaege = $derived(zutatVorschlaege(katalog, ansicht.zutaten));

  /** The chosen ingredient, as it applies in this Planung. */
  const gewaehlt = $derived(gewaehlteZutat(auswahl, ansicht.zutaten, katalog));
  /** The kind of unit of the chosen ingredient. */
  const einheitenart = $derived<EssenEinheitenart | null>(gewaehlt?.einheitenart ?? null);
  const einheiten = $derived<readonly string[]>(einheitenart ? EINHEITEN_JE_ART[einheitenart] : []);

  /** The central ingredient behind the choice, for converting TL, EL or pieces into grams. */
  const zentral = $derived.by(() => {
    if (einheitenart !== 'masse' || !gewaehlt) return undefined;
    const zentralId = 'zutatId' in gewaehlt ? gewaehlt.zutatId : gewaehlt.id;
    return katalog.zutaten.find((z) => z.id === zentralId);
  });
  /** Opening again starts the conversion afresh. */
  let geoeffnet = $state(0);
  function uebernehmen(gramm: number): void {
    menge = mengeFeld(gramm);
    einheit = 'g';
    geaendert = true;
  }
  const passendeEinheit = (): void => {
    if (einheiten.length && !einheiten.includes(einheit)) einheit = einheiten[0];
  };
  // Without an amount the unit follows the ingredient; a typed amount keeps its unit, also when
  // others change the ingredient meanwhile, as any unit fits
  $effect(() => {
    if (!menge.trim()) passendeEinheit();
  });
  /** TL, EL or pieces typed: the conversion into grams starts with them. */
  const umrechnenVon = $derived.by(() => {
    const mass = ({ TL: 'tl', EL: 'el', stueck: 'stueck' } as const)[einheit];
    return mass && menge.trim() ? { anzahl: menge.trim(), mass } : undefined;
  });

  function waehle(option: Vorschlag): void {
    neuGewaehlt = istNeueZutat(option);
    if (neuGewaehlt) {
      auswahl = null;
      geaendert = true;
    } else nimm(option);
    zutatText = option.value;
  }

  /** „… neu anlegen“ was picked for the name as it stands. */
  let neuGewaehlt = $state(false);

  function nimm(option: Vorschlag): void {
    auswahl = zutatWahl(option);
    geaendert = true;
    // An explicit choice: its unit, e.g. kg instead of ml after picking flour, unless an amount is
    // typed already
    if (!menge.trim()) passendeEinheit();
  }

  /** A typed name of the list counts as chosen; the text stays as typed. */
  function getippt(text: string): void {
    geaendert = true;
    neuGewaehlt = false;
    const treffer = getippteZutat(vorschlaege, text);
    if (treffer) nimm(treffer);
    else auswahl = null;
  }

  /** The chosen ingredient once it is in the Planung, with its shop. */
  const planungZutat = $derived(gewaehlt && 'geschaeftId' in gewaehlt ? gewaehlt : undefined);

  /** A name in neither list: saving adds it as an ingredient of the Planung's own. */
  const ohneTreffer = $derived(!auswahl && nurNeu(vorschlaege, zutatText));

  /** True while saving; the form is disabled meanwhile. */
  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert) return;
    speichert = true;
    try {
      await speichereFormular();
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(): Promise<void> {
    felder = {};
    fehler = null;
    const zahl = leseMenge(menge);
    if (Number.isNaN(zahl)) felder.menge = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
    if (zahl !== null && !einheit)
      felder.einheit = 'Bitte eine Einheit eintragen, z. B. g oder Bund.';
    const name = zutatText.trim();
    if (!auswahl && !name) felder.zutat = 'Bitte eine Zutat wählen oder ihren Namen eintragen.';
    // A half-typed name of the list („Zwieb“) is no new ingredient unless picked as one
    else if (!auswahl && !neuGewaehlt && !nurNeu(vorschlaege, name))
      felder.zutat = `Wähle eine Zutat aus der Liste oder ganz unten „${name}“ neu anlegen.`;
    if (Object.keys(felder).length) return;

    const ziel = auswahl;
    // The shop before the line, so a failure there leaves the line unsaved; a new one of the
    // central list or a new name is in the Planung only with its line
    const vorher = await geschaeftFeld?.vorDerZeile(
      !ziel
        ? undefined
        : ziel.art === 'planung'
          ? ziel.id
          : ansicht.zutaten.find((z) => z.zutatId === ziel.id)?.id
    );
    if (vorher && !vorher.ok) {
      if (!vorher.feld) fehler = kontext.fehler;
      return;
    }
    let abgelehnt: unknown = null;
    const body = {
      ...(!ziel
        ? { neueZutat: name }
        : ziel.art === 'planung'
          ? { planungZutatId: ziel.id }
          : { zutatId: ziel.id }),
      menge: zahl,
      einheit: zahl === null ? null : einheit,
      fest: zahl !== null && fest,
      fuerAlles,
      fuerVegetarisch,
      fuerVegan,
      ohne: Object.entries(unvertraeglich)
        .filter(([, art]) => art === 'ohne')
        .map(([id]) => Number(id)),
      nur: Object.entries(unvertraeglich)
        .filter(([, art]) => art === 'nur')
        .map(([id]) => Number(id)),
      hinweis,
    };
    // A line opened for a change is saved with the version the form started from: a change of
    // others meanwhile is a conflict, a deletion stays one (never a new line)
    const ok = await kontext.aendern(
      async () => {
        try {
          return zeile
            ? await kontext.api.senden('PATCH', `/gericht-zutaten/${zeile.id}`, {
                ...body,
                etag: zeileEtag,
              })
            : await kontext.api.senden('POST', `/gerichte/${gericht.id}/zutaten`, body);
        } catch (error: unknown) {
          abgelehnt = error;
          if (error instanceof ApiError && error.fields) felder = error.fields;
          throw error;
        }
      },
      zeile
        ? `${name} geändert.`
        : ziel
          ? `${name} hinzugefügt.`
          : `${name} als neue Zutat hinzugefügt.`
    );
    if (ok) {
      const neu = !ziel
        ? ansicht.zutaten.find((z) => gleicherName(z.name, name))
        : ansicht.zutaten.find((z) => ziel.art === 'zentral' && z.zutatId === ziel.id);
      // The line is saved: the dialog closes also when the shop fails, the page says why
      if (neu && geschaeftFeld?.nachDerZeile())
        await geschaeftFeld.setzen(neu.id, `${zutatText} hinzugefügt.`);
      zu();
      return;
    }
    if (!Object.keys(felder).length) fehler = kontext.fehler;
    // Only after a conflict does saving again take the input over what is saved now; another
    // error keeps the version, so a change of others meanwhile stays a conflict
    const jetzt = zeile
      ? ansicht.gerichte.flatMap((g) => g.zutaten).find((z) => z.id === zeile!.id)
      : null;
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) zeileEtag = jetzt.etag;
  }

  /** Closed on purpose (saved or discarded), not taken away by a deletion of others. */
  let geschlossen = false;
  function zu(): void {
    geschlossen = true;
    geaendert = false;
    onclose();
  }

  // The dish or the line is deleted by someone else while the dialog is open: the dialog goes,
  // so the input is shown to copy
  $effect(() => () => {
    if (geschlossen || !geaendert) return;
    const eingabe = [
      zutatText.trim(),
      menge.trim() && `${menge.trim()} ${einheitText(einheit)}`,
      hinweis.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    const text = `Die Zutat konnte nicht mehr gespeichert werden, das Gericht wurde gelöscht. Deine Eingabe: ${eingabe}`;
    setTimeout(() => kontext.hinweis(text, 'error'));
  });

  /** Closing with unsaved input asks first; not while saving. */
  async function schliessen(): Promise<void> {
    if (kontext.busy) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Deine Eingaben an dieser Zutat sind noch nicht gespeichert.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    zu();
  }
</script>

<ModalDialog
  {open}
  title={zeile ? 'Zutat ändern' : `Zutat für ${gericht.name}`}
  closeDisabled={kontext.busy}
  onclose={() => void schliessen()}
>
  <form
    class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    onsubmit={speichern}
    oninput={() => (geaendert = true)}
  >
    <!-- Disabled while saving, so nothing typed meanwhile gets lost -->
    <fieldset class="min-w-0 space-y-4" disabled={speichert}>
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <FormField id="zeile-zutat" label="Zutat" error={felder.zutat}>
        {#snippet children(attrs)}
          <VorschlagFeld
            {...attrs}
            options={mitNeuerZutat(vorschlaege, zutatText)}
            bind:value={zutatText}
            listLabel="Zutaten"
            placeholder="z. B. Spaghetti"
            pickFirstOnEnter
            onpick={waehle}
            onedit={getippt}
            autocomplete="off"
          />
        {/snippet}
      </FormField>
      {#if ohneTreffer}
        <p class="text-sm text-neutral-700" role="status">
          „{zutatText.trim()}“ wird als neue Zutat angelegt.
        </p>
      {/if}

      <div class="grid grid-cols-2 gap-3">
        <FormField
          id="zeile-menge"
          label="Menge"
          error={felder.menge}
          info="Leer lassen für Zutaten nach Augenmaß, z. B. Pfeffer."
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              inputmode="decimal"
              autocomplete="off"
              placeholder="z. B. 1,5"
              bind:value={menge}
            />
          {/snippet}
        </FormField>
        <FormField id="zeile-einheit" label="Einheit" error={felder.einheit}>
          {#snippet children(attrs)}
            <EinheitFeld
              id={attrs.id}
              bind:einheit
              art={einheitenart}
              eigene={eigeneEinheiten(ansicht)}
              abtropfgewicht={gewaehlt?.abtropfgewicht}
              invalid={Boolean(felder.einheit)}
              disabled={!menge.trim()}
              describedby={attrs['aria-describedby']}
              onedit={() => (geaendert = true)}
            />
          {/snippet}
        </FormField>
      </div>
      {#if zentral}
        {#key geoeffnet}<GrammRechner
            {zentral}
            vorgabe={umrechnenVon}
            onuebernehmen={uebernehmen}
          />{/key}
      {/if}
      {#if gewaehlt && einheitenart === 'masse'}
        {#key geoeffnet}<KiUmrechnung
            {kontext}
            {katalog}
            zutat={gewaehlt}
            vorgabe={umrechnenVon}
            onuebernehmen={uebernehmen}
          />{/key}
      {/if}
      <FormField id="zeile-hinweis" label="Hinweis" optional error={felder.hinweis}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="100"
            placeholder="z. B. eine Prise"
            bind:value={hinweis}
          />
        {/snippet}
      </FormField>
      <!-- Without people all amounts of the dish are fixed; the box would change nothing -->
      {#if gericht.personen !== null}
        <div class="flex items-center gap-1">
          <label class="flex min-h-11 items-center gap-3">
            <input type="checkbox" bind:checked={fest} disabled={!menge.trim()} />
            <span>Feste Menge</span>
          </label>
          <InfoHint
            label="Feste Menge"
            text="Die Menge gilt für das ganze Gericht und wächst nicht mit den Personen, z. B. 150 g Vanillepaste für den ganzen Pudding."
          />
        </div>
      {/if}

      <fieldset class="space-y-1">
        <legend class="form-label">Für wen</legend>
        {#if felder.fuer}<p class="text-sm text-danger">{felder.fuer}</p>{/if}
        <div class="flex flex-wrap gap-x-5">
          <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" bind:checked={fuerAlles} /> mit allem
          </label>
          <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" bind:checked={fuerVegetarisch} /> vegetarisch
          </label>
          <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" bind:checked={fuerVegan} /> vegan
          </label>
        </div>
      </fieldset>

      <ZeileUnvertraeglichkeiten {katalog} bind:unvertraeglich fehler={felder.nur ?? felder.ohne} />

      {#key geoeffnet}<ZeileGeschaeftFeld
          bind:this={geschaeftFeld}
          {kontext}
          zutat={planungZutat}
          onedit={() => (geaendert = true)}
        />{/key}

      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {zeile ? 'Speichern' : 'Hinzufügen'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
