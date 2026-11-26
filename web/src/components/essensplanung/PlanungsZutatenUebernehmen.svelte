<script lang="ts">
  import { onMount } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import { EINHEITENART_LABELS, ernaehrungLabel } from '../../lib/essensplanungSteuerung';
  import type { EssenEinheitenart } from '../../../../api/lib/essen-schema';
  import type { PlanungsZutat } from '../../../../api/lib/essen-zutat-zentral-model';
  import type { StaffEssenSteuerung } from '../../lib/types/essen';

  /**
   * „Zutaten aus Planungen“: own ingredients of the Planungen that the central list does not
   * have. „In die Liste übernehmen“ makes them a new central ingredient or one already in the
   * list; in every Planung they are that central ingredient afterwards.
   */

  interface Props {
    data: StaffEssenSteuerung;
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();

  let zutaten = $state<PlanungsZutat[] | null>(null);
  let laedt = $state(false);
  let ladeFehler = $state<string | null>(null);

  async function laden(): Promise<void> {
    laedt = true;
    ladeFehler = null;
    try {
      zutaten = (
        await fetchApi<{ zutaten: PlanungsZutat[] }>('/intern/essensplanung/planungs-zutaten')
      ).zutaten;
    } catch (error: unknown) {
      ladeFehler = errorMessage(error, 'Die Zutaten der Planungen konnten nicht geladen werden.');
    } finally {
      laedt = false;
    }
  }
  onMount(() => void laden());

  const kategorieName = $derived(new Map(data.kategorien.map((k) => [k.id, k.name])));
  const allergenName = $derived(new Map(data.unvertraeglichkeiten.map((u) => [u.id, u.name])));
  const zentraleSortiert = $derived(
    data.zutaten.toSorted((a, b) => a.name.localeCompare(b.name, 'de'))
  );

  interface Form {
    art: 'neu' | 'vorhanden';
    name: string;
    kategorieId: number | null;
    einheitenart: EssenEinheitenart;
    ernaehrung: '' | 'vegan' | 'vegetarisch' | 'fleisch';
    zielId: number | null;
  }
  let auswahl = $state<PlanungsZutat | null>(null);
  let form = $state<Form | null>(null);
  let felder = $state<Record<string, string>>({});
  let fehler = $state<string | null>(null);
  let speichert = $state(false);

  function oeffne(zutat: PlanungsZutat): void {
    auswahl = zutat;
    felder = {};
    fehler = null;
    const geraten = zutat.angabenOffen && kategorieName.get(zutat.kategorieId) === 'Sonstiges';
    form = {
      art: zutat.zentralId ? 'vorhanden' : 'neu',
      name: zutat.name,
      kategorieId: geraten ? null : zutat.kategorieId,
      einheitenart: zutat.einheitenart,
      ernaehrung: zutat.vegan
        ? 'vegan'
        : zutat.vegetarisch
          ? 'vegetarisch'
          : zutat.vegetarisch === false
            ? 'fleisch'
            : '',
      zielId: zutat.zentralId,
    };
  }

  function schliessen(): void {
    if (speichert) return;
    auswahl = null;
    form = null;
  }

  async function uebernehmen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const zutat = auswahl;
    const f = form;
    if (!zutat || !f || speichert) return;
    felder = {};
    fehler = null;
    if (f.art === 'vorhanden' && !f.zielId) felder.zielId = 'Bitte eine Zutat der Liste wählen.';
    if (f.art === 'neu' && !f.name.trim()) felder.name = 'Bitte einen Namen eintragen.';
    if (f.art === 'neu' && !f.kategorieId) felder.kategorieId = 'Bitte eine Kategorie wählen.';
    if (Object.keys(felder).length) return;
    const body =
      f.art === 'vorhanden'
        ? { name: zutat.name, zielId: f.zielId }
        : {
            name: zutat.name,
            zutat: {
              name: f.name.trim(),
              kategorieId: f.kategorieId,
              einheitenart: f.einheitenart,
              abtropfgewicht: false,
              lebensmittel: zutat.lebensmittel,
              vegetarisch: f.ernaehrung === '' ? null : f.ernaehrung !== 'fleisch',
              vegan: f.ernaehrung === '' ? null : f.ernaehrung === 'vegan',
              merkmaleGeprueft: false,
              hinweis: '',
              grammProTl: null,
              grammProEl: null,
              grammProStueck: null,
              allergene: zutat.lebensmittel ? zutat.allergene : [],
            },
          };
    speichert = true;
    onnotice(null);
    try {
      const result = await sendApi<{
        planungen: number;
        view: StaffEssenSteuerung;
        planungsZutaten: PlanungsZutat[];
      }>('POST', '/intern/pflege/essensplanung-zutaten/uebernehmen', body);
      essensplanungSteuerung.set(result.view);
      zutaten = result.planungsZutaten;
      const ziel =
        f.art === 'vorhanden'
          ? (data.zutaten.find((z) => z.id === f.zielId)?.name ?? '')
          : f.name.trim();
      onnotice(
        `„${zutat.name}“ übernommen: ${result.planungen === 1 ? '1 Planung nutzt' : `${result.planungen} Planungen nutzen`} jetzt „${ziel}“ aus der Liste.`
      );
      auswahl = null;
      form = null;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) felder = error.fields;
      fehler = errorMessage(
        error,
        `„${zutat.name}“ wurde nicht übernommen; in den Planungen hat sich nichts geändert. Tippe noch einmal auf „Übernehmen“.`
      );
    } finally {
      speichert = false;
    }
  }
