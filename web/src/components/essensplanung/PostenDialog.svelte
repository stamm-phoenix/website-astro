<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { leseMenge, mengeFeld, zutatVorschlaege } from '../../lib/essensplanungGerichte';
  import { EINHEITEN_JE_ART, einheitText } from '../../../../api/lib/essen-gerichte-model';
  import { MENGE_FEHLER } from '../../../../api/lib/essen-einkauf-model';
  import type { PostenArt } from '../../../../api/lib/essen-einkauf-model';
  import type { EssenEinheitenart, EssenKatalog, GerichtEinheit } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';

  /**
   * Adds or changes an entry of the stock (what is there before the Aktion) or of the extra needs
   * (what is needed without a dish): an ingredient of the list or the Planung, amount and unit.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    art: PostenArt;
    /** The entry to change; null adds one; undefined: closed. */
    postenId: number | null | undefined;
    onclose: () => void;
  }
  let { kontext, katalog, art, postenId, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const liste = $derived(art === 'bestand' ? ansicht.bestand : ansicht.zusatzbedarf);
  const titel = $derived(
    art === 'bestand'
      ? postenId === null
        ? 'Bestand eintragen'
        : 'Bestand ändern'
      : postenId === null
        ? 'Zusatzbedarf eintragen'
        : 'Zusatzbedarf ändern'
  );

  type Auswahl = { art: 'zentral' | 'planung'; id: number };
  let auswahl = $state<Auswahl | null>(null);
  let zutatText = $state('');
  let menge = $state('');
  let einheit = $state<GerichtEinheit>('g');
  let hinweis = $state('');
  let felder = $state<Record<string, string>>({});
  /** Why the last save failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => postenId !== undefined && geaendert));
  /** The version of the entry when the dialog opened. */
  let etag = '';

  $effect(() => {
    const id = postenId;
    if (id !== undefined) untrack(() => fuelle(id));
  });

  function fuelle(id: number | null): void {
    felder = {};
    fehler = null;
    geaendert = false;
    const posten = id === null ? undefined : liste.find((p) => p.id === id);
    etag = posten?.etag ?? '';
    auswahl = posten ? { art: 'planung', id: posten.planungZutatId } : null;
    zutatText = posten
      ? (ansicht.zutaten.find((z) => z.id === posten.planungZutatId)?.name ?? '')
      : '';
    menge = posten ? mengeFeld(posten.menge) : '';
    einheit = posten?.einheit ?? 'g';
    hinweis = posten?.hinweis ?? '';
  }

  const vorschlaege = $derived(
    katalog ? zutatVorschlaege(katalog, ansicht.zutaten, { nurLebensmittel: false }) : []
  );
  const einheitenart = $derived.by((): EssenEinheitenart | null => {
    if (!auswahl) return null;
    const id = auswahl.id;
    return auswahl.art === 'planung'
      ? (ansicht.zutaten.find((z) => z.id === id)?.einheitenart ?? null)
      : (katalog?.zutaten.find((z) => z.id === id)?.einheitenart ?? null);
  });
  const einheiten = $derived(einheitenart ? EINHEITEN_JE_ART[einheitenart] : []);
  const ohneTreffer = $derived(zutatText.trim() !== '' && !auswahl);

  function waehle(option: Vorschlag): void {
    const [teil, id] = (option.key ?? '').split(':');
    auswahl = { art: teil === 'p' ? 'planung' : 'zentral', id: Number(id) };
    zutatText = option.value;
    geaendert = true;
    if (einheiten.length && !einheiten.includes(einheit)) einheit = einheiten[0];
  }

  function getippt(text: string): void {
    geaendert = true;
    const treffer = vorschlaege.find(
      (option) => option.value.localeCompare(text.trim(), 'de', { sensitivity: 'base' }) === 0
    );
    if (treffer) waehle(treffer);
    else auswahl = null;
  }

  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || postenId === undefined) return;
    speichert = true;
    try {
      await speichereFormular(postenId);
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(id: number | null): Promise<void> {
    felder = {};
    fehler = null;
    const zahl = leseMenge(menge);
    if (!auswahl) felder.zutat = 'Bitte eine Zutat aus der Liste wählen.';
    if (zahl === null || Number.isNaN(zahl) || zahl <= 0) felder.menge = MENGE_FEHLER;
    if (Object.keys(felder).length) return;
    let abgelehnt: unknown = null;
    const body = {
      ...(auswahl!.art === 'planung' ? { planungZutatId: auswahl!.id } : { zutatId: auswahl!.id }),
      menge: zahl,
      einheit,
      hinweis,
    };
    const pfad = art === 'bestand' ? '/bestand' : '/zusatzbedarf';
    const ok = await kontext.aendern(async () => {
      try {
        return id === null
          ? await kontext.api.senden('POST', pfad, body)
          : await kontext.api.senden('PATCH', `${pfad}/${id}`, { ...body, etag });
      } catch (error: unknown) {
        abgelehnt = error;
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, `${zutatText.trim()} gespeichert.`);
    if (ok) {
      geaendert = false;
      onclose();
      return;
    }
    if (!Object.keys(felder).length) fehler = kontext.fehler;
    // Only after a conflict does saving again take the input over what is saved now
    const jetzt = liste.find((p) => p.id === id);
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) etag = jetzt.etag;
  }

  async function schliessen(): Promise<void> {
    if (kontext.busy) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Deine Eingaben sind noch nicht gespeichert.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    geaendert = false;
    onclose();
  }
</script>

<ModalDialog
  open={postenId !== undefined}
  title={titel}
  closeDisabled={kontext.busy}
  onclose={() => void schliessen()}
>
  <form
    class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    onsubmit={speichern}
    oninput={() => (geaendert = true)}
    onchange={() => (geaendert = true)}
  >
    <fieldset class="min-w-0 space-y-4" disabled={speichert}>
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <FormField id="posten-zutat" label="Zutat" error={felder.zutat}>
        {#snippet children(attrs)}
          <VorschlagFeld
            {...attrs}
            options={vorschlaege}
            bind:value={zutatText}
            listLabel="Zutaten"
            placeholder={art === 'bestand' ? 'z. B. Salz' : 'z. B. Spülmittel'}
            onpick={waehle}
            onedit={getippt}
            autocomplete="off"
          />
        {/snippet}
      </FormField>
      {#if !katalog}
        <p class="text-sm text-neutral-700">Die Liste wird geladen …</p>
      {:else if ohneTreffer}
        <p class="text-sm text-neutral-700">
          „{zutatText.trim()}“ steht nicht in der Liste. Lege sie unter Gerichte als eigene Zutat
          dieser Planung an.
        </p>
      {/if}
      <div class="grid grid-cols-2 gap-3">
        <FormField id="posten-menge" label="Menge" error={felder.menge}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              inputmode="decimal"
              autocomplete="off"
              placeholder="z. B. 2,5"
              bind:value={menge}
            />
          {/snippet}
        </FormField>
        <FormField id="posten-einheit" label="Einheit" error={felder.einheit}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={einheit}>
              {#each einheiten.length ? einheiten : [einheit] as wert (wert)}
                <option value={wert}>{einheitText(wert)}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
      </div>
      <FormField id="posten-hinweis" label="Hinweis" optional error={felder.hinweis}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="200" bind:value={hinweis} />
        {/snippet}
      </FormField>
      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {postenId === null ? 'Eintragen' : 'Speichern'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
