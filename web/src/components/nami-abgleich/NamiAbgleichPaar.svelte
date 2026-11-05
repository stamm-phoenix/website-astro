<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import {
    nichtGeladen,
    personName,
    unsicher,
    unterschiede,
    VERBINDUNG_LABEL,
    type AbgleichFeld,
    type AbgleichPaar,
  } from '../../lib/namiAbgleich';

  interface Props {
    paar: AbgleichPaar;
  }
  let { paar }: Props = $props();

  let alle = $state(false);
  const anzahl = $derived(unterschiede(paar));
  const offen = $derived(nichtGeladen(paar));
  const felder = $derived(alle ? paar.felder : paar.felder.filter((feld) => feld.gleich !== true));
  const namiName = $derived(personName(paar.nami));
  const campflowName = $derived(personName(paar.campflow));

  function wert(text: string): string {
    return text || '–';
  }
</script>

{#snippet zeile(feld: AbgleichFeld)}
  <div class="py-2 sm:grid sm:grid-cols-[9rem_1fr_1fr] sm:gap-4">
    <dt class="font-semibold text-neutral-700">
      {feld.label}
      {#if feld.gleich === false}<span class="sr-only">(unterschiedlich)</span>{/if}
    </dt>
    <dd class="break-words" class:text-danger={feld.gleich === false}>
      <span class="mr-1 text-neutral-700 sm:sr-only">NaMi:</span>{feld.gleich === null
        ? 'Nicht geladen'
        : wert(feld.nami)}
    </dd>
    <dd class="break-words" class:text-danger={feld.gleich === false}>
      <span class="mr-1 text-neutral-700 sm:sr-only">CampFlow:</span>{wert(feld.campflow)}
    </dd>
  </div>
{/snippet}

<li class="space-y-2 py-4">
  <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    <div class="min-w-0">
      <p class="font-semibold text-brand-900">
        {namiName}{#if campflowName !== namiName}
          <span class="font-normal text-neutral-700"> · in CampFlow: {campflowName}</span>{/if}
      </p>
      <p class="text-sm text-neutral-700">{VERBINDUNG_LABEL[paar.verbindung]}</p>
    </div>
    <span class="shrink-0 text-sm">
      {#if unsicher(paar.verbindung)}
        <StatusLabel label="Bitte prüfen, ob es dieselbe Person ist" tone="warning" dot />
      {:else if anzahl > 0}
        <StatusLabel
          label={anzahl === 1 ? '1 Unterschied' : `${anzahl} Unterschiede`}
          tone="danger"
          dot
        />
      {:else if offen > 0}
        <StatusLabel label="Adresse aus NaMi nicht geladen" tone="warning" dot />
      {:else}
        <StatusLabel label="Stimmt überein" tone="success" />
      {/if}
    </span>
  </div>

  {#if felder.length > 0}
    <dl class="divide-y divide-neutral-200 text-sm">
      <div class="hidden pb-1 text-neutral-700 sm:grid sm:grid-cols-[9rem_1fr_1fr] sm:gap-4">
        <dt><span class="sr-only">Angabe</span></dt>
        <dd class="font-semibold">NaMi</dd>
        <dd class="font-semibold">CampFlow</dd>
      </div>
      {#each felder as feld (feld.feld)}{@render zeile(feld)}{/each}
    </dl>
  {/if}
  <button
    type="button"
    class="inline-flex min-h-11 items-center text-sm text-link underline underline-offset-4"
    aria-expanded={alle}
    onclick={() => (alle = !alle)}
  >
    {alle ? 'Nur Unterschiede zeigen' : 'Alle Angaben zeigen'}
  </button>
</li>