</script>

<!-- Only while there is something to take over -->
{#if zutaten === null || zutaten.length}
  <section aria-labelledby="planungs-zutaten-heading" class="space-y-3">
    <div class="flex items-center gap-1">
      <h2 id="planungs-zutaten-heading" class="font-serif text-xl font-bold text-brand-900">
        Zutaten aus Planungen
      </h2>
      <InfoHint
        label="Zutaten aus Planungen"
        text="Eigene Zutaten der Planungen, die nicht in der Liste stehen. Übernommen gelten sie in allen Planungen als Zutat der Liste; ihre Mengen bleiben."
      />
    </div>
    <LoadState
      data={zutaten}
      loading={laedt}
      error={ladeFehler}
      loadingText="Zutaten der Planungen werden geladen …"
      onretry={() => void laden()}
    >
      {#snippet children(liste)}
        {#if liste.length}
          <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
            {#each liste as zutat (zutat.name)}
              <li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="flex flex-wrap items-center gap-x-2 font-semibold text-brand-900">
                    <span class="[overflow-wrap:anywhere]">{zutat.name}</span>
                    {#if zutat.angabenOffen}<StatusLabel
                        label="Angaben fehlen"
                        tone="warning"
                      />{/if}
                  </p>
                  <p class="text-sm text-neutral-700">
                    {kategorieName.get(zutat.kategorieId)} · {EINHEITENART_LABELS[
                      zutat.einheitenart
                    ]}
                    {#if zutat.lebensmittel}· {ernaehrungLabel(zutat)}{/if}
                  </p>
                  <p class="text-sm text-neutral-700">
                    {zutat.planungen.length === 1 ? 'Planung' : 'Planungen'}: {zutat.planungen.join(
                      ', '
                    )}
                  </p>
                </div>
                <ActionButton
                  type="button"
                  class="shrink-0"
                  aria-label="{zutat.name} in die Liste übernehmen"
                  onclick={() => oeffne(zutat)}
                >
                  In die Liste übernehmen
                </ActionButton>
              </li>
            {/each}
          </ul>
        {/if}
      {/snippet}
    </LoadState>
  </section>
{/if}

{#if auswahl && form}
  <ModalDialog
    open
    title="„{auswahl.name}“ übernehmen"
    closeDisabled={speichert}
    onclose={schliessen}
  >
    <form class="min-h-0 space-y-4 overflow-y-auto px-5 py-4" onsubmit={uebernehmen}>
      <fieldset class="min-w-0 space-y-4" disabled={speichert}>
        {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
        <fieldset class="space-y-1">
          <legend class="form-label">In der Liste als</legend>
          <label class="flex min-h-11 items-center gap-2">
            <input type="radio" value="neu" bind:group={form.art} />
            neue Zutat
          </label>
          <label class="flex min-h-11 items-center gap-2">
            <input type="radio" value="vorhanden" bind:group={form.art} />
            Zutat, die schon in der Liste steht
          </label>
        </fieldset>
        {#if form.art === 'vorhanden'}
          <FormField id="uebernehmen-ziel" label="Zutat der Liste" error={felder.zielId}>
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={form!.zielId}>
                <option value={null}>Bitte wählen</option>
                {#each zentraleSortiert as zentral (zentral.id)}
                  <option value={zentral.id}>{zentral.name}</option>
                {/each}
              </select>
            {/snippet}
          </FormField>
        {:else}
          <FormField id="uebernehmen-name" label="Name" error={felder.name}>
            {#snippet children(attrs)}
              <input {...attrs} class="form-input" maxlength="150" bind:value={form!.name} />
            {/snippet}
          </FormField>
          <FormField id="uebernehmen-kategorie" label="Kategorie" error={felder.kategorieId}>
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={form!.kategorieId}>
                <option value={null}>Bitte wählen</option>
                {#each data.kategorien as kategorie (kategorie.id)}
                  <option value={kategorie.id}>{kategorie.name}</option>
                {/each}
              </select>
            {/snippet}
          </FormField>
          <FormField id="uebernehmen-einheitenart" label="Gemessen in" error={felder.einheitenart}>
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={form!.einheitenart}>
                {#each Object.entries(EINHEITENART_LABELS) as [art, label] (art)}
                  <option value={art}>{label}</option>
                {/each}
              </select>
            {/snippet}
          </FormField>
          {#if auswahl.lebensmittel}
            <FormField id="uebernehmen-ernaehrung" label="Ernährung">
              {#snippet children(attrs)}
                <select {...attrs} class="form-input" bind:value={form!.ernaehrung}>
                  <option value="">Weiß ich nicht</option>
                  <option value="vegan">vegan</option>
                  <option value="vegetarisch">vegetarisch</option>
                  <option value="fleisch">mit Fleisch oder Fisch</option>
                </select>
              {/snippet}
            </FormField>
            <p class="text-sm text-neutral-700">
              Enthält: {auswahl.allergene.map((id) => allergenName.get(id) ?? '').join(', ') ||
                'nichts angegeben'}
            </p>
          {/if}
        {/if}
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <ActionButton type="button" onclick={schliessen}>Abbrechen</ActionButton>
          <ActionButton type="submit" variant="primary">Übernehmen</ActionButton>
        </div>
      </fieldset>
    </form>
  </ModalDialog>
{/if}
