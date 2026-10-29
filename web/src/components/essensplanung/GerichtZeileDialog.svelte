<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { EINHEITENART_LABELS } from '../../lib/essensplanungSteuerung';
  import { leseMenge, mengeFeld, zutatVorschlaege } from '../../lib/essensplanungGerichte';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type {
    EssenEinheitenart,
    EssenKatalog,
    Gericht,
    GerichtEinheit,
    GerichtZutat,
    PlanungAnsicht,
  } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';

  /**
   * Adds or changes a line of a dish: the ingredient from the list or the Planung (or a new one
   * of the Planung's own), amount and unit, for whom it is, and the intolerances.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog;
    gericht: Gericht;
    /** The line to change; null adds a new one. */
    zeile: GerichtZutat | null;
    open: boolean;
    onclose: () => void;
  }
  let { kontext, katalog, gericht, zeile, open, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  type Auswahl = { art: 'zentral' | 'planung'; id: number };
  let auswahl = $state<Auswahl | null>(null);
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
  /** A new ingredient of the Planung's own, for a name that is not in the list. */
  let eigene = $state<{
    kategorieId: number | null;
    einheitenart: EssenEinheitenart | null;
    ernaehrung: '' | 'vegan' | 'vegetarisch' | 'fleisch';
    /** What it contains, unlike the intolerances below, which say for whom the line is. */
    allergene: number[];
  } | null>(null);
  let geaendert = $state(false);

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
    eigene = null;
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
      zutatText = '';
      menge = '';
      hinweis = '';
      fest = false;
      fuerAlles = fuerVegetarisch = fuerVegan = true;
      unvertraeglich = {};
    }
  }
  $effect(() => guardUnsavedChanges(() => open && geaendert));

  const vorschlaege = $derived(zutatVorschlaege(katalog, ansicht.zutaten));

  /** The chosen ingredient, as it applies in this Planung. */
  const gewaehlt = $derived.by(() => {
    if (!auswahl) return undefined;
    const id = auswahl.id;
    if (auswahl.art === 'planung') return ansicht.zutaten.find((z) => z.id === id);
    return katalog.zutaten.find((z) => z.id === id);
  });
  /** The kind of unit of the chosen ingredient. */
  const einheitenart = $derived<EssenEinheitenart | null>(
    eigene ? eigene.einheitenart : (gewaehlt?.einheitenart ?? null)
  );
  const einheiten = $derived(einheitenart ? EINHEITEN_JE_ART[einheitenart] : []);
  const passendeEinheit = (): void => {
    if (einheiten.length && !einheiten.includes(einheit)) einheit = einheiten[0];
  };
  // Without an amount the unit follows the ingredient. A typed amount keeps its unit when
  // others change the ingredient meanwhile; the field then asks for a fix
  $effect(() => {
    if (!menge.trim()) passendeEinheit();
  });
  // The kind of unit of a new own ingredient is always chosen here
  $effect(() => {
    if (eigene?.einheitenart) untrack(passendeEinheit);
  });
  /** The typed unit no longer fits the ingredient, changed by others meanwhile. */
  const einheitPasstNicht = $derived(
    menge.trim() !== '' && einheiten.length > 0 && !einheiten.includes(einheit)
  );

  function waehle(option: Vorschlag): void {
    const [art, id] = (option.key ?? '').split(':');
    auswahl = { art: art === 'p' ? 'planung' : 'zentral', id: Number(id) };
    zutatText = option.value;
    eigene = null;
    geaendert = true;
    // An explicit choice: a unit that fits it, e.g. kg instead of ml after picking flour
    passendeEinheit();
  }

  function getippt(text: string): void {
    geaendert = true;
    const treffer = vorschlaege.find(
      (option) => option.value.localeCompare(text.trim(), 'de', { sensitivity: 'base' }) === 0
    );
    if (treffer) waehle(treffer);
    else auswahl = null;
  }

  /** Chosen intolerances deleted in the Steuerung meanwhile; they are removed here. */
  const verschwunden = $derived(
    Object.entries(unvertraeglich)
      .filter(([id, art]) => art && !katalog.unvertraeglichkeiten.some((u) => u.id === Number(id)))
      .map(([id]) => Number(id))
  );

  const ohneTreffer = $derived(!auswahl && zutatText.trim().length > 1 && !eigene);

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
    if (!auswahl && !eigene) felder.zutat = 'Bitte eine Zutat aus der Liste wählen.';
    if (eigene && !eigene.kategorieId) felder.kategorie = 'Bitte eine Kategorie wählen.';
    if (eigene && !eigene.einheitenart)
      felder.einheitenart = 'Bitte wählen, worin sie gemessen wird.';
    if (Object.keys(felder).length) return;

    let ziel = auswahl;
    if (eigene) {
      const neu = eigene;
      let id = 0;
      const angelegt = await kontext.aendern(async () => {
        try {
          const antwort = await kontext.api.senden<{ id: number; ansicht: PlanungAnsicht }>(
            'POST',
            '/zutaten',
            {
              name: zutatText.trim(),
              kategorieId: neu.kategorieId,
              einheitenart: neu.einheitenart,
              vegetarisch: neu.ernaehrung === '' ? null : neu.ernaehrung !== 'fleisch',
              vegan: neu.ernaehrung === '' ? null : neu.ernaehrung === 'vegan',
              allergene: neu.allergene,
            }
          );
          id = antwort.id;
          return antwort;
        } catch (error: unknown) {
          if (error instanceof ApiError && error.fields)
            felder = { zutat: error.fields.name ?? '' };
          throw error;
        }
      });
      if (!angelegt) {
        if (!Object.keys(felder).length) fehler = kontext.fehler;
        return;
      }
      ziel = { art: 'planung', id };
      auswahl = ziel;
      eigene = null;
    }
    let abgelehnt: unknown = null;
    const body = {
      ...(ziel!.art === 'planung' ? { planungZutatId: ziel!.id } : { zutatId: ziel!.id }),
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
      zeile ? `${zutatText} geändert.` : `${zutatText} hinzugefügt.`
    );
    if (ok) {
      geaendert = false;
      onclose();
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

  // The dish or the line is deleted by someone else while the dialog is open: the dialog goes,
  // so the input is shown to copy
  $effect(() => () => {
    if (!geaendert) return;
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
    geaendert = false;
    onclose();
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
            options={vorschlaege}
            bind:value={zutatText}
            listLabel="Zutaten"
            placeholder="z. B. Spaghetti"
            onpick={waehle}
            onedit={getippt}
            autocomplete="off"
          />
        {/snippet}
      </FormField>
      {#if ohneTreffer}
        <p class="text-sm text-neutral-700">
          „{zutatText.trim()}“ steht nicht in der Liste.
          <button
            type="button"
            class="min-h-11 font-semibold text-link underline"
            onclick={() =>
              (eigene = { kategorieId: null, einheitenart: null, ernaehrung: '', allergene: [] })}
            >Als eigene Zutat dieser Planung anlegen</button
          >
        </p>
      {/if}
      {#if eigene}
        <fieldset class="space-y-3 border-l-2 border-neutral-300 pl-3">
          <legend class="form-label">Eigene Zutat „{zutatText.trim()}“</legend>
          <FormField id="eigene-kategorie" label="Kategorie" error={felder.kategorie}>
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={eigene!.kategorieId}>
                <option value={null}>Bitte wählen</option>
                {#each katalog.kategorien as kategorie (kategorie.id)}
                  <option value={kategorie.id}>{kategorie.name}</option>
                {/each}
              </select>
            {/snippet}
          </FormField>
          <FormField id="eigene-einheitenart" label="Gemessen in" error={felder.einheitenart}>
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={eigene!.einheitenart}>
                <option value={null}>Bitte wählen</option>
                {#each Object.entries(EINHEITENART_LABELS) as [art, label] (art)}
                  <option value={art}>{label}</option>
                {/each}
              </select>
            {/snippet}
          </FormField>
          <FormField id="eigene-ernaehrung" label="Ernährung">
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={eigene!.ernaehrung}>
                <option value="">Weiß ich nicht</option>
                <option value="vegan">vegan</option>
                <option value="vegetarisch">vegetarisch</option>
                <option value="fleisch">mit Fleisch oder Fisch</option>
              </select>
            {/snippet}
          </FormField>
          <fieldset>
            <legend class="form-label">Enthält</legend>
            {#if felder.allergene}<p class="text-sm text-danger">{felder.allergene}</p>{/if}
            <div class="grid gap-x-4 sm:grid-cols-2">
              {#each katalog.unvertraeglichkeiten as u (u.id)}
                <label class="flex min-h-11 items-center gap-2">
                  <input type="checkbox" value={u.id} bind:group={eigene!.allergene} />
                  {u.name}
                </label>
              {/each}
            </div>
          </fieldset>
        </fieldset>
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
        <FormField
          id="zeile-einheit"
          label="Einheit"
          error={felder.einheit ??
            (einheitPasstNicht && einheitenart
              ? `Die Zutat ist inzwischen auf „${EINHEITENART_LABELS[einheitenart]}“ umgestellt. Bitte die Einheit wählen.`
              : undefined)}
        >
          {#snippet children(attrs)}
            <select
              {...attrs}
              class="form-input"
              bind:value={einheit}
              disabled={!einheiten.length || !menge.trim()}
            >
              {#if einheitPasstNicht}
                <option value={einheit} disabled>{einheitText(einheit)}</option>
              {/if}
              {#each einheiten as wert (wert)}
                <option value={wert}>{einheitText(wert, gewaehlt?.abtropfgewicht)}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
      </div>
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

      <details>
        <summary class="flex min-h-11 cursor-pointer items-center font-semibold text-brand-900">
          Unverträglichkeiten
          {#if Object.values(unvertraeglich).some(Boolean)}
            ({Object.values(unvertraeglich).filter(Boolean).length})
          {/if}
        </summary>
        {#if felder.nur || felder.ohne}<p class="text-sm text-danger">
            {felder.nur ?? felder.ohne}
          </p>{/if}
        <ul class="mt-2 space-y-2">
          {#each katalog.unvertraeglichkeiten as u (u.id)}
            <li class="flex items-center justify-between gap-3">
              <label for="zeile-u-{u.id}" class="min-w-0">{u.name}</label>
              <select
                id="zeile-u-{u.id}"
                class="form-input w-40"
                bind:value={
                  () => unvertraeglich[u.id] ?? '', (wert) => (unvertraeglich[u.id] = wert)
                }
              >
                <option value="">für alle</option>
                <option value="ohne">nicht dafür</option>
                <option value="nur">nur dafür (Ersatz)</option>
              </select>
            </li>
          {/each}
          {#each verschwunden as id (id)}
            <li class="flex items-center justify-between gap-3">
              <span class="min-w-0 text-danger">Gelöscht: nicht mehr in der Liste</span>
              <ActionButton type="button" onclick={() => delete unvertraeglich[id]}
                >Entfernen</ActionButton
              >
            </li>
          {/each}
        </ul>
      </details>

      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {zeile ? 'Speichern' : 'Hinzufügen'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
