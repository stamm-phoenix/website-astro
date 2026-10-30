<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import {
    INVENTAR_KATEGORIEN,
    INVENTAR_ZUSTAENDE,
    KATEGORIE_LABELS,
    VARIANTEN_NAMEN,
    ZUSTAND_LABELS,
  } from '../../lib/inventur';
  import type { InventarArtikel, InventarKategorie, InventarZustand } from '../../lib/inventur';

  interface Props {
    /** The article to change, or `null` for a new one. */
    artikel: InventarArtikel | null;
    lagerorte: string[];
    /** Loads the articles again and returns the current version of this one. */
    onreload: (id: number) => Promise<InventarArtikel | null>;
    /** Called with the result text after saving or deleting. */
    ondone: (message: string) => void | Promise<void>;
    onclose: () => void;
  }
  let { artikel, lagerorte, onreload, ondone, onclose }: Props = $props();

  interface Zeile {
    key: number;
    id: number | null;
    bezeichnung: string;
    bestand: number | null;
  }
  interface Form {
    id: number | null;
    etag: string;
    bezeichnung: string;
    kategorie: InventarKategorie;
    einheit: string;
    lagerort: string;
    zustand: InventarZustand;
    zubehoer: string;
    fehlend: string;
    notizen: string;
    varianten: Zeile[];
  }

  let nextKey = 0;
  function toForm(a: InventarArtikel | null): Form {
    return {
      id: a?.id ?? null,
      etag: a?.etag ?? '',
      bezeichnung: a?.bezeichnung ?? '',
      kategorie: a?.kategorie ?? 'kleidung',
      einheit: a?.einheit ?? 'Stück',
      lagerort: a?.lagerort ?? '',
      zustand: a?.zustand ?? 'gut',
      zubehoer: a?.zubehoer ?? '',
      fehlend: a?.fehlend ?? '',
      notizen: a?.notizen ?? '',
      varianten: a
        ? a.varianten.map((v) => ({
            key: nextKey++,
            id: v.id,
            bezeichnung: v.bezeichnung,
            bestand: v.bestand,
          }))
        : [{ key: nextKey++, id: null, bezeichnung: '', bestand: 0 }],
    };
  }

  // The dialog is mounted anew for every article, so the start value is all it needs
  // svelte-ignore state_referenced_locally
  let form = $state<Form>(toForm(artikel));
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  /** The current version is being loaded; the input stays locked until it is replaced. */
  let reloading = $state(false);
  const busy = $derived(dialog.state.busy || reloading);

  const variantenName = $derived(VARIANTEN_NAMEN[form.kategorie]);
  /** Sizes and motifs only for clothes and patches; an article that has several keeps them. */
  const mitVarianten = $derived(
    !!variantenName ||
      form.varianten.length > 1 ||
      form.varianten.some((v) => v.bezeichnung.trim() !== '')
  );

  function addZeile(): void {
    form.varianten.push({ key: nextKey++, id: null, bezeichnung: '', bestand: 0 });
  }
  /** Removes a row; the focus moves on to the neighbouring row or the add button. */
  async function removeZeile(key: number): Promise<void> {
    const index = form.varianten.findIndex((z) => z.key === key);
    form.varianten = form.varianten.filter((z) => z.key !== key);
    await tick();
    const next = form.varianten[Math.min(index, form.varianten.length - 1)];
    document.getElementById(next ? `inv-zeile-${next.key}` : 'inv-zeile-neu')?.focus();
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.bezeichnung.trim()) result.bezeichnung = 'Bitte eine Bezeichnung angeben.';
    if (!f.einheit.trim()) result.einheit = 'Bitte eine Einheit angeben, z. B. Stück.';
    const zeilen = f.varianten;
    if (zeilen.length === 0) result.varianten = 'Bitte mindestens einen Bestand angeben.';
    else if (
      zeilen.some((z) => z.bestand === null || !Number.isInteger(z.bestand) || z.bestand < 0)
    )
      result.varianten = 'Bitte für jeden Bestand eine ganze Zahl ab 0 eintragen.';
    else if (zeilen.length > 1 && zeilen.some((z) => !z.bezeichnung.trim()))
      result.varianten = `Bitte jede ${variantenName?.singular ?? 'Variante'} benennen.`;
    else {
      const namen = zeilen.map((z) => z.bezeichnung.trim().toLocaleLowerCase('de'));
      if (new Set(namen).size !== namen.length)
        result.varianten = `Jede ${variantenName?.singular ?? 'Variante'} darf nur einmal vorkommen.`;
    }
    return result;
  }

  const FEHLER_ID: Record<string, string> = {
    bezeichnung: 'inv-bezeichnung',
    einheit: 'inv-einheit',
    varianten: 'inv-varianten',
  };

  async function save(): Promise<void> {
    if (busy) return;
    const problems = validate(form);
    if (dialog.invalid(problems)) {
      await tick();
      const first = Object.keys(FEHLER_ID).find((field) => problems[field]);
      if (first) {
        const ziel =
          first === 'varianten' && mitVarianten
            ? `inv-zeile-${form.varianten[0]?.key}`
            : FEHLER_ID[first];
        document.getElementById(ziel)?.focus();
      }
      return;
    }
    const current = form;
    const { id, etag, varianten, ...fields } = current;
    const body = {
      ...fields,
      varianten: varianten.map((z) => ({
        id: z.id,
        bezeichnung: z.bezeichnung,
        bestand: z.bestand,
      })),
      etag,
    };
    await dialog.run(async () => {
      if (id) await sendApi('PATCH', `/intern/pflege/inventur/${id}`, body);
      else await sendApi('POST', '/intern/pflege/inventur', body);
      await ondone(`${current.bezeichnung.trim()} gespeichert.`);
    }, 'Der Artikel wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current.id || busy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/inventur/${current.id}`, undefined, {
        etag: current.etag,
      });
      await ondone(`${current.bezeichnung.trim()} gelöscht.`);
    }, 'Der Artikel wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }

  /** After a conflict: replaces the input with the current version of the article. */
  async function reloadCurrent(): Promise<boolean> {
    if (!form.id) return false;
    reloading = true;
    let fresh: InventarArtikel | null;
    try {
      fresh = await onreload(form.id);
    } finally {
      reloading = false;
    }
    if (!fresh) {
      await ondone('Der Artikel wurde inzwischen gelöscht.');
      return false;
    }
    form = toForm(fresh);
    dialog.reset();
    return true;
  }
