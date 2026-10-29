<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { datumKurz } from '../../lib/essensplanung';
  import type { EinkaufListe } from '../../lib/essensplanungEinkaeufe';
  import { einkaufStand } from '../../../../api/lib/essen-einkaeufe-model';
  import EinkaufForm from './EinkaufForm.svelte';
  import EinkaufListeAnsicht from './EinkaufListe.svelte';
  import EinkaufLive from './EinkaufLive.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * One shopping trip: what it covers, how far it is, and its list, to change by hand or to shop
   * with in the live mode.
   */

  interface Props {
    kontext: PlanKontext;
    liste: EinkaufListe;
    bearbeiten: boolean;
    /**
     * Whether the names of the categories are there: the PDF and the live mode wait for them, so
     * no row moves to its category while something is typed into it.
     */
    katalogGeladen: boolean;
  }
  let { kontext, liste, bearbeiten, katalogGeladen }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const einkauf = $derived(liste.einkauf);

  let ansichtArt = $state<'zu' | 'liste' | 'live' | 'aendern'>('zu');
  /** The change form, once opened, stays until saved or cancelled, so its draft is kept. */
  let formular = $state(false);

  const info = $derived.by(() => {
    const geschaeft = ansicht.geschaefte.find((g) => g.id === einkauf.geschaeftId)?.name;
    const mahlzeit = ansicht.tage
      .flatMap((t) => t.mahlzeiten)
      .find((m) => m.id === einkauf.bisMahlzeitId);
    return [
      einkauf.datum ? datumKurz(einkauf.datum) : '',
      geschaeft ?? 'alle Geschäfte',
      mahlzeit ? `bis ${mahlzeit.kennung} ${mahlzeit.name}` : 'alle Mahlzeiten',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  async function loeschen(): Promise<void> {
    if (
      !(await confirmAction({
        title: `${einkauf.name} löschen?`,
        message: liste.abgehakt
          ? 'Was in diesem Einkauf abgehakt ist, kommt dann nicht mehr ins Lager.'
          : 'Seine Posten verteilen sich dann auf die anderen Einkäufe.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () =>
        kontext.api.senden('DELETE', `/einkaeufe/${einkauf.id}`, undefined, einkaufStand(einkauf)),
      `${einkauf.name} gelöscht.`
    );
  }

  async function abschliessen(abgeschlossen: boolean): Promise<void> {
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PATCH', `/einkaeufe/${einkauf.id}`, {
          etag: einkauf.etag,
          name: einkauf.name,
          datum: einkauf.datum,
          geschaeftId: einkauf.geschaeftId,
          bisMahlzeitId: einkauf.bisMahlzeitId,
          abgeschlossen,
        }),
      abgeschlossen ? `${einkauf.name} abgeschlossen.` : `${einkauf.name} ist wieder offen.`
    );
    if (ok && abgeschlossen) ansichtArt = 'zu';
  }
</script>

<li class="surface space-y-3 p-3">
  <div class="space-y-1">
    <h4 class="text-base font-bold text-brand-900 [overflow-wrap:anywhere]">
      {einkauf.name}
      {#if einkauf.abgeschlossen}<span
          class="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-sm font-semibold text-neutral-700"
          >abgeschlossen</span
        >{/if}
    </h4>
    <p class="text-sm text-neutral-700">{info}</p>
    <p class="text-sm">
      {liste.anzahl} Posten · {liste.abgehakt} von {liste.anzahl} abgehakt
    </p>
  </div>
  <div class="flex flex-wrap gap-2">
    {#if (bearbeiten && !einkauf.abgeschlossen) || ansichtArt === 'live'}
      <ActionButton
        type="button"
        variant={ansichtArt === 'live' ? 'secondary' : 'primary'}
        aria-pressed={ansichtArt === 'live'}
        disabled={ansichtArt !== 'live' && !katalogGeladen}
        aria-label="{einkauf.name}: {ansichtArt === 'live' ? 'Einkaufen beenden' : 'Einkaufen'}"
        onclick={() => (ansichtArt = ansichtArt === 'live' ? 'zu' : 'live')}
        >{ansichtArt === 'live' ? 'Fertig' : 'Einkaufen'}</ActionButton
      >
    {/if}
    <ActionButton
      type="button"
      aria-expanded={ansichtArt === 'liste'}
      aria-label="Liste von {einkauf.name}"
      onclick={() => (ansichtArt = ansichtArt === 'liste' ? 'zu' : 'liste')}>Liste</ActionButton
    >
    <PdfKnopf
      {kontext}
      label="Einkauf als PDF"
      ariaLabel="{einkauf.name} als PDF"
      disabled={!katalogGeladen}
      erstellen={async () => {
        const { downloadEinkaufPdf } = await import('../../lib/essensplanungPdf');
        await downloadEinkaufPdf(ansicht, liste, info);
      }}
    />
    {#if bearbeiten}
      <ActionButton
        type="button"
        aria-label="{einkauf.name} ändern"
        onclick={() => {
          formular = true;
          ansichtArt = ansichtArt === 'aendern' ? 'zu' : 'aendern';
        }}>Ändern</ActionButton
      >
      <ActionButton
        type="button"
        disabled={kontext.busy}
        aria-label="{einkauf.name} {einkauf.abgeschlossen ? 'wieder öffnen' : 'abschließen'}"
        onclick={() => void abschliessen(!einkauf.abgeschlossen)}
        >{einkauf.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}</ActionButton
      >
      <ActionButton
        type="button"
        variant="danger"
        disabled={kontext.busy}
        aria-label="{einkauf.name} löschen"
        onclick={() => void loeschen()}>Löschen</ActionButton
      >
    {/if}
  </div>
  {#if formular}
    <div hidden={ansichtArt !== 'aendern'}>
      <EinkaufForm
        {kontext}
        {einkauf}
        gesperrt={!bearbeiten}
        onfertig={() => {
          formular = false;
          ansichtArt = 'zu';
        }}
      />
    </div>
  {/if}
  {#if ansichtArt === 'live'}
    <EinkaufLive {kontext} {liste} gesperrt={!bearbeiten} />
  {:else if ansichtArt === 'liste'}
    <div class="space-y-2">
      <EinkaufListeAnsicht {kontext} {liste} {bearbeiten} />
    </div>
  {/if}
</li>
