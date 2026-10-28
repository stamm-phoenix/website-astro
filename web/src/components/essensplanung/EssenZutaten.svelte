<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import {
    EINHEITENART_LABELS,
    einheitKurz,
    ernaehrungLabel,
    fromZutatForm,
    parseDecimal,
    toZutatForm,
    type ZutatForm,
  } from '../../lib/essensplanungSteuerung';
  import type { EssenEinheitenart, EssenZutat, StaffEssenSteuerung } from '../../lib/types';

  interface Props {
    data: StaffEssenSteuerung;
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = essensplanungSteuerung.state;

  let search = $state('');
  let kategorieFilter = $state('');
  let nurUngeprueft = $state(false);
  let form = $state<ZutatForm | null>(null);
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);

  const kategorieName = $derived(new Map(data.kategorien.map((k) => [k.id, k.name])));
  const allergenName = $derived(new Map(data.unvertraeglichkeiten.map((u) => [u.id, u.name])));
  // Only food has diet and allergens to check.
  const ungeprueft = $derived(
    data.zutaten.filter((z) => z.lebensmittel && !z.merkmaleGeprueft).length
  );

  const gefiltert = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase('de');
    return data.zutaten.filter(
      (zutat) =>
        (!query || zutat.name.toLocaleLowerCase('de').includes(query)) &&
        (!kategorieFilter || String(zutat.kategorieId) === kategorieFilter) &&
        (!nurUngeprueft || (zutat.lebensmittel && !zutat.merkmaleGeprueft))
    );
  });

  function allergeneText(zutat: EssenZutat): string {
    return zutat.allergene.map((id) => allergenName.get(id) ?? '').join(', ');
  }

  function open(zutat?: EssenZutat): void {
    form = toZutatForm(zutat ?? null, kategorieFilter ? Number(kategorieFilter) : undefined);
    dialog.reset();
  }

  function close(): void {
    if (!busy) form = null;
  }

  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await essensplanungSteuerung.load({ force: true });
    // Keep the input when reloading failed; the dialog still offers to try again.
    if (store.error) {
      onnotice(store.error, 'error');
      return false;
    }
    const fresh = store.data?.zutaten.find((zutat) => zutat.id === id);
    if (!fresh) {
      form = null;
      onnotice('Die Zutat wurde inzwischen gelöscht.');
      return false;
    }
    open(fresh);
    return true;
  }

  function validate(f: ZutatForm): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.name.trim()) result.name = 'Bitte einen Namen eintragen.';
    if (!f.kategorieId) result.kategorieId = 'Bitte eine Kategorie wählen.';
    const grenzen = { grammProTl: 1000, grammProEl: 1000, grammProStueck: 100_000 } as const;
    for (const [field, max] of Object.entries(grenzen) as [keyof typeof grenzen, number][]) {
      const zahl = Math.round(parseDecimal(f[field]) * 100) / 100;
      if (f[field].trim() && !(zahl >= 0.01 && zahl <= max))
        result[field] =
          `Bitte eine Zahl von 0,01 bis ${max.toLocaleString('de-DE')} eintragen oder das Feld leeren.`;
    }
    return result;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    if (dialog.invalid(validate(form))) {
      await tick();
      const first = errors.name
        ? 'zutat-name'
        : errors.kategorieId
          ? 'zutat-kategorie'
          : errors.grammProTl
            ? 'zutat-tl'
            : errors.grammProEl
              ? 'zutat-el'
              : 'zutat-stueck';
      document.getElementById(first)?.focus();
      return;
    }
    const { id, etag } = form;
    const body = fromZutatForm(form);
    await dialog.run(async () => {
      if (id) {
        store.data = await sendApi<StaffEssenSteuerung>(
          'PATCH',
          `/intern/pflege/essensplanung/zutaten/${id}`,
          { ...body, etag }
        );
      } else {
        const result = await sendApi<{ id: number; view: StaffEssenSteuerung }>(
          'POST',
          '/intern/pflege/essensplanung/zutaten',
          body
        );
        store.data = result.view;
      }
      onnotice(`Zutat „${body.name.trim()}“ gespeichert.`);
      form = null;
    }, 'Die Zutat wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || busy) return;
    await dialog.run(async () => {
      store.data = await sendApi<StaffEssenSteuerung>(
        'DELETE',
        `/intern/pflege/essensplanung/zutaten/${current.id}`,
        undefined,
        { etag: current.etag }
      );
      onnotice(`Zutat „${current.name}“ gelöscht.`);
      form = null;
    }, 'Die Zutat wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }

  function toggleAllergen(id: number, checked: boolean): void {
    if (!form) return;
    form.allergene = checked
      ? [...form.allergene, id].sort((a, b) => a - b)
      : form.allergene.filter((other) => other !== id);
  }

  const EINHEITENARTEN = Object.keys(EINHEITENART_LABELS) as EssenEinheitenart[];
</script>

<section aria-labelledby="zutaten-heading" class="space-y-4">
  <div class="flex items-center gap-1">
    <h2 id="zutaten-heading" class="font-serif text-xl font-bold text-brand-900">
      Zentrale Zutatenliste
    </h2>
    <InfoHint
      label="Zentrale Zutatenliste"
      text="Alle Planungen wählen ihre Zutaten aus dieser Liste. Abweichungen in einer Planung gelten nur dort. Vegetarisch, vegan und Allergene sind bei den Startdaten Vorschläge; bitte prüfen und dann als geprüft markieren."
    />
  </div>

  <div class="flex flex-col gap-3 md:flex-row md:items-end print:hidden">
    <div class="w-full md:max-w-xs">
      <label for="zutat-suche" class="form-label">Zutat suchen</label>
      <input id="zutat-suche" type="search" class="form-input" bind:value={search} />
    </div>
    <div class="w-full md:max-w-xs">
      <label for="zutat-kategorie-filter" class="form-label">Kategorie</label>
      <select id="zutat-kategorie-filter" class="form-input" bind:value={kategorieFilter}>
        <option value="">Alle Kategorien</option>
        {#each data.kategorien as kategorie (kategorie.id)}
          <option value={String(kategorie.id)}>{kategorie.name}</option>
        {/each}
      </select>
    </div>
    <label class="flex items-center gap-2 pb-2 text-sm font-semibold text-neutral-800">
      <input type="checkbox" bind:checked={nurUngeprueft} />
      Nur ungeprüfte ({ungeprueft})
    </label>
    <ActionButton
      variant="primary"
      type="button"
      class="md:ml-auto"
      disabled={busy}
      onclick={() => open()}>Neue Zutat</ActionButton
    >
  </div>

  <p class="text-sm text-neutral-700" role="status">
    {gefiltert.length} von {data.zutaten.length} Zutaten
  </p>

  {#if gefiltert.length}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each gefiltert as zutat (zutat.id)}
        <li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">{zutat.name}</p>
            <p class="text-sm text-neutral-700">
              {kategorieName.get(zutat.kategorieId)} · {einheitKurz(zutat)}
              {#if zutat.lebensmittel}
                · {ernaehrungLabel(zutat)}
                {#if zutat.allergene.length}· enthält {allergeneText(zutat)}{/if}
              {:else}
                · kein Lebensmittel
              {/if}
            </p>
            {#if zutat.hinweis}
              <p class="text-sm text-neutral-700 italic">{zutat.hinweis}</p>
            {/if}
            {#if zutat.lebensmittel && !zutat.merkmaleGeprueft}
              <StatusLabel label="Merkmale ungeprüft" tone="warning" dot />
            {/if}
          </div>
          <ActionButton
            type="button"
            class="shrink-0 print:hidden"
            aria-label="Bearbeiten: {zutat.name}"
            disabled={busy}
            onclick={() => open(zutat)}>Bearbeiten</ActionButton
          >
        </li>
      {/each}
    </ul>
  {:else}
    <div role="status" class="border-t border-neutral-200 pt-4">
      <p>Keine Zutat passt zu Suche und Filter.</p>
      <ActionButton
        type="button"
        class="mt-3"
        onclick={() => {
          search = '';
          kategorieFilter = '';
          nurUngeprueft = false;
        }}>Filter zurücksetzen</ActionButton
      >
    </div>
  {/if}
</section>

<EditDialog
  open={form !== null}
  title={form?.id ? 'Zutat bearbeiten' : 'Neue Zutat'}
  rescueKey={form ? `essen-zutat:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteTitle={`Zutat „${form?.name.trim() ?? ''}“ löschen?`}
  deleteQuestion="Die Zutat verschwindet aus der zentralen Liste. Planungen, die sie schon nutzen, behalten ihre Angaben."
>
  {#if form}
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Zutat</legend>
      <FormField id="zutat-name" label="Name" error={errors.name}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="150" bind:value={form!.name} />
        {/snippet}
      </FormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField id="zutat-kategorie" label="Kategorie" error={errors.kategorieId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form!.kategorieId}>
              <option value="" disabled>Bitte wählen</option>
              {#each data.kategorien as kategorie (kategorie.id)}
                <option value={String(kategorie.id)}>{kategorie.name}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
        <FormField
          id="zutat-einheit"
          label="Einheit"
          info="In Gerichten und auf der Einkaufsliste steht die Zutat immer in dieser Einheit; umgerechnet wird nie."
          error={errors.einheitenart}
        >
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form!.einheitenart}>
              {#each EINHEITENARTEN as art (art)}
                <option value={art}>{EINHEITENART_LABELS[art]}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
      </div>
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <input type="checkbox" bind:checked={form.lebensmittel} />
          Lebensmittel (sonst z. B. Spülmittel, Alufolie: nicht in Gerichten)
        </label>
        {#if form.einheitenart === 'masse'}
          <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <input type="checkbox" bind:checked={form.abtropfgewicht} />
            Menge als Abtropfgewicht (Dosen, Gläser)
          </label>
          {#if errors.abtropfgewicht}
            <p class="text-sm text-danger">{errors.abtropfgewicht}</p>
          {/if}
        {/if}
      </div>

      {#if form.lebensmittel}
        <FormField
          id="zutat-ernaehrung"
          label="Ernährung"
          error={errors.vegan ?? errors.vegetarisch}
        >
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={form!.ernaehrung}>
              <option value="vegan">vegan (auch vegetarisch)</option>
              <option value="vegetarisch">vegetarisch, nicht vegan</option>
              <option value="nein">nicht vegetarisch (Fleisch, Fisch, Gelatine …)</option>
              <option value="unbekannt">unbekannt</option>
            </select>
          {/snippet}
        </FormField>
        <fieldset class="min-w-0">
          <legend class="text-sm font-semibold text-neutral-800">Enthält</legend>
          {#if errors.allergene}
            <p class="mt-1 text-sm text-danger">{errors.allergene}</p>
          {/if}
          <div class="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {#each data.unvertraeglichkeiten as allergen (allergen.id)}
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.allergene.includes(allergen.id)}
                  onchange={(event) => toggleAllergen(allergen.id, event.currentTarget.checked)}
                />
                {allergen.name}
              </label>
            {/each}
          </div>
        </fieldset>
        <FormField id="zutat-hinweis" label="Hinweis" optional error={errors.hinweis}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              maxlength="200"
              placeholder="z. B. je nach Produkt mit Gelatine"
              bind:value={form!.hinweis}
            />
          {/snippet}
        </FormField>
        <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <input type="checkbox" bind:checked={form.merkmaleGeprueft} />
          Ernährung und Allergene sind geprüft
        </label>
      {/if}

      <fieldset class="min-w-0">
        <legend class="text-sm font-semibold text-neutral-800">
          Umrechnungshilfe (optional)
          <InfoHint
            label="Umrechnungshilfe"
            class="ml-1"
            text="Hilft beim Eintragen von Rezepten, z. B. „2 EL Zucker“ in Gramm."
          />
        </legend>
        <div class="mt-2 grid gap-3 sm:grid-cols-3">
          <FormField id="zutat-tl" label="Gramm pro TL" optional error={errors.grammProTl}>
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                inputmode="decimal"
                bind:value={form!.grammProTl}
              />
            {/snippet}
          </FormField>
          <FormField id="zutat-el" label="Gramm pro EL" optional error={errors.grammProEl}>
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                inputmode="decimal"
                bind:value={form!.grammProEl}
              />
            {/snippet}
          </FormField>
          <FormField
            id="zutat-stueck"
            label="Gramm pro Stück"
            optional
            error={errors.grammProStueck}
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                inputmode="decimal"
                bind:value={form!.grammProStueck}
              />
            {/snippet}
          </FormField>
        </div>
      </fieldset>
    </fieldset>
  {/if}
</EditDialog>
