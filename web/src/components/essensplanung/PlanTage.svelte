<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { datumKurz } from '../../lib/essensplanung';
  import type { PlanungTag } from '../../lib/types';
  import MahlzeitZeile from './MahlzeitZeile.svelte';
  import EinplanungDialog from './EinplanungDialog.svelte';
  import MahlzeitGruppenDialog from './MahlzeitGruppenDialog.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PlanKalender from './PlanKalender.svelte';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { tagStand } from '../../../../api/lib/essen-planung-model';
  import type { PlanKontext } from './planKontext';

  /** Days and meals of a Planung; shown IDs like `3_1` follow the order. */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  /**
   * The names of the intolerances, for the amounts of lines „nur bei …“ or „nicht bei …“;
   * loaded only when a dish has such a line.
   */
  let unvertraeglichkeiten = $state(new Map<number, string>());
  const brauchtNamen = $derived(
    ansicht.gerichte.some((g) => g.zutaten.some((z) => z.ohne.length || z.nur.length))
  );
  /** The `katalogStand` the names were loaded for. */
  let geladen: string | null = null;
  async function namenLaden(): Promise<void> {
    geladen = ansicht.katalogStand;
    try {
      const katalog = await kontext.api.katalog();
      unvertraeglichkeiten = new Map(katalog.unvertraeglichkeiten.map((u) => [u.id, u.name]));
    } catch {
      // The amounts then say that the names are missing; the next view tries again
      geladen = null;
    }
  }
  $effect(() => {
    if (sichtbar && brauchtNamen && ansicht.katalogStand !== geladen)
      untrack(() => void namenLaden());
  });

  /** List or calendar; each viewer's choice is remembered in this browser. */
  const DARSTELLUNG_KEY = 'essensplanung:darstellung';
  let darstellung = $state<'liste' | 'kalender'>(gemerkteDarstellung());
  function gemerkteDarstellung(): 'liste' | 'kalender' {
    try {
      return localStorage.getItem(DARSTELLUNG_KEY) === 'kalender' ? 'kalender' : 'liste';
    } catch {
      return 'liste';
    }
  }
  function zeige(art: 'liste' | 'kalender'): void {
    darstellung = art;
    try {
      localStorage.setItem(DARSTELLUNG_KEY, art);
    } catch {
      // Without storage the choice holds until the page is left
    }
  }

  /** Ticking off happens in the list: the calendar opens it there at the planned dish. */
  async function abhaken(einplanungId: number): Promise<void> {
    zeige('liste');
    await tick();
    const teil = document.querySelector<HTMLDetailsElement>(
      `details[data-abhaken="${einplanungId}"]`
    );
    if (!teil) return;
    teil.open = true;
    teil.scrollIntoView({ block: 'center' });
    teil.querySelector('summary')?.focus();
  }

  /** The plan as PDF; the names of the intolerances first, when lines need them. */
  async function planPdf(): Promise<void> {
    let namen = unvertraeglichkeiten;
    if (brauchtNamen && !namen.size) {
      const katalog = await kontext.api.katalog();
      namen = new Map(katalog.unvertraeglichkeiten.map((u) => [u.id, u.name]));
    }
    const { downloadPlanPdf } = await import('../../lib/essensplanungPdf');
    await downloadPlanPdf(ansicht, namen);
  }
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The open dialog of planned dishes; it stays when its meal goes, so no input is lost. */
  let auftrag = $state<Auftrag | null>(null);
  /** The meal whose groups are open in a dialog. */
  let gruppenMahlzeit = $state<number | null>(null);

  let neuerTag = $state('');
  let neueMahlzeit = $state<Record<number, string>>({});
  /** Dates picked for existing days and not saved yet, e.g. after a failed save. */
  let neuesDatum = $state<Record<number, string>>({});
  // A day, a meal or a date typed but not saved asks before leaving the page
  $effect(() =>
    guardUnsavedChanges(
      () =>
        neuerTag !== '' ||
        Object.values(neueMahlzeit).some((name) => name.trim() !== '') ||
        Object.keys(neuesDatum).length > 0
    )
  );

  function vorschlagNeuerTag(): string {
    const letzter = ansicht.tage.at(-1)?.datum;
    if (!letzter) return '';
    return new Date(Date.parse(`${letzter}T00:00:00Z`) + 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
  }

  async function tagHinzufuegen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const gesendet = neuerTag;
    const datum = gesendet || vorschlagNeuerTag();
    if (!datum) return;
    if (
      (await kontext.aendern(
        () => kontext.api.senden('POST', '/tage', { datum }),
        `Tag ${datumKurz(datum)} hinzugefügt.`
      )) &&
      // A date picked again while adding stays
      neuerTag === gesendet
    )
      neuerTag = '';
  }

  async function tagVerschieben(tag: PlanungTag, datum: string): Promise<void> {
    if (!datum || datum === tag.datum) {
      delete neuesDatum[tag.id];
      return;
    }
    neuesDatum[tag.id] = datum;
    const ok = await kontext.aendern(
      () => kontext.api.senden('PATCH', `/tage/${tag.id}`, { etag: tag.etag, datum }),
      `Tag ${tag.nummer} liegt jetzt am ${datumKurz(datum)}.`
    );
    // A failed save keeps the picked date in the field until it is saved or set back
    if (ok && neuesDatum[tag.id] === datum) delete neuesDatum[tag.id];
  }

  async function tagLoeschen(tag: PlanungTag): Promise<void> {
    // The day as asked about, with its meals and dishes: a change of others is a conflict
    const { id } = tag;
    const stand = tagStand(tag);
    const gerichte = tag.mahlzeiten.reduce((summe, m) => summe + m.einplanungen.length, 0);
    if (
      !(await confirmAction({
        title: `Tag ${tag.nummer} löschen?`,
        message: `${datumKurz(tag.datum)} mit allen ${tag.mahlzeiten.length} Mahlzeiten${gerichte ? ` und ${gerichte === 1 ? 'dem eingeplanten Gericht' : `${gerichte} eingeplanten Gerichten`}` : ''} wird gelöscht. Die Nummern der folgenden Tage rücken nach.`,
        confirmLabel: 'Tag löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/tage/${id}`, undefined, stand),
      'Tag gelöscht.'
    );
  }

  async function mahlzeitHinzufuegen(event: SubmitEvent, tag: PlanungTag): Promise<void> {
    event.preventDefault();
    const gesendet = neueMahlzeit[tag.id] ?? '';
    const name = gesendet.trim();
    if (!name) return;
    if (
      (await kontext.aendern(
        () => kontext.api.senden('POST', '/mahlzeiten', { tagId: tag.id, name }),
        `${name} hinzugefügt.`
      )) &&
      // The next meal typed while adding stays
      neueMahlzeit[tag.id] === gesendet
    )
      neueMahlzeit[tag.id] = '';
  }
</script>

<section aria-labelledby="plan-heading" class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h3 id="plan-heading" class="sr-only">Tage und Mahlzeiten</h3>
    <FilterTabs
      label="Darstellung"
      variant="segmented"
      options={[
        { value: 'liste', label: 'Liste' },
        { value: 'kalender', label: 'Kalender' },
      ]}
      value={darstellung}
      onselect={zeige}
    />
    <PdfKnopf {kontext} label="Plan als PDF" erstellen={planPdf} />
  </div>
  {#if ansicht.tage.length === 0}
    <p class="text-neutral-700">Die Planung hat noch keine Tage.</p>
  {:else if darstellung === 'kalender'}
    <PlanKalender
      {kontext}
      {bearbeiten}
      oneinplanen={(neu) => (auftrag = neu)}
      onabhaken={abhaken}
    />
  {/if}
  <ol class="space-y-6" hidden={darstellung === 'kalender'}>
    {#each ansicht.tage as tag (tag.id)}
      <li class="surface p-4 md:p-5" aria-labelledby="tag-{tag.id}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h4 id="tag-{tag.id}" class="font-serif text-lg font-bold text-brand-900">
            Tag {tag.nummer}
            <span class="font-sans text-base font-normal">· {datumKurz(tag.datum)}</span>
          </h4>
          {#if bearbeiten}
            <div class="flex flex-wrap items-center gap-2 print:hidden">
              <label class="sr-only" for="tag-datum-{tag.id}">Datum von Tag {tag.nummer}</label>
              <input
                id="tag-datum-{tag.id}"
                type="date"
                class="form-input w-auto"
                value={neuesDatum[tag.id] ?? tag.datum}
                disabled={kontext.busy}
                onchange={(event) => void tagVerschieben(tag, event.currentTarget.value)}
              />
              <ActionButton
                type="button"
                variant="danger"
                disabled={kontext.busy}
                aria-label="Tag {tag.nummer} löschen"
                onclick={() => void tagLoeschen(tag)}>Löschen</ActionButton
              >
            </div>
          {/if}
        </div>
        <ul class="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
          {#each tag.mahlzeiten as mahlzeit, index (mahlzeit.id)}
            <MahlzeitZeile
              {kontext}
              {mahlzeit}
              {bearbeiten}
              erste={index === 0}
              letzte={index === tag.mahlzeiten.length - 1}
              oneinplanen={(neu) => (auftrag = neu)}
              ongruppen={(id) => (gruppenMahlzeit = id)}
              {unvertraeglichkeiten}
            />
          {:else}
            <li class="py-2 text-sm text-neutral-700">Noch keine Mahlzeiten.</li>
          {/each}
        </ul>
        {#if bearbeiten}
          <form
            class="mt-3 flex flex-wrap items-end gap-2 print:hidden"
            onsubmit={(event) => void mahlzeitHinzufuegen(event, tag)}
          >
            <div class="min-w-0 flex-1">
              <label class="form-label" for="neue-mahlzeit-{tag.id}"
                >Neue Mahlzeit an Tag {tag.nummer}</label
              >
              <input
                id="neue-mahlzeit-{tag.id}"
                class="form-input"
                maxlength="50"
                placeholder="z. B. Nachtwanderungs-Snack"
                bind:value={neueMahlzeit[tag.id]}
              />
            </div>
            <ActionButton
              type="submit"
              disabled={kontext.busy || !(neueMahlzeit[tag.id] ?? '').trim()}
              >Hinzufügen</ActionButton
            >
          </form>
        {/if}
      </li>
    {/each}
  </ol>

  {#if bearbeiten && darstellung === 'liste'}
    <form class="flex flex-wrap items-end gap-2 print:hidden" onsubmit={tagHinzufuegen}>
      <div>
        <label class="form-label" for="neuer-tag">Weiterer Tag</label>
        <input id="neuer-tag" type="date" class="form-input" bind:value={neuerTag} />
      </div>
      <ActionButton type="submit" disabled={kontext.busy || (!neuerTag && !ansicht.tage.length)}>
        {neuerTag ? 'Tag hinzufügen' : 'Tag danach hinzufügen'}
      </ActionButton>
    </form>
  {/if}
</section>

<EinplanungDialog {kontext} {auftrag} onclose={() => (auftrag = null)} />
<MahlzeitGruppenDialog
  {kontext}
  mahlzeitId={gruppenMahlzeit}
  onclose={() => (gruppenMahlzeit = null)}
/>
