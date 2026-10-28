<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { fetchKostenstellen, kostenstellenStore } from '../../lib/abrechnungStore.svelte';
  import { formatTimestamp, type BelegForm } from '../../lib/belegForm';
  import { zuordnungStand } from '../../lib/belegZuordnung';

  interface Props {
    form: BelegForm;
    busy: boolean;
    ontransfer: () => void;
  }
  let { form, busy, ontransfer }: Props = $props();

  const transfer = $derived(form.campflow);
  /** After an unclear attempt only the same Kostenstelle and Kategorie find what it created. */
  const locked = $derived(transfer?.state === 'Gestartet');
  const uploaded = $derived(transfer?.state === 'Hochgeladen');
  const kostenstelle = $derived(form.kostenstelle.trim());
  const kategorie = $derived(form.kategorie.trim());
  const stand = $derived(zuordnungStand(kostenstellenStore.data, kostenstelle, kategorie));
  /** What the transfer creates in CampFlow before it books; a standard Kategorie goes unmentioned. */
  const neu = $derived.by(() => {
    if (locked || !stand || stand.archiviert) return null;
    if (stand.neueKostenstelle) {
      return `Dabei wird in CampFlow die Kostenstelle „${kostenstelle}“ mit der Kategorie „${kategorie}“ neu angelegt.`;
    }
    if (stand.neueKategorie) {
      return `Dabei wird in „${kostenstelle}“ die Kategorie „${kategorie}“ neu angelegt.`;
    }
    return null;
  });

  $effect(() => {
    untrack(() => void fetchKostenstellen());
  });
</script>

<div class="space-y-3 border-t border-neutral-200 pt-4">
  <h3 class="flex items-center gap-1 text-sm font-semibold text-brand-900">
    Nach CampFlow übertragen
    <InfoHint
      label="Nach CampFlow übertragen"
      text={form.art === 'Einnahme'
        ? `Lädt ${form.isPdf ? 'das PDF' : 'das Foto'} als Beleg hoch und bucht es mit „Einnahme von“, Datum, Betrag und Bemerkung als Einnahme. Danach wird der Beleg hier gelöscht.`
        : `Lädt ${form.isPdf ? 'das PDF' : 'das Foto'} als Beleg hoch und bucht es mit Geschäft, Datum, Betrag und Bemerkung als Ausgabe${form.payout ? `, Auslage durch ${form.paidBy}` : ''}. Danach wird der Beleg hier gelöscht.`}
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
    {#if locked && transfer}
      <p class="text-sm text-neutral-800">
        Wird wie beim letzten Versuch gebucht auf <strong>{transfer.costUnitName}</strong> ·
        <strong>{transfer.categoryName}</strong>.
      </p>
    {:else if kostenstelle && kategorie}
      <p class="text-sm text-neutral-800">
        Wird gebucht auf <strong>{kostenstelle}</strong> · <strong>{kategorie}</strong>.
      </p>
      {#if neu}
        <p role="status" class="rounded-md bg-warning-soft p-3 text-sm text-warning">
          {neu} Prüfe die Schreibweise, damit nichts doppelt entsteht.
        </p>
      {/if}
    {:else}
      <p class="text-sm text-neutral-800">Bitte oben Kostenstelle und Kategorie eintragen.</p>
    {/if}
    <ActionButton
      variant="primary"
      type="button"
      disabled={busy || (!locked && (!kostenstelle || !kategorie || !!stand?.archiviert))}
      onclick={ontransfer}
      >{transfer ? 'Erneut übertragen' : 'Nach CampFlow übertragen'}</ActionButton
    >
  {/if}
</div>
