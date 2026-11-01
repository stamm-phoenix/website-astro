<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { esserRechner } from '../../lib/essensplanungRechnung';
  import GerichteLeiste from './GerichteLeiste.svelte';
  import { aufklappen } from './EinplanungKarte.svelte';
  import { KNOPF, SYMBOL } from './planAktionen';
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
  import { meldeVerloren, type PlanKontext } from './planKontext';
  import { getippt, slotEntwuerfe } from './slotEntwuerfe.svelte';

  /**
   * Days and meals of a Planung as a list (a table per day) or a calendar, next to the list of
   * all dishes to drag in; shown IDs like `3_1` follow the order.
   */

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

  const esser = $derived(esserRechner(ansicht));

  /** Amounts and what a dish used are in the list: the calendar unfolds it there. */
  async function mengen(einplanungId: number): Promise<void> {
    zeige('liste');
    await tick();
    aufklappen.id = einplanungId;
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
        Object.keys(neuesDatum).length > 0 ||
        Object.values(slotEntwuerfe).some(getippt)
    )
  );

  // The drafts live as long as the page of this Planung: leaving it (after „Änderungen
  // verwerfen“) drops them, so they come back neither here nor in another Planung
  onDestroy(() => {
    for (const id of Object.keys(slotEntwuerfe)) delete slotEntwuerfe[Number(id)];
  });

  // A dish typed into a meal someone else deleted: the draft goes, and is named to copy
  $effect(() => {
    const da = new Set(ansicht.tage.flatMap((tag) => tag.mahlzeiten.map((m) => m.id)));
    untrack(() => {
      for (const [id, entwurf] of Object.entries(slotEntwuerfe)) {
        if (da.has(Number(id))) continue;
        delete slotEntwuerfe[Number(id)];
        if (!getippt(entwurf)) continue;
        const eingabe = [entwurf.name.trim(), entwurf.zustaendig.trim()].filter(Boolean).join(', ');
        meldeVerloren(
          kontext,
          `${entwurf.mahlzeit} wurde gerade gelöscht. Dein Gericht „${eingabe}“ war noch nicht eingetragen.`
        );
      }
    });
  });

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

<section aria-labelledby="plan-heading" class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
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
  <div class="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
    <div class="min-w-0 space-y-3 lg:order-first">
      {#if ansicht.tage.length === 0}
        <p class="text-neutral-700">Die Planung hat noch keine Tage.</p>
      {:else if darstellung === 'kalender'}
        <PlanKalender
          {kontext}
          {bearbeiten}
          {esser}
          oneinplanen={(neu) => (auftrag = neu)}
          onmengen={mengen}
        />
      {/if}
      <ol class="space-y-3" hidden={darstellung === 'kalender'}>
        {#each ansicht.tage as tag (tag.id)}
          <li class="surface overflow-hidden" aria-labelledby="tag-{tag.id}">
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-300 bg-neutral-100 px-2 py-1"
            >
              <h4 id="tag-{tag.id}" class="font-semibold text-brand-900">
                Tag {tag.nummer}
                <span class="font-normal text-neutral-700">· {datumKurz(tag.datum)}</span>
              </h4>
              {#if bearbeiten}
                <span class="ml-auto flex items-center gap-1 print:hidden">
                  <label class="sr-only" for="tag-datum-{tag.id}">Datum von Tag {tag.nummer}</label>
                  <input
                    id="tag-datum-{tag.id}"
                    type="date"
                    class="form-input mt-0 min-h-0 w-auto px-1.5 py-0.5 text-xs any-pointer-coarse:min-h-11"
                    value={neuesDatum[tag.id] ?? tag.datum}
                    disabled={kontext.busy}
                    onchange={(event) => void tagVerschieben(tag, event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="{SYMBOL} hover:text-danger"
                    disabled={kontext.busy}
                    title="Tag löschen"
                    aria-label="Tag {tag.nummer} löschen"
                    onclick={() => void tagLoeschen(tag)}
                    ><svg
                      viewBox="0 0 24 24"
                      class="size-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                      ><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
                    ></button
                  >
                </span>
              {/if}
            </div>
            <!-- Column titles on wide screens; on phones each meal stacks its parts -->
            <div
              class="hidden grid-cols-[3rem_minmax(8rem,13rem)_minmax(0,1fr)_minmax(6rem,9rem)_auto] gap-x-2 border-b border-neutral-200 px-2 py-0.5 text-xs text-neutral-700 md:grid"
              aria-hidden="true"
            >
              <span>ID</span><span>Mahlzeit</span><span>Gerichte</span><span>Wer isst mit</span
              ><span class="w-[5.5rem]"></span>
            </div>
            <ul class="divide-y divide-neutral-200">
              {#each tag.mahlzeiten as mahlzeit, index (mahlzeit.id)}
                <MahlzeitZeile
                  {kontext}
                  {mahlzeit}
                  {bearbeiten}
                  {esser}
                  erste={index === 0}
                  letzte={index === tag.mahlzeiten.length - 1}
                  oneinplanen={(neu) => (auftrag = neu)}
                  ongruppen={(id) => (gruppenMahlzeit = id)}
                  {unvertraeglichkeiten}
                />
              {:else}
                <li class="px-2 py-1.5 text-sm text-neutral-700">Noch keine Mahlzeiten.</li>
              {/each}
            </ul>
            {#if bearbeiten}
              <form
                class="flex items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-2 py-1 print:hidden"
                onsubmit={(event) => void mahlzeitHinzufuegen(event, tag)}
              >
                <label class="sr-only" for="neue-mahlzeit-{tag.id}"
                  >Neue Mahlzeit an Tag {tag.nummer}</label
                >
                <input
                  id="neue-mahlzeit-{tag.id}"
                  class="form-input mt-0 min-h-0 max-w-xs px-2 py-0.5 text-sm any-pointer-coarse:min-h-11"
                  maxlength="50"
                  placeholder="Neue Mahlzeit, z. B. Nachtwanderungs-Snack"
                  bind:value={neueMahlzeit[tag.id]}
                />
                <button
                  type="submit"
                  class={KNOPF}
                  disabled={kontext.busy || !(neueMahlzeit[tag.id] ?? '').trim()}
                  >Mahlzeit hinzufügen</button
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
          <ActionButton
            type="submit"
            disabled={kontext.busy || (!neuerTag && !ansicht.tage.length)}
          >
            {neuerTag ? 'Tag hinzufügen' : 'Tag danach hinzufügen'}
          </ActionButton>
        </form>
      {/if}
    </div>
    <!-- Only while the plan is shown: the list is for dragging into it -->
    {#if sichtbar}
      <aside class="lg:sticky lg:top-4" aria-label="Alle Gerichte">
        <GerichteLeiste {kontext} {bearbeiten} />
      </aside>
    {/if}
  </div>
</section>

<EinplanungDialog {kontext} {auftrag} onclose={() => (auftrag = null)} />
<MahlzeitGruppenDialog
  {kontext}
  mahlzeitId={gruppenMahlzeit}
  onclose={() => (gruppenMahlzeit = null)}
/>
