<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { EINHEITENART_LABELS } from '../../lib/essensplanungSteuerung';
  import { ernaehrung } from '../../lib/essensplanungGerichte';
  import type { EssenEinheitenart, EssenKatalog, PlanungZutat } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * The ingredients the dishes of a Planung use. Central ones may get another category or kind
   * of unit for this Planung; own ones are changed entirely. Unused ones can be deleted.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    bearbeiten: boolean;
  }
  let { kontext, katalog, bearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const kategorien = $derived(new Map((katalog?.kategorien ?? []).map((k) => [k.id, k.name])));

  let auswahl = $state<PlanungZutat | null>(null);
  let form = $state({
    name: '',
    kategorieId: null as number | null,
    einheitenart: null as EssenEinheitenart | null,
    ernaehrung: '' as '' | 'vegan' | 'vegetarisch' | 'fleisch',
    allergene: [] as number[],
  });
  let felder = $state<Record<string, string>>({});
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => auswahl !== null && geaendert));

  /** The version of the ingredient when the dialog opened. */
  let formEtag = '';

  function oeffne(zutat: PlanungZutat): void {
    formEtag = zutat.etag;
    felder = {};
    geaendert = false;
    const zentral = zutat.zutatId !== null;
    form = {
      name: zutat.name,
      // A central ingredient shows its differences; null means as in the list
      kategorieId: zentral && !zutat.abweichend.kategorie ? null : zutat.kategorieId,
      einheitenart: zentral && !zutat.abweichend.einheitenart ? null : zutat.einheitenart,
      ernaehrung: zutat.vegan
        ? 'vegan'
        : zutat.vegetarisch
          ? 'vegetarisch'
          : zutat.vegetarisch === false
            ? 'fleisch'
            : '',
      allergene: [...zutat.allergene],
    };
    auswahl = zutat;
  }

  const zentrale = $derived(
    auswahl?.zutatId ? katalog?.zutaten.find((z) => z.id === auswahl!.zutatId) : undefined
  );

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
    const zutat = auswahl;
    if (!zutat) return;
    felder = {};
    const eigene = zutat.zutatId === null;
    // The version the form was opened with: a change of others meanwhile is a conflict
    const etag = formEtag;
    const body = eigene
      ? {
          etag,
          name: form.name,
          kategorieId: form.kategorieId,
          einheitenart: form.einheitenart,
          vegetarisch: form.ernaehrung === '' ? null : form.ernaehrung !== 'fleisch',
          vegan: form.ernaehrung === '' ? null : form.ernaehrung === 'vegan',
          allergene: form.allergene,
        }
      : { etag, kategorieId: form.kategorieId, einheitenart: form.einheitenart };
    const ok = await kontext.aendern(async () => {
      try {
        return await kontext.api.senden('PATCH', `/zutaten/${zutat.id}`, body);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, `${form.name} gespeichert.`);
    if (ok) {
      geaendert = false;
      auswahl = null;
      return;
    }
    // The page told about the conflict; saving again takes the input over what is saved now
    const jetzt = untrack(() => ansicht.zutaten.find((z) => z.id === zutat.id));
    if (jetzt) formEtag = jetzt.etag;
  }

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
    auswahl = null;
  }

  async function loeschen(zutat: PlanungZutat): Promise<void> {
    if (
      !(await confirmAction({
        title: `${zutat.name} löschen?`,
        message: 'Die Zutat verschwindet aus dieser Planung.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/zutaten/${zutat.id}`, undefined, zutat.etag),
      `${zutat.name} gelöscht.`
    );
  }
</script>

<details>
  <summary class="flex min-h-11 cursor-pointer items-center font-semibold text-brand-900">
    Zutaten dieser Planung ({ansicht.zutaten.length})
  </summary>
  <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
    {#each ansicht.zutaten as zutat (zutat.id)}
      <li class="flex flex-wrap items-center justify-between gap-2 py-2">
        <div class="min-w-0">
          <p class="text-neutral-900 [overflow-wrap:anywhere]">
            {zutat.name}
            {#if zutat.zutatId === null}<span class="text-sm text-neutral-700">(eigene)</span>{/if}
          </p>
          <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
            <span>{kategorien.get(zutat.kategorieId) ?? ''}</span>
            <span>{EINHEITENART_LABELS[zutat.einheitenart]}</span>
            {#if ernaehrung(zutat)}<span>{ernaehrung(zutat)}</span>{/if}
            {#if zutat.abweichend.kategorie || zutat.abweichend.einheitenart}
              <span>weicht von der Liste ab</span>
            {/if}
            <span>{zutat.zeilen === 1 ? 'in 1 Zeile' : `in ${zutat.zeilen} Zeilen`}</span>
          </p>
        </div>
        {#if bearbeiten}
          <div class="flex gap-1">
            <ActionButton
              type="button"
              aria-label="{zutat.name} ändern"
              disabled={!katalog}
              onclick={() => oeffne(zutat)}>Ändern</ActionButton
            >
            {#if zutat.zeilen === 0}
              <ActionButton
                type="button"
                variant="danger"
                aria-label="{zutat.name} löschen"
                disabled={kontext.busy}
                onclick={() => void loeschen(zutat)}>Löschen</ActionButton
              >
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</details>

{#if katalog && auswahl}
  <ModalDialog
    open
    title={auswahl.name}
    closeDisabled={kontext.busy}
    onclose={() => void schliessen()}
  >
    <form
      class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
      onsubmit={speichern}
      oninput={() => (geaendert = true)}
      onchange={() => (geaendert = true)}
    >
      <!-- Disabled while saving, so nothing typed meanwhile gets lost -->
      <fieldset class="min-w-0 space-y-4" disabled={speichert}>
        {#if auswahl.zutatId === null}
          <FormField id="pz-name" label="Name" error={felder.name}>
            {#snippet children(attrs)}
              <input {...attrs} class="form-input" maxlength="150" bind:value={form.name} />
            {/snippet}
          </FormField>
        {:else}
          <p class="text-sm text-neutral-700">
            Die Änderungen gelten nur in dieser Planung; die Zutatenliste bleibt, wie sie ist.
          </p>
        {/if}
        <FormField id="pz-kategorie" label="Kategorie" error={felder.kategorieId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form.kategorieId}>
              {#if zentrale}
                <option value={null}
                  >wie in der Liste ({kategorien.get(zentrale.kategorieId)})</option
                >
              {:else}
                <option value={null}>Bitte wählen</option>
              {/if}
              {#each katalog.kategorien as kategorie (kategorie.id)}
                <option value={kategorie.id}>{kategorie.name}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
        <FormField id="pz-einheitenart" label="Gemessen in" error={felder.einheitenart}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form.einheitenart}>
              {#if zentrale}
                <option value={null}
                  >wie in der Liste ({EINHEITENART_LABELS[zentrale.einheitenart]})</option
                >
              {:else}
                <option value={null}>Bitte wählen</option>
              {/if}
              {#each Object.entries(EINHEITENART_LABELS) as [art, label] (art)}
                <option value={art}>{label}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
        {#if auswahl.zutatId === null}
          <FormField id="pz-ernaehrung" label="Ernährung">
            {#snippet children(attrs)}
              <select {...attrs} class="form-input" bind:value={form.ernaehrung}>
                <option value="">Weiß ich nicht</option>
                <option value="vegan">vegan</option>
                <option value="vegetarisch">vegetarisch</option>
                <option value="fleisch">mit Fleisch oder Fisch</option>
              </select>
            {/snippet}
          </FormField>
          <fieldset>
            <legend class="form-label">Enthält</legend>
            <div class="grid gap-x-4 sm:grid-cols-2">
              {#each katalog.unvertraeglichkeiten as u (u.id)}
                <label class="flex min-h-11 items-center gap-2">
                  <input type="checkbox" value={u.id} bind:group={form.allergene} />
                  {u.name}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
          <ActionButton type="submit" variant="primary" disabled={kontext.busy}
            >Speichern</ActionButton
          >
        </div>
      </fieldset>
    </form>
  </ModalDialog>
{/if}
