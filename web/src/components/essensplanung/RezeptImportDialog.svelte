<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { meldeVerloren } from './planKontext';
  import {
    getippteZutat,
    leseMenge,
    mengeFeld,
    zutatVorschlaege,
    zutatWahl,
    type ZutatWahl,
  } from '../../lib/essensplanungGerichte';
  import {
    kiFehlerText,
    mengeFuerZutat,
    skaliereMenge,
    vorschauText,
    vorschlagKey,
    type VorschauMenge,
    type KiRezept,
    type KiRezeptZeile,
  } from '../../lib/essensplanungKi';
  import { EINHEITEN_JE_ART } from '../../../../api/lib/essen-gerichte-model';
  import { eigeneEinheiten } from '../../lib/essensplanungEinheiten';
  import EinheitFeld from './EinheitFeld.svelte';
  import type { EssenKatalog, Gericht, GerichtEinheit } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';

  /**
   * „Rezept einfügen“: the AI reads the ingredients of a pasted recipe and maps them onto the
   * lists. Nothing is saved before the member has checked the preview; unknown ingredients are
   * marked and left out until one of the lists is chosen. The chosen lines are added in one
   * change (`…/zutaten/sammel`).
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog;
    gericht: Gericht;
    /** False during maintenance: text and preview stay, reading and taking over wait. */
    bearbeiten: boolean;
    open: boolean;
    onclose: () => void;
  }
  let { kontext, katalog, gericht, bearbeiten, open, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  interface Zeile {
    an: boolean;
    original: string;
    zutatText: string;
    auswahl: ZutatWahl | null;
    menge: string;
    einheit: GerichtEinheit;
    hinweis: string;
    fuerAlles: boolean;
    fuerVegetarisch: boolean;
    fuerVegan: boolean;
    /** The other way to give the amount: the recipe's („20 EL“) or the converted one. */
    alternative: VorschauMenge | null;
    fehler: Record<string, string>;
  }

  let text = $state('');
  let liest = $state(false);
  let speichert = $state(false);
  let fehler = $state<string | null>(null);
  let textFehler = $state<string | undefined>(undefined);
  /** `personen`: what the amounts are for; null while the dish has no number (as written). */
  let rezept = $state<{ rezeptPersonen: number | null; personen: number | null } | null>(null);
  let zeilen = $state<Zeile[]>([]);
  /**
   * The people of the dish now, when they changed after the amounts were scaled (null: taken
   * away); undefined while nothing changed.
   */
  let personenNeu = $state<number | null | undefined>(undefined);
  /** A dish without people takes the number the recipe names, unless unticked. */
  let personenUebernehmen = $state(true);
  /** Set once the lines are taken over; nothing is left to lose then. */
  let fertig = $state(false);
  /** Set when the member closes on purpose, discarding the input. */
  let verworfen = false;
  /** What is shown: the text, or the preview of the lines read (kept while the text shows). */
  let schritt = $state<'text' | 'vorschau'>('text');
  /** The text the preview was read from; unchanged, the preview can be shown again as it is. */
  let erkannt = $state('');
  /** The lines as read, to tell which the member changed. */
  let ursprung: string[] = [];
  const schnappschuss = (zeile: Zeile): string =>
    JSON.stringify([zeile.an, zeile.zutatText, zeile.menge, zeile.einheit, zeile.hinweis]);
  /** How many lines of the preview the member changed. */
  const bearbeitet = $derived(
    zeilen.filter((zeile, index) => schnappschuss(zeile) !== ursprung[index]).length
  );

  // Someone else deleted the dish: the dialog goes, so the text is shown to copy
  $effect(() => () => {
    if (fertig || verworfen || (!text.trim() && !zeilen.length)) return;
    const id = gericht.id;
    const eingefuegt = text.trim();
    const kurz = eingefuegt.length > 1500 ? `${eingefuegt.slice(0, 1500)} …` : eingefuegt;
    // Counted here: a derived value may no longer update while the dialog goes
    const geaendert = zeilen.filter(
      (zeile, index) => schnappschuss(zeile) !== ursprung[index]
    ).length;
    const meldung = `„${gericht.name}“ wurde gerade gelöscht, das Rezept wurde nicht übernommen${
      geaendert
        ? ` (${geaendert === 1 ? 'eine bearbeitete Vorschauzeile' : `${geaendert} bearbeitete Vorschauzeilen`})`
        : ''
    }.${kurz ? ` Dein eingefügter Text: ${kurz}` : ''}`;
    // Checked after the update: the dialog also goes when the page closes
    setTimeout(() => {
      if (!kontext.ansicht.gerichte.some((g) => g.id === id)) meldeVerloren(kontext, meldung);
    });
  });
  $effect(() =>
    guardUnsavedChanges(() => open && !fertig && (text.trim() !== '' || zeilen.length > 0))
  );

  const vorschlaege = $derived(zutatVorschlaege(katalog, ansicht.zutaten));

  function zutatVon(auswahl: ZutatWahl | null) {
    if (!auswahl) return undefined;
    return auswahl.art === 'planung'
      ? ansicht.zutaten.find((z) => z.id === auswahl.id)
      : katalog.zutaten.find((z) => z.id === auswahl.id);
  }

  function einheitenartVon(auswahl: ZutatWahl | null) {
    return zutatVon(auswahl)?.einheitenart ?? null;
  }

  function einheitenVon(zeile: Zeile): readonly string[] {
    const art = einheitenartVon(zeile.auswahl);
    return art ? EINHEITEN_JE_ART[art] : [];
  }

  function zeileVon(ki: KiRezeptZeile): Zeile {
    const key = vorschlagKey(ki.zutat, ansicht.zutaten);
    const vorschlag = key ? vorschlaege.find((option) => option.key === key) : undefined;
    const zeile: Zeile = {
      an: Boolean(vorschlag),
      original: ki.original,
      zutatText: vorschlag?.value ?? ki.name,
      auswahl: vorschlag ? zutatWahl(vorschlag) : null,
      menge: mengeFeld(ki.menge),
      einheit: ki.einheit ?? 'g',
      hinweis: ki.hinweis,
      fuerAlles: ki.fuerAlles,
      fuerVegetarisch: ki.fuerVegetarisch,
      fuerVegan: ki.fuerVegan,
      alternative: ki.rezeptMenge
        ? { menge: mengeFeld(ki.rezeptMenge.menge), einheit: ki.rezeptMenge.einheit }
        : null,
      fehler: {},
    };
    // Without an amount the unit follows the ingredient; an amount keeps the recipe's unit
    const einheiten = einheitenVon(zeile);
    if (!ki.einheit && einheiten.length) zeile.einheit = einheiten[0];
    return zeile;
  }

  /** Takes the other way to give the amount, e.g. the recipe's 20 EL instead of 300 g. */
  function tausche(zeile: Zeile): void {
    if (!zeile.alternative) return;
    const vorher = { menge: zeile.menge, einheit: zeile.einheit };
    zeile.menge = zeile.alternative.menge;
    zeile.einheit = zeile.alternative.einheit;
    zeile.alternative = vorher;
  }

  async function erkennen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (liest || !bearbeiten) return;
    fehler = null;
    textFehler = text.trim() ? undefined : 'Bitte ein Rezept einfügen.';
    if (textFehler) return;
    if (
      bearbeitet &&
      !(await confirmAction({
        title: 'Zutaten neu erkennen?',
        message: 'Deine Korrekturen in der Vorschau gehen verloren.',
        confirmLabel: 'Neu erkennen',
      }))
    )
      return;
    liest = true;
    try {
      const antwort = await kontext.api.senden<KiRezept>(
        'POST',
        `/gerichte/${gericht.id}/ki/rezept`,
        { text }
      );
      rezept = { rezeptPersonen: antwort.rezeptPersonen, personen: antwort.personen };
      personenNeu = undefined;
      personenUebernehmen = true;
      zeilen = antwort.zeilen.map(zeileVon);
      ursprung = zeilen.map(schnappschuss);
      erkannt = text;
      schritt = 'vorschau';
      if (!zeilen.length) fehler = 'Die KI hat in dem Text keine Zutaten gefunden.';
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.text) textFehler = error.fields.text;
      else fehler = kiFehlerText(error);
    } finally {
      liest = false;
    }
  }

  function waehle(zeile: Zeile, option: Vorschlag): void {
    const wahl = zutatWahl(option);
    // Picking and typing the same name both land here; the second must not undo the first
    if (zeile.auswahl?.art === wahl.art && zeile.auswahl.id === wahl.id) {
      zeile.zutatText = option.value;
      return;
    }
    zeile.auswahl = wahl;
    zeile.zutatText = option.value;
    zeile.an = true;
    zeile.fehler = {};
    // Meat only for those who eat everything, as the recipe import does
    const zutat = zutatVon(zeile.auswahl);
    zeile.fuerAlles = true;
    zeile.fuerVegetarisch = zutat?.vegetarisch !== false;
    zeile.fuerVegan = zutat?.vegan !== false;
    if (!zutat) return;
    // Pieces become grams with the list's weight; any other unit stays, as it may
    const zentral = katalog.zutaten.find(
      (z) => z.id === ('zutatId' in zutat ? zutat.zutatId : zutat.id)
    );
    const neu = mengeFuerZutat(zeile, zutat.einheitenart, zentral?.grammProStueck ?? null);
    zeile.menge = neu.menge;
    zeile.einheit = neu.einheit;
    zeile.alternative = neu.alternative ?? zeile.alternative;
  }

  /** Scales the amounts to the people the dish has now, after someone changed them. */
  function umrechnen(): void {
    if (!rezept || personenNeu === undefined) return;
    // Without people the amounts are as written, i.e. for the people of the recipe if it says
    const basis = (personen: number | null) => personen ?? rezept!.rezeptPersonen;
    const von = basis(rezept.personen);
    const nach = basis(personenNeu);
    const faktor = von && nach ? nach / von : 1;
    for (const zeile of zeilen) {
      zeile.menge = skaliereMenge(zeile.menge, faktor, zeile.einheit);
      if (zeile.alternative)
        zeile.alternative.menge = skaliereMenge(
          zeile.alternative.menge,
          faktor,
          zeile.alternative.einheit
        );
    }
    rezept.personen = personenNeu;
    personenNeu = undefined;
    fehler = null;
  }

  /** After taking over: a dish still without people gets the number of the recipe. */
  async function personenSetzen(personen: number): Promise<void> {
    const jetzt = kontext.ansicht.gerichte.find((g) => g.id === gericht.id);
    if (!jetzt || jetzt.personen !== null) return;
    await kontext.aendern(
      () => kontext.api.senden('PATCH', `/gerichte/${jetzt.id}`, { etag: jetzt.etag, personen }),
      `Zutaten übernommen, ${jetzt.name} ist jetzt für ${personen} Personen.`
    );
  }

  function getippt(zeile: Zeile, eingabe: string): void {
    const treffer = getippteZutat(vorschlaege, eingabe);
    if (treffer) waehle(zeile, treffer);
    else {
      zeile.auswahl = null;
      zeile.an = false;
    }
  }

  const gewaehlt = $derived(zeilen.filter((zeile) => zeile.an && zeile.auswahl));

  async function uebernehmen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || !bearbeiten || !gewaehlt.length) return;
    fehler = null;
    for (const zeile of zeilen) zeile.fehler = {};
    const gesendet = gewaehlt;
    const body = gesendet.map((zeile) => {
      const menge = leseMenge(zeile.menge);
      if (Number.isNaN(menge))
        zeile.fehler.menge = 'Bitte eine Zahl wie 1,5 eintragen oder leer lassen.';
      else if (menge !== null && !zeile.einheit)
        zeile.fehler.einheit = 'Bitte eine Einheit eintragen, z. B. g oder Bund.';
      return {
        ...(zeile.auswahl!.art === 'planung'
          ? { planungZutatId: zeile.auswahl!.id }
          : { zutatId: zeile.auswahl!.id }),
        menge,
        einheit: menge === null ? null : zeile.einheit,
        fuerAlles: zeile.fuerAlles,
        fuerVegetarisch: zeile.fuerVegetarisch,
        fuerVegan: zeile.fuerVegan,
        hinweis: zeile.hinweis,
      };
    });
    if (gesendet.some((zeile) => Object.keys(zeile.fehler).length)) return;
    speichert = true;
    let personenKonflikt = false;
    /** Field errors of the request that belong to no line. */
    const allgemein: string[] = [];
    try {
      const ok = await kontext.aendern(
        async () => {
          try {
            // With the people the amounts are scaled for: a change meanwhile is a conflict
            return await kontext.api.senden('POST', `/gerichte/${gericht.id}/zutaten/sammel`, {
              zeilen: body,
              personen: rezept!.personen,
            });
          } catch (error: unknown) {
            if (error instanceof ApiError && error.code === 'PERSONEN_GEAENDERT')
              personenKonflikt = true;
            if (error instanceof ApiError && error.fields) {
              for (const [feld, meldung] of Object.entries(error.fields)) {
                const treffer = /^zeilen\.(\d+)\.(\w+)$/.exec(feld);
                const zeile = treffer ? gesendet[Number(treffer[1])] : undefined;
                if (zeile) zeile.fehler[treffer![2]] = meldung;
                // Not about one line, e.g. too many lines for the dish
                else allgemein.push(meldung);
              }
            }
            throw error;
          }
        },
        `${gesendet.length === 1 ? 'Eine Zutat' : `${gesendet.length} Zutaten`} übernommen.`
      );
      if (ok) {
        fertig = true;
        zeilen = [];
        const zahl =
          rezept?.personen === null && personenUebernehmen ? rezept.rezeptPersonen : null;
        onclose();
        if (zahl) await personenSetzen(zahl);
      } else if (allgemein.length) {
        fehler = `${allgemein.join(' ')} Es wurde nichts übernommen. Bitte wähle Zutaten ab und übernimm noch einmal.`;
      } else if (!zeilen.some((zeile) => Object.keys(zeile.fehler).length)) {
        fehler = kontext.fehler;
      }
      // The page loaded the dish again: the preview stays and offers to scale to its people
      if (personenKonflikt && rezept && gericht.personen !== rezept.personen)
        personenNeu = gericht.personen;
    } finally {
      speichert = false;
    }
  }

  async function schliessen(): Promise<void> {
    if (speichert) return;
    if (
      (text.trim() || zeilen.length) &&
      !(await confirmAction({
        title: 'Rezept verwerfen?',
        message: 'Die erkannten Zutaten werden nicht übernommen.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    verworfen = true;
    onclose();
  }
</script>

<ModalDialog
  {open}
  title="Rezept für {gericht.name}"
  closeDisabled={speichert}
  onclose={() => void schliessen()}
>
  {#if !rezept || schritt === 'text'}
    <form class="min-h-0 space-y-4 overflow-y-auto px-5 py-4" onsubmit={erkennen}>
      <fieldset class="min-w-0 space-y-4" disabled={liest}>
        {#if !bearbeiten}
          <p class="text-sm text-warning" role="status">
            Die Essensplanung wird gerade gewartet. Dein Text und die Vorschau bleiben; erkennen und
            übernehmen geht danach wieder.
          </p>
        {/if}
        {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
        <FormField
          id="rezept-text"
          label="Rezept"
          error={textFehler}
          info="Bitte keine Namen oder Kontaktdaten einfügen. Der Text geht zum Erkennen an Azure OpenAI (in der EU); übernommen wird erst, was du in der Vorschau bestätigst."
        >
          {#snippet children(attrs)}
            <textarea
              {...attrs}
              class="form-input min-h-48"
              maxlength="10000"
              placeholder="z. B. 500 g Spaghetti, 2 EL Olivenöl, 1 Zwiebel …"
              bind:value={text}></textarea>
          {/snippet}
        </FormField>
        <div class="flex flex-wrap justify-end gap-2">
          <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
          {#if rezept && text.trim() === erkannt.trim()}
            <!-- The same text: back to the preview with the member's changes -->
            <ActionButton type="button" onclick={() => (schritt = 'vorschau')}
              >Zur Vorschau</ActionButton
            >
          {/if}
          <ActionButton type="submit" variant="primary" disabled={!bearbeiten}
            >{liest ? 'KI liest das Rezept …' : 'Zutaten erkennen'}</ActionButton
          >
        </div>
      </fieldset>
    </form>
  {:else}
    <form class="min-h-0 space-y-4 overflow-y-auto px-5 py-4" onsubmit={uebernehmen}>
      <fieldset class="min-w-0 space-y-4" disabled={speichert}>
        <p class="text-sm text-neutral-700" role="status">
          Von der KI erkannt und ungeprüft.
          {#if rezept.personen === null}
            Die Mengen stehen wie im Rezept{rezept.rezeptPersonen
              ? ` für ${rezept.rezeptPersonen} Personen`
              : ''}.
          {:else if rezept.rezeptPersonen && rezept.rezeptPersonen !== rezept.personen}
            Die Mengen sind von {rezept.rezeptPersonen} auf {rezept.personen} Personen umgerechnet.
          {:else if !rezept.rezeptPersonen}
            Das Rezept nennt keine Personenzahl: Die Mengen stehen wie im Rezept, bitte für
            {rezept.personen} Personen anpassen.
          {/if}
          Zutaten, die nicht in der Liste stehen, sind markiert und erst nach einer Wahl dabei.
        </p>
        {#if !bearbeiten}
          <p class="text-sm text-warning" role="status">
            Die Essensplanung wird gerade gewartet. Dein Text und die Vorschau bleiben; erkennen und
            übernehmen geht danach wieder.
          </p>
        {/if}
        {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
        {#if rezept.personen === null && rezept.rezeptPersonen && personenNeu === undefined}
          <label class="flex items-center gap-2 text-sm any-pointer-coarse:min-h-11">
            <input type="checkbox" class="h-5 w-5" bind:checked={personenUebernehmen} />
            Personenzahl {rezept.rezeptPersonen} für das Gericht übernehmen
          </label>
        {/if}
        {#if personenNeu !== undefined}
          <ActionButton type="button" onclick={umrechnen}
            >{personenNeu === null
              ? 'Mengen wie im Rezept übernehmen'
              : `Mengen auf ${personenNeu} Personen umrechnen`}</ActionButton
          >
        {/if}
        <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
          {#each zeilen as zeile, index (index)}
            <li class="space-y-2 py-3" data-testid="rezept-zeile">
              <!-- The whole row is the touch area of the checkbox, at least 44 px high -->
              <label
                class="form-check-row min-w-0 cursor-pointer text-sm text-neutral-700 [overflow-wrap:anywhere]"
                data-testid="rezept-zeile-an"
              >
                <input
                  id="rezept-{index}-an"
                  type="checkbox"
                  class="form-check"
                  aria-label="{zeile.original} übernehmen"
                  disabled={!zeile.auswahl}
                  bind:checked={zeile.an}
                />
                <span>
                  Rezept: {zeile.original}
                  {#if zeile.auswahl && !(zeile.fuerVegetarisch && zeile.fuerVegan)}
                    <span>({zeile.fuerVegetarisch ? 'nicht für vegan' : 'nur für mit allem'})</span>
                  {/if}
                  {#if !zeile.auswahl}
                    <span class="font-semibold text-warning"
                      >– nicht in der Liste, bitte wählen</span
                    >
                  {/if}
                </span>
              </label>
              <div class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_7rem_minmax(0,1.5fr)]">
                <div>
                  <label class="sr-only" for="rezept-{index}-zutat"
                    >Zutat für {zeile.original}</label
                  >
                  <VorschlagFeld
                    id="rezept-{index}-zutat"
                    options={vorschlaege}
                    bind:value={zeile.zutatText}
                    listLabel="Zutaten"
                    pickFirstOnEnter
                    onpick={(option) => waehle(zeile, option)}
                    onedit={(eingabe) => getippt(zeile, eingabe)}
                    autocomplete="off"
                    aria-invalid={zeile.fehler.zutat ? 'true' : undefined}
                  />
                  {#if zeile.fehler.zutat}<p class="text-sm text-danger">
                      {zeile.fehler.zutat}
                    </p>{/if}
                </div>
                <div>
                  <label class="sr-only" for="rezept-{index}-menge"
                    >Menge für {zeile.original}</label
                  >
                  <input
                    id="rezept-{index}-menge"
                    class="form-input"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="Menge"
                    bind:value={zeile.menge}
                  />
                  {#if zeile.fehler.menge}<p class="text-sm text-danger">
                      {zeile.fehler.menge}
                    </p>{/if}
                </div>
                <div>
                  <label class="sr-only" for="rezept-{index}-einheit"
                    >Einheit für {zeile.original}</label
                  >
                  <EinheitFeld
                    id="rezept-{index}-einheit"
                    bind:einheit={zeile.einheit}
                    art={einheitenartVon(zeile.auswahl)}
                    eigene={eigeneEinheiten(ansicht)}
                    invalid={Boolean(zeile.fehler.einheit)}
                    disabled={!zeile.menge.trim()}
                  />
                  {#if zeile.fehler.einheit}<p class="text-sm text-danger">
                      {zeile.fehler.einheit}
                    </p>{/if}
                  {#if zeile.alternative}
                    <ActionButton
                      type="button"
                      class="mt-1"
                      aria-label="Für {zeile.original} stattdessen {vorschauText(
                        zeile.alternative
                      )} übernehmen"
                      onclick={() => tausche(zeile)}
                      >⇄ {vorschauText(zeile.alternative)}</ActionButton
                    >
                  {/if}
                </div>
                <div>
                  <label class="sr-only" for="rezept-{index}-hinweis"
                    >Hinweis für {zeile.original}</label
                  >
                  <input
                    id="rezept-{index}-hinweis"
                    class="form-input"
                    maxlength="100"
                    placeholder="Hinweis"
                    bind:value={zeile.hinweis}
                  />
                </div>
              </div>
            </li>
          {/each}
        </ul>
        <div class="flex flex-wrap justify-end gap-2">
          <ActionButton type="button" onclick={() => (schritt = 'text')}
            >Zurück zum Text</ActionButton
          >
          <ActionButton
            type="submit"
            variant="primary"
            disabled={!bearbeiten || !gewaehlt.length || kontext.busy}
            >{gewaehlt.length === 1
              ? 'Eine Zutat übernehmen'
              : `${gewaehlt.length} Zutaten übernehmen`}</ActionButton
          >
        </div>
      </fieldset>
    </form>
  {/if}
</ModalDialog>
