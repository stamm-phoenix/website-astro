<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { confirmAction } from '../../lib/confirm';
  import type { EinkaufListe, EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import { herkunft, type PostenHerkunft } from '../../lib/essensplanungHerkunft';
  import { einkaufInfo } from './einkaufInfo';
  import HerkunftUmschalter from './HerkunftUmschalter.svelte';
  import { KNOPF, herkunftAnzeige } from './einkaufHerkunft.svelte';
  import { einkaufStand } from '../../../../api/lib/essen-einkaeufe-model';
  import EinkaufForm from './EinkaufForm.svelte';
  import EinkaufListeAnsicht from './EinkaufListe.svelte';
  import EinkaufLive from './EinkaufLive.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import { meldeVerloren, type PlanKontext } from './planKontext';
  import {
    entwuerfe,
    festeEntwuerfe,
    offeneZeile,
    vergissEntwurf,
    vergissFest,
  } from './einkaufLive';
  import { einheitText } from '../../../../api/lib/essen-gerichte-model';

  /**
   * One shopping trip on its own, in place of the overview of the area: what it covers, how far
   * it is, and its list, to shop with in the live mode or to change by hand. It stays on the
   * page while hidden, so a started change form keeps what is typed.
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
    /** Whether this trip is shown now. */
    sichtbar: boolean;
    /** Shopping or the list; the overview opens it with one of them. */
    modus: 'live' | 'liste';
    onmodus: (modus: 'live' | 'liste') => void;
    onzurueck: () => void;
  }
  let { kontext, liste, bearbeiten, katalogGeladen, sichtbar, modus, onmodus, onzurueck }: Props =
    $props();
  const ansicht = $derived(kontext.ansicht);
  const einkauf = $derived(liste.einkauf);
  /** Shopping needs a trip still open, and the right to change. */
  const einkaufbar = $derived(bearbeiten && !einkauf.abgeschlossen);
  // In maintenance the live mode stays, locked, so what is typed there stays in view
  const ansichtArt = $derived(
    einkaufbar || (modus === 'live' && ansicht.wartung && !einkauf.abgeschlossen) ? modus : 'liste'
  );
  /** Whether the change form is shown. */
  let aendernOffen = $state(false);

  // Shown: the heading takes the focus, so the keyboard and screen readers start here
  let ueberschrift = $state<HTMLHeadingElement | null>(null);
  $effect(() => {
    if (!sichtbar) return;
    void tick().then(() => {
      ueberschrift?.scrollIntoView({ block: 'nearest' });
      ueberschrift?.focus({ preventScroll: true });
    });
  });

  /** The dishes of the meals this trip covers; a thing put here by hand brings all of them. */
  const herkunftBis = $derived(
    sichtbar && herkunftAnzeige.an
      ? herkunft(ansicht, einkauf.bisMahlzeitId)
      : new Map<number, PostenHerkunft>()
  );
  const herkunftAlle = $derived(
    sichtbar && herkunftAnzeige.an ? herkunft(ansicht) : new Map<number, PostenHerkunft>()
  );
  const herkunftVon = (posten: EinkaufListenPosten) =>
    (posten.regel === 'mit' ? herkunftAlle : herkunftBis).get(posten.planungZutatId);

  // Someone else deleted the trip: unsaved input of its rows (live mode, fixed amounts) is shown
  // to copy and dropped, so it does not ask on leaving the page for something no longer there
  $effect(() => () => {
    const { id, name } = einkauf;
    setTimeout(() => {
      if (kontext.ansicht.einkaeufe.some((e) => e.id === id)) return;
      // Keys are `<einkaufId>:<planungZutatId>` with the base unit after it in the live mode
      const zutat = (key: string) =>
        kontext.ansicht.zutaten.find((z) => z.id === Number(key.split(':')[1]))?.name ?? 'Zutat';
      for (const [key, e] of [...entwuerfe]) {
        if (!key.startsWith(`${id}:`)) continue;
        const eingabe = [
          e.menge.trim() ? `${e.menge.trim()} ${einheitText(e.einheit)}` : '',
          e.ersatz.trim() ? `→ ${e.ersatz.trim()}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        meldeVerloren(
          kontext,
          `Den Einkauf „${name}“ hat jemand gelöscht (deine Eingabe für ${zutat(key)}: ${eingabe}).`
        );
        vergissEntwurf(key);
      }
      for (const [key, e] of [...festeEntwuerfe]) {
        if (!key.startsWith(`${id}:`)) continue;
        meldeVerloren(
          kontext,
          `Den Einkauf „${name}“ hat jemand gelöscht (deine feste Menge für ${zutat(key)}: ${e.menge.trim()} ${einheitText(e.einheit)}).`
        );
        vergissFest(key);
      }
      offeneZeile.delete(id);
    });
  });
  /** The change form, once opened, stays until saved or cancelled, so its draft is kept. */
  let formular = $state(false);

  const info = $derived(einkaufInfo(ansicht, einkauf));

  async function loeschen(): Promise<void> {
    // The trip as it is seen now: something ticked off while the question is open is a conflict
    const { id, name } = einkauf;
    const stand = einkaufStand(einkauf);
    if (
      !(await confirmAction({
        title: `${name} löschen?`,
        message: liste.abgehakt
          ? 'Was in diesem Einkauf abgehakt ist, kommt dann nicht mehr ins Lager.'
          : 'Seine Posten verteilen sich dann auf die anderen Einkäufe.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/einkaeufe/${id}`, undefined, stand),
      `${name} gelöscht.`
    );
  }

  async function abschliessen(abgeschlossen: boolean): Promise<void> {
    // On the version seen when clicked, not one that arrives while a change before still runs
    const { id, name } = einkauf;
    const body = {
      etag: einkauf.etag,
      name: einkauf.name,
      datum: einkauf.datum,
      geschaeftId: einkauf.geschaeftId,
      bisMahlzeitId: einkauf.bisMahlzeitId,
      abgeschlossen,
    };
    const ok = await kontext.aendern(
      () => kontext.api.senden('PATCH', `/einkaeufe/${id}`, body),
      abgeschlossen ? `${name} abgeschlossen.` : `${name} ist wieder offen.`
    );
    if (ok && abgeschlossen) onmodus('liste');
  }
</script>

<section
  class="space-y-3"
  hidden={!sichtbar}
  aria-labelledby="einkauf-{einkauf.id}-heading"
  data-einkauf={einkauf.id}
>
  <div class="space-y-2 border-b border-neutral-300 pb-2">
    <button
      type="button"
      class="flex min-h-8 items-center gap-1 text-sm font-semibold text-link any-pointer-coarse:min-h-11"
      onclick={onzurueck}><span aria-hidden="true">←</span> Zurück zu den Einkäufen</button
    >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3
        id="einkauf-{einkauf.id}-heading"
        tabindex="-1"
        bind:this={ueberschrift}
        class="font-serif text-xl font-bold text-brand-900 [overflow-wrap:anywhere] focus:outline-none"
      >
        {einkauf.name}
      </h3>
      {#if einkauf.abgeschlossen}<span
          class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-700"
          >abgeschlossen</span
        >{/if}
      <span class="text-sm text-neutral-700">{info}</span>
    </div>
    <div class="flex items-center gap-2">
      <span
        class="h-2 w-40 max-w-full overflow-hidden rounded-full bg-neutral-200"
        aria-hidden="true"
      >
        <span
          class="block h-full bg-success"
          style:width="{liste.anzahl ? (liste.abgehakt / liste.anzahl) * 100 : 0}%"
        ></span>
      </span>
      <p class="text-sm font-semibold tabular-nums" role="status" aria-live="polite">
        {liste.abgehakt} von {liste.anzahl} abgehakt
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      {#if einkaufbar}
        <FilterTabs
          label="Ansicht von {einkauf.name}"
          variant="segmented"
          options={[
            { value: 'live', label: 'Einkaufen' },
            { value: 'liste', label: 'Liste anpassen' },
          ]}
          value={ansichtArt}
          onselect={(wert) => onmodus(wert)}
        />
      {/if}
      <HerkunftUmschalter />
      <span class="flex flex-wrap gap-1">
        <PdfKnopf
          {kontext}
          label="Einkauf als PDF"
          ariaLabel="{einkauf.name} als PDF"
          class={KNOPF}
          disabled={!katalogGeladen}
          erstellen={async () => {
            const { downloadEinkaufPdf } = await import('../../lib/essensplanungPdf');
            await downloadEinkaufPdf(ansicht, liste, info);
          }}
        />
        {#if bearbeiten}
          <ActionButton
            type="button"
            class={KNOPF}
            aria-expanded={aendernOffen}
            aria-label="{einkauf.name} ändern"
            onclick={() => {
              formular = true;
              aendernOffen = !aendernOffen;
            }}>Ändern</ActionButton
          >
          <ActionButton
            type="button"
            class={KNOPF}
            disabled={kontext.busy}
            aria-label="{einkauf.name} {einkauf.abgeschlossen ? 'wieder öffnen' : 'abschließen'}"
            onclick={() => void abschliessen(!einkauf.abgeschlossen)}
            >{einkauf.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}</ActionButton
          >
          <ActionButton
            type="button"
            variant="danger"
            class={KNOPF}
            disabled={kontext.busy}
            aria-label="{einkauf.name} löschen"
            onclick={() => void loeschen()}>Löschen</ActionButton
          >
        {/if}
      </span>
    </div>
  </div>
  {#if formular}
    <div hidden={!aendernOffen}>
      <EinkaufForm
        {kontext}
        {einkauf}
        gesperrt={!bearbeiten}
        onfertig={() => {
          formular = false;
          aendernOffen = false;
        }}
      />
    </div>
  {/if}
  {#if sichtbar}
    {#if ansichtArt === 'live' && !katalogGeladen}
      <p class="text-sm text-neutral-700" role="status">Liste wird geladen …</p>
    {:else if ansichtArt === 'live'}
      <EinkaufLive {kontext} {liste} gesperrt={!bearbeiten} herkunft={herkunftVon} />
    {:else}
      <div class="space-y-3">
        <EinkaufListeAnsicht {kontext} {liste} {bearbeiten} herkunft={herkunftVon} />
      </div>
    {/if}
  {/if}
</section>
