<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { datumKurz } from '../../lib/essensplanung';
  import type { PlanungTag } from '../../lib/types';
  import MahlzeitZeile from './MahlzeitZeile.svelte';
  import type { PlanKontext } from './planKontext';

  /** Days and meals of a Planung; shown IDs like `3_1` follow the order. */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

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
    if (
      !(await confirmAction({
        title: `Tag ${tag.nummer} löschen?`,
        message: `${datumKurz(tag.datum)} mit allen ${tag.mahlzeiten.length} Mahlzeiten wird gelöscht. Die Nummern der folgenden Tage rücken nach.`,
        confirmLabel: 'Tag löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/tage/${tag.id}`, undefined, tag.etag),
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
  <h3 id="plan-heading" class="sr-only">Tage und Mahlzeiten</h3>
  {#if ansicht.tage.length === 0}
    <p class="text-neutral-700">Die Planung hat noch keine Tage.</p>
  {/if}
  <ol class="space-y-6">
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

  {#if bearbeiten}
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
