<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import {
    formatTimestamp,
    matchingKostenstelle,
    type BelegForm,
    type CampflowChoice,
  } from '../../lib/belegForm';

  interface Props {
    form: BelegForm;
    busy: boolean;
    ontransfer: (choice: CampflowChoice) => void;
  }
  let { form, busy, ontransfer }: Props = $props();

  const transfer = $derived(form.campflow);
  /** After an unclear attempt only the same Kostenstelle and Kategorie find what it created. */
  const locked = $derived(transfer?.state === 'Gestartet');
  const uploaded = $derived(transfer?.state === 'Hochgeladen');
  const units = $derived((kostenstellenStore.data ?? []).filter((k) => !k.archived));

  let costUnitId = $state('');
  let categoryId = $state('');
  const categories = $derived(units.find((k) => k.id === costUnitId)?.categories ?? []);

  $effect(() => {
    untrack(() => void fetchKostenstellen());
  });

  // After an unclear attempt the server books on its target whatever is chosen here, so the
  // dialog always shows that target, also when the state arrives after a choice was made
  $effect(() => {
    const last = transfer;
    if (last?.state !== 'Gestartet') return;
    untrack(() => {
      costUnitId = last.costUnitId;
      categoryId = last.categoryId;
    });
  });

  // Preselect the last attempt's choice, or the Kostenstelle named like the Aktion
  $effect(() => {
    const data = kostenstellenStore.data;
    const last = transfer;
    untrack(() => {
      if (!data || costUnitId) return;
      if (last && last.state !== 'Hochgeladen') {
        costUnitId = last.costUnitId;
        categoryId = last.categoryId;
        return;
      }
      const match = matchingKostenstelle(form.aktion, data);
      if (!match) return;
      costUnitId = match.id;
      if (match.categories.length === 1) categoryId = match.categories[0]!.id;
    });
  });

  // A Kostenstelle or Kategorie gone from CampFlow since it was chosen is chosen no longer
  $effect(() => {
    const available = units;
    if (locked) return;
    untrack(() => {
      if (costUnitId && !available.some((k) => k.id === costUnitId)) {
        costUnitId = '';
        categoryId = '';
      } else if (categoryId && !categories.some((c) => c.id === categoryId)) {
        categoryId = '';
      }
    });
  });

  function selectCostUnit(id: string): void {
    costUnitId = id;
    const options = units.find((k) => k.id === id)?.categories ?? [];
    categoryId = options.length === 1 ? options[0]!.id : '';
  }
</script>

<div class="space-y-3 border-t border-neutral-200 pt-4">
  <h3 class="flex items-center gap-1 text-sm font-semibold text-brand-900">
    Nach CampFlow übertragen
    <InfoHint
      label="Nach CampFlow übertragen"
      text={`Lädt das Foto als Beleg hoch und bucht es mit Geschäft, Datum, Betrag und Bemerkung als Ausgabe${form.payout ? `, Auslage durch ${form.paidBy}` : ''}. Danach wird der Beleg hier gelöscht.`}
    />
  </h3>
  {#if uploaded}
    <p class="text-sm text-neutral-800">
      In CampFlow als Beleg <strong>{transfer?.number}</strong> gebucht ({transfer?.costUnitName} ·
      {transfer?.categoryName}), mit dem Stand der Übertragung. Der Beleg wurde danach geändert und
      deshalb hier nicht gelöscht. Prüfe in CampFlow, ob die Änderungen dort stehen, und lösche ihn
      dann hier mit „Löschen“.
    </p>
  {:else}
    {#if transfer?.state === 'Gestartet'}
      <p role="status" class="rounded-md bg-warning-soft p-3 text-sm text-warning">
        Der letzte Versuch ({formatTimestamp(transfer.startedAt)}, {transfer.startedBy}) ist unklar
        ausgegangen{transfer.error ? `: ${transfer.error}` : ''}. Erneut übertragen ist sicher, ein
        schon angekommener Beleg wird erkannt und nicht doppelt angelegt.
      </p>
    {:else if transfer?.state === 'Fehlgeschlagen'}
      <p role="status" class="rounded-md bg-danger/10 p-3 text-sm text-danger">
        Der letzte Versuch hat nichts in CampFlow angelegt: {transfer.error}
      </p>
    {/if}
    <LoadState
      data={kostenstellenStore.data}
      loading={kostenstellenStore.loading}
      error={kostenstellenStore.error}
      loadingText="Kostenstellen werden geladen …"
      onretry={() => fetchKostenstellen({ force: true })}
    >
      {#snippet skeleton()}
        <p aria-hidden="true" class="text-sm text-neutral-700">Kostenstellen werden geladen …</p>
      {/snippet}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Kostenstelle</span>
          <select
            class="form-input mt-1"
            value={costUnitId}
            disabled={locked || busy}
            onchange={(event) => selectCostUnit(event.currentTarget.value)}
          >
            <option value="" disabled={!!costUnitId}>Kostenstelle wählen …</option>
            {#each units as unit (unit.id)}
              <option value={unit.id}>{unit.name}</option>
            {/each}
            {#if locked && transfer && !units.some((k) => k.id === transfer.costUnitId)}
              <option value={transfer.costUnitId}>{transfer.costUnitName}</option>
            {/if}
          </select>
        </label>
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Kategorie</span>
          <select
            class="form-input mt-1"
            bind:value={categoryId}
            disabled={locked || busy || !costUnitId}
          >
            <option value="" disabled={!!categoryId}>Kategorie wählen …</option>
            {#each categories as category (category.id)}
              <option value={category.id}>{category.name}</option>
            {/each}
            {#if locked && transfer && !categories.some((c) => c.id === transfer.categoryId)}
              <option value={transfer.categoryId}>{transfer.categoryName}</option>
            {/if}
          </select>
        </label>
      </div>
      {#if costUnitId && categories.length === 0 && !locked}
        <p class="text-sm text-neutral-700">
          Diese Kostenstelle hat in CampFlow keine Kategorien.
          <button
            type="button"
            class="text-link min-h-11 underline underline-offset-4"
            disabled={kostenstellenStore.loading}
            onclick={() => void fetchKostenstellen({ refresh: true })}
            >{kostenstellenStore.loading ? 'Lädt …' : 'Neu aus CampFlow laden'}</button
          >
        </p>
      {/if}
    </LoadState>
    <ActionButton
      variant="primary"
      type="button"
      disabled={busy || !costUnitId || !categoryId}
      onclick={() => ontransfer({ costUnitId, categoryId })}
      >{transfer ? 'Erneut übertragen' : 'Nach CampFlow übertragen'}</ActionButton
    >
  {/if}
</div>