</script>

<EditDialog
  open
  title={form.id ? 'Artikel bearbeiten' : 'Neuer Artikel'}
  rescueKey={`inventur:${form.id ?? 'neu'}`}
  rescueVersion={form.etag}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  {onclose}
  ondelete={form.id ? remove : undefined}
  deleteTitle={`Artikel „${form.bezeichnung.trim()}“ löschen?`}
  deleteQuestion="Den Artikel mit allen Beständen endgültig löschen?"
>
  <fieldset disabled={busy} class="min-w-0 space-y-4">
    <legend class="sr-only">Artikel</legend>
    <FormField id="inv-bezeichnung" label="Bezeichnung" error={errors.bezeichnung}>
      {#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          maxlength="200"
          placeholder="z. B. Stammespulli"
          bind:value={form.bezeichnung}
        />{/snippet}
    </FormField>
    <FormField id="inv-kategorie" label="Kategorie" error={errors.kategorie}>
      {#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={form.kategorie}>
          {#each INVENTAR_KATEGORIEN as kategorie (kategorie)}
            <option value={kategorie}>{KATEGORIE_LABELS[kategorie]}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>

    {#if mitVarianten}
      <div class="space-y-2" role="group" aria-labelledby="inv-varianten-label">
        <p id="inv-varianten-label" class="form-label">
          {variantenName ? `${variantenName.singular} und Bestand` : 'Varianten und Bestand'}
        </p>
        {#each form.varianten as zeile, index (zeile.key)}
          <div class="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
            <input
              id={`inv-zeile-${zeile.key}`}
              class="form-input"
              maxlength="100"
              placeholder={variantenName?.singular ?? 'Variante'}
              aria-label={`${variantenName?.singular ?? 'Variante'} ${index + 1}`}
              aria-invalid={errors.varianten ? 'true' : undefined}
              bind:value={zeile.bezeichnung}
            />
            <input
              class="form-input"
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              aria-label={`Bestand ${zeile.bezeichnung.trim() || index + 1}`}
              aria-invalid={errors.varianten ? 'true' : undefined}
              bind:value={zeile.bestand}
            />
            <ActionButton
              variant="secondary"
              type="button"
              aria-label={`${zeile.bezeichnung.trim() || `Zeile ${index + 1}`} entfernen`}
              disabled={form.varianten.length === 1}
              onclick={() => removeZeile(zeile.key)}>Entfernen</ActionButton
            >
          </div>
        {/each}
        {#if errors.varianten}
          <p class="text-sm text-danger" role="alert">{errors.varianten}</p>
        {/if}
        <ActionButton id="inv-zeile-neu" variant="secondary" type="button" onclick={addZeile}
          >{variantenName?.hinzufuegen ?? 'Variante hinzufügen'}</ActionButton
        >
      </div>
    {:else}
      <FormField id="inv-varianten" label="Bestand" error={errors.varianten}>
        {#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            bind:value={form.varianten[0].bestand}
          />{/snippet}
      </FormField>
    {/if}

    <FormField id="inv-einheit" label="Einheit" error={errors.einheit}>
      {#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          maxlength="30"
          placeholder="Stück, Paar, Set"
          bind:value={form.einheit}
        />{/snippet}
    </FormField>
    <FormField id="inv-lagerort" label="Lagerort" optional error={errors.lagerort}>
      {#snippet children(attrs)}
        <VorschlagFeld
          {...attrs}
          maxlength={100}
          placeholder="Heimkeller, Regal 1"
          options={lagerorte.map((ort) => ({ value: ort }))}
          listLabel="Lagerort auswählen"
          bind:value={form.lagerort}
        />
      {/snippet}
    </FormField>
    <FormField id="inv-zustand" label="Zustand" error={errors.zustand}>
      {#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={form.zustand}>
          {#each INVENTAR_ZUSTAENDE as zustand (zustand)}
            <option value={zustand}>{ZUSTAND_LABELS[zustand]}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
    {#if form.kategorie === 'zelt' || form.zubehoer}
      <FormField id="inv-zubehoer" label="Zubehör" optional error={errors.zubehoer}>
        {#snippet children(attrs)}<textarea
            {...attrs}
            class="form-input resize-y"
            rows="2"
            maxlength="1000"
            placeholder="Zeltbahnen, Stangen, Heringe, Spannseile"
            bind:value={form.zubehoer}></textarea>{/snippet}
      </FormField>
    {/if}
    <FormField
      id="inv-fehlend"
      label="Fehlende oder beschädigte Teile"
      optional
      error={errors.fehlend}
    >
      {#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input resize-y"
          rows="2"
          maxlength="1000"
          placeholder="3 Heringe fehlen, Riss am Rand"
          bind:value={form.fehlend}></textarea>{/snippet}
    </FormField>
    <FormField id="inv-notizen" label="Notizen" optional error={errors.notizen}>
      {#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input resize-y"
          rows="2"
          maxlength="2000"
          bind:value={form.notizen}></textarea>{/snippet}
    </FormField>
  </fieldset>
</EditDialog>
