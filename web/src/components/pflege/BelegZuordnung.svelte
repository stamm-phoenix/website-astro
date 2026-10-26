<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import FormField from './FormField.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import { matchingKostenstelle, type BelegForm } from '../../lib/belegForm';
  import {
    kategorieVorschlaege,
    kategorieSchreibweise,
    kostenstelleVorschlaege,
    readZuordnungTreffer,
    zuordnungStand,
    zuordnungVorschlaege,
  } from '../../lib/belegZuordnung';
  import type { Vorschlag } from '../../lib/vorschlaege';

  interface Props {
    form: BelegForm;
    errors: Record<string, string>;
    onfield: (field: string) => void;
  }
  let { form = $bindable(), errors, onfield }: Props = $props();

  const notifyEdited = getContext<(() => void) | undefined>('form-edited');
  const units = $derived(kostenstellenStore.data ?? []);
  let suche = $state('');

  const treffer = $derived(zuordnungVorschlaege(units));
  const kostenstellen = $derived(kostenstelleVorschlaege(units));
  const kategorien = $derived(kategorieVorschlaege(units, form.kostenstelle));
  const stand = $derived(
    zuordnungStand(kostenstellenStore.data, form.kostenstelle, form.kategorie)
  );
  /** A receipt from before Kostenstelle and Kategorie: what it said, and its Kostenstelle. */
  const bisher = $derived(
    form.aktion.trim() && !form.kostenstelle.trim()
      ? { aktion: form.aktion.trim(), unit: matchingKostenstelle(form.aktion, units) }
      : null
  );

  $effect(() => {
    untrack(() => void fetchKostenstellen());
  });

  function pick(option: Vorschlag): void {
    const { kostenstelle, kategorie } = readZuordnungTreffer(option.value);
    form.kostenstelle = kostenstelle;
    // Only the Kostenstelle: its Kategorie is picked next
    form.kategorie = kategorie ?? '';
    onfield('kostenstelle');
    onfield('kategorie');
    notifyEdited?.();
  }
</script>

<div class="space-y-3 sm:col-span-2">
  <FormField id="bl-zuordnung" label="Kostenstelle oder Kategorie suchen" optional>
    {#snippet children(attrs)}
      <VorschlagFeld
        {...attrs}
        maxlength={120}
        placeholder="z. B. Leitendenrunde oder Stammeslager"
        options={treffer}
        maxResults={12}
        loading={kostenstellenStore.loading}
        listLabel="Kostenstelle oder Kategorie auswählen"
        clearOnPick
        pickFirstOnEnter
        bind:value={suche}
        onpick={pick}
        oncommit={() => {
          // Only a search: what was typed without picking is no change of the receipt
          suche = '';
          notifyEdited?.();
        }}
      />
    {/snippet}
  </FormField>

  {#if bisher}
    <p class="text-sm text-neutral-800">
      Bisher angegeben: Aktion „{bisher.aktion}“.
      {#if bisher.unit}
        <button
          type="button"
          class="min-h-11 font-semibold text-link underline"
          onclick={() => {
            form.kostenstelle = bisher.unit!.name;
            onfield('kostenstelle');
            notifyEdited?.();
          }}>„{bisher.unit.name}“ als Kostenstelle übernehmen</button
        >
      {/if}
    </p>
  {/if}

  <div class="grid gap-4 sm:grid-cols-2">
    <FormField id="bl-kostenstelle" label="Kostenstelle" error={errors.kostenstelle}>
      {#snippet children(attrs)}
        <VorschlagFeld
          {...attrs}
          maxlength={120}
          placeholder="Auswählen oder neu eingeben"
          options={kostenstellen}
          maxResults={12}
          loading={kostenstellenStore.loading}
          listLabel="Kostenstelle auswählen"
          bind:value={form!.kostenstelle}
          onedit={() => onfield('kostenstelle')}
        />
      {/snippet}
    </FormField>
    <FormField id="bl-kategorie" label="Kategorie" error={errors.kategorie}>
      {#snippet children(attrs)}
        <VorschlagFeld
          {...attrs}
          maxlength={120}
          placeholder="Auswählen oder neu eingeben"
          options={kategorien}
          maxResults={12}
          loading={kostenstellenStore.loading}
          listLabel="Kategorie auswählen"
          bind:value={form!.kategorie}
          onedit={() => onfield('kategorie')}
          oncommit={(text) => (form.kategorie = kategorieSchreibweise(text))}
        />
      {/snippet}
    </FormField>
  </div>

  {#if stand?.archiviert}
    <p role="status" class="rounded-md bg-danger/10 p-3 text-sm text-danger">
      Die Kostenstelle „{form.kostenstelle.trim()}“ ist in CampFlow archiviert. Bitte wähle eine
      andere.
    </p>
  {:else if stand && (stand.neueKostenstelle || stand.neueKategorie)}
    <p role="status" class="rounded-md bg-warning-soft p-3 text-sm text-warning">
      {#if stand.neueKostenstelle}
        Die Kostenstelle „{form.kostenstelle.trim()}“ gibt es in CampFlow noch nicht. Sie wird beim
        Übertragen neu angelegt{stand.neueKategorie
          ? `, mit der neuen Kategorie „${form.kategorie.trim()}“`
          : ''}.
      {:else}
        Die Kategorie „{form.kategorie.trim()}“ gibt es in „{form.kostenstelle.trim()}“ noch nicht.
        Sie wird beim Übertragen neu angelegt.
      {/if}
      Prüfe die Schreibweise, damit nichts doppelt entsteht.
    </p>
  {/if}
  {#if kostenstellenStore.error && !kostenstellenStore.data}
    <p class="text-sm text-neutral-700">
      Die Kostenstellen aus CampFlow konnten nicht geladen werden.
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        disabled={kostenstellenStore.loading}
        onclick={() => void fetchKostenstellen({ force: true })}>Erneut versuchen</button
      >
    </p>
  {/if}
</div>
