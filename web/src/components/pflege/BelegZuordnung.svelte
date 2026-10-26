<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import FormField from './FormField.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import { matchingKostenstelle, type BelegForm } from '../../lib/belegForm';
  import {
    isStandardKategorie,
    kategorieSchreibweise,
    kategorieVorschlaege,
    sameName,
    zuordnungStand,
    zuordnungTreffer,
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
  const kostenstellen = $derived(zuordnungVorschlaege(units, form.kostenstelle));
  /** The field Kostenstelle is a search too: what is being typed there is no new name yet. */
  let suchtKostenstelle = $state(false);
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

  /** A Kategorie fills both fields; a Kostenstelle keeps a Kategorie that suits it. */
  function pick(option: Vorschlag): void {
    const { kostenstelle, kategorie } = zuordnungTreffer(units, option);
    form.kostenstelle = kostenstelle;
    const own = units.find((unit) => sameName(unit.name, kostenstelle))?.categories ?? [];
    const fits =
      isStandardKategorie(form.kategorie) || own.some((c) => sameName(c.name, form.kategorie));
    if (kategorie !== null || !fits) form.kategorie = kategorie ?? '';
    onfield('kategorie');
  }
</script>

<div class="space-y-3 sm:col-span-2">
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
    <div
      onfocusin={() => (suchtKostenstelle = true)}
      onfocusout={() => (suchtKostenstelle = false)}
    >
      <FormField id="bl-kostenstelle" label="Kostenstelle" error={errors.kostenstelle}>
        {#snippet children(attrs)}
          <VorschlagFeld
            {...attrs}
            maxlength={120}
            placeholder="Suchen, z. B. Leitendenrunde"
            options={kostenstellen}
            maxResults={12}
            loading={kostenstellenStore.loading}
            listLabel="Kostenstelle oder Kategorie auswählen"
            bind:value={form!.kostenstelle}
            onedit={() => onfield('kostenstelle')}
            onpick={pick}
          />
        {/snippet}
      </FormField>
    </div>
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
  {:else if stand && (stand.neueKostenstelle ? !suchtKostenstelle : stand.neueKategorie)}
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
      <MessageText text={kostenstellenStore.error} />
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        disabled={kostenstellenStore.loading}
        onclick={() => void fetchKostenstellen({ force: true })}>Erneut versuchen</button
      >
    </p>
  {/if}
</div>
