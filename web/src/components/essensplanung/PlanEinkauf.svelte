<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { errorMessage } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { einkaufsliste, postenMenge } from '../../lib/essensplanungEinkauf';
  import { kochMenge } from '../../lib/essensplanungRechnung';
  import type { PostenArt } from '../../../../api/lib/essen-einkauf-model';
  import type { EssenKatalog, Geschaeft, ZusatzPosten } from '../../lib/types';
  import GeschaeftDialog from './GeschaeftDialog.svelte';
  import NeuerZusatz from './NeuerZusatz.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import PlanEinkaeufe from './PlanEinkaeufe.svelte';
  import PlanLager from './PlanLager.svelte';
  import PostenDialog from './PostenDialog.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The shopping list of a Planung by shop and category, with the extra needs, the stock and the
   * shops it comes from. Printed alone, the list is what goes to the shop.
   */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The central lists, for the names of the categories and the choice of ingredients. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  /** The `katalogStand` the lists were loaded for. */
  let geladen: string | null = null;
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    geladen = ansicht.katalogStand;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      // Not loaded: the next view or the button tries again
      geladen = null;
      katalogFehler = errorMessage(error, 'Die Liste der Zutaten konnte nicht geladen werden.');
    }
  }
  $effect(() => {
    if (sichtbar && ansicht.katalogStand !== geladen) untrack(() => void katalogLaden());
  });

  const kategorien = $derived(new Map((katalog?.kategorien ?? []).map((k) => [k.id, k.name])));
  const liste = $derived(einkaufsliste(ansicht, kategorien));
  const zutaten = $derived(new Map(ansicht.zutaten.map((z) => [z.id, z])));

  /** What is typed under „Noch etwas besorgen“, kept while the page is read-only for a while. */
  let neuerZusatz = $state('');
  $effect(() => guardUnsavedChanges(() => neuerZusatz.trim() !== ''));

  let geschaeftDialog = $state<number | null | undefined>(undefined);
  let postenDialog = $state<{ art: PostenArt; id: number | null } | null>(null);

  /** „2 kg Salz“; extra needs without an amount by name only, „Kochhandschuhe“. */
  function postenText(posten: ZusatzPosten): string {
    const zutat = zutaten.get(posten.planungZutatId);
    const name = zutat?.name ?? 'Zutat';
    return posten.menge === null || posten.einheit === null
      ? name
      : `${kochMenge(posten.menge, posten.einheit, zutat?.abtropfgewicht)} ${name}`;
  }

  async function geschaeftSetzen(feld: HTMLSelectElement, planungZutatId: number, name: string) {
    const geschaeftId = feld.value ? Number(feld.value) : null;
    const geschaeft = ansicht.geschaefte.find((g) => g.id === geschaeftId);
    // On the version the choice was made on: the choice of someone else meanwhile is a conflict
    const etag = zutaten.get(planungZutatId)?.etag;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/zutaten/${planungZutatId}/geschaeft`, { geschaeftId, etag }),
      geschaeft ? `${name} kaufst du bei ${geschaeft.name}.` : `${name} hat kein Geschäft mehr.`
    );
    // Not saved: the field shows the saved shop again, so the choice can be sent once more
    if (!ok) {
      const gespeichert = zutaten.get(planungZutatId)?.geschaeftId;
      feld.value = ansicht.geschaefte.some((g) => g.id === gespeichert) ? String(gespeichert) : '';
    }
  }

  async function geschaeftLoeschen(geschaeft: Geschaeft): Promise<void> {
    const { id, etag, name } = geschaeft;
    if (
      !(await confirmAction({
        title: `${name} löschen?`,
        message: 'Die Zutaten dieses Geschäfts stehen danach unter „Ohne Geschäft“.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/geschaefte/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
  }

  async function postenLoeschen(art: PostenArt, posten: ZusatzPosten): Promise<void> {
    const text = postenText(posten);
    if (
      !(await confirmAction({
        title: `${text} entfernen?`,
        message:
          art === 'bestand'
            ? 'Der Bestand wird nicht mehr von der Einkaufsliste abgezogen.'
            : 'Die Einkaufsliste enthält es dann nicht mehr.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () =>
        kontext.api.senden(
          'DELETE',
          `/${art === 'bestand' ? 'bestand' : 'zusatzbedarf'}/${posten.id}`,
          undefined,
          posten.etag
        ),
      `${text} entfernt.`
    );
  }
</script>

{#snippet postenListe(art: PostenArt, titel: string, eintraege: ZusatzPosten[], leer: string)}
  <section aria-labelledby="{art}-heading" class="space-y-3 print:hidden">
    <h3 id="{art}-heading" class="font-serif text-lg font-bold text-brand-900">{titel}</h3>
    {#if eintraege.length}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label={titel}>
        {#each eintraege as posten (posten.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 py-2">
            <p class="min-w-0 [overflow-wrap:anywhere]">
              <span class="font-semibold">{postenText(posten)}</span>
              {#if posten.hinweis}<span class="text-neutral-700">· {posten.hinweis}</span>{/if}
            </p>
            {#if bearbeiten}
              <span class="flex gap-1">
                <ActionButton
                  type="button"
                  aria-label="{postenText(posten)} ändern"
                  onclick={() => (postenDialog = { art, id: posten.id })}>Ändern</ActionButton
                >
                <ActionButton
                  type="button"
                  variant="danger"
                  disabled={kontext.busy}
                  aria-label="{postenText(posten)} entfernen"
                  onclick={() => void postenLoeschen(art, posten)}>Entfernen</ActionButton
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-neutral-700">{leer}</p>
    {/if}
    {#if bearbeiten}
      <ActionButton type="button" onclick={() => (postenDialog = { art, id: null })}
        >{titel} eintragen</ActionButton
      >
    {/if}
  </section>
{/snippet}

<div class="space-y-8">
  <section aria-labelledby="einkaufsliste-heading" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="einkaufsliste-heading" class="font-serif text-lg font-bold text-brand-900">
        Einkaufsliste
      </h3>
      <!-- Only with the list, so each thing stands under its category -->
      <PdfKnopf
        {kontext}
        label="Einkaufsliste als PDF"
        disabled={!katalog}
        erstellen={async () => {
          const { downloadEinkaufslistePdf } = await import('../../lib/essensplanungPdf');
          await downloadEinkaufslistePdf(ansicht, liste);
        }}
      />
    </div>
    {#if katalogFehler}
      <p class="text-sm text-danger print:hidden" role="alert">
        {katalogFehler}
        <button
          type="button"
          class="min-h-11 font-semibold underline"
          onclick={() => void katalogLaden()}>Noch einmal versuchen</button
        >
      </p>
    {/if}
    {#each liste as gruppe (gruppe.geschaeft?.id ?? 0)}
      {@const name = gruppe.geschaeft?.name ?? 'Ohne Geschäft'}
      <div class="space-y-2 break-inside-avoid-page">
        <h4 class="text-base font-bold text-brand-900">{name}</h4>
        {#each gruppe.kategorien as kategorie (kategorie.name)}
          <div>
            <h5 class="text-sm font-semibold text-neutral-700">{kategorie.name}</h5>
            <ul
              class="divide-y divide-neutral-200 border-y border-neutral-200"
              aria-label="{name}: {kategorie.name}"
            >
              {#each kategorie.posten as posten (`${posten.planungZutatId}:${posten.einheit}`)}
                <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                  <p class="min-w-0 [overflow-wrap:anywhere]">
                    <span class="font-semibold tabular-nums">{postenMenge(posten)}</span>
                    {posten.name}
                  </p>
                  {#if bearbeiten && ansicht.geschaefte.length}
                    <select
                      class="form-input min-h-11 w-auto py-1 text-sm print:hidden"
                      aria-label="Geschäft für {posten.name}"
                      disabled={kontext.busy}
                      value={String(gruppe.geschaeft?.id ?? '')}
                      onchange={(event) =>
                        void geschaeftSetzen(
                          event.currentTarget,
                          posten.planungZutatId,
                          posten.name
                        )}
                    >
                      <option value="">Ohne Geschäft</option>
                      {#each ansicht.geschaefte as geschaeft (geschaeft.id)}
                        <option value={String(geschaeft.id)}>{geschaeft.name}</option>
                      {/each}
                    </select>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-neutral-700">Noch nichts zu kaufen.</p>
    {/each}
    {#if bearbeiten}
      <NeuerZusatz {kontext} {katalog} bind:text={neuerZusatz} />
    {/if}
  </section>

  <PlanEinkaeufe {kontext} {kategorien} katalogGeladen={!!katalog} />

  {@render postenListe(
    'zusatzbedarf',
    'Zusatzbedarf',
    ansicht.zusatzbedarf,
    'Noch kein Zusatzbedarf.'
  )}
  {@render postenListe('bestand', 'Bestand', ansicht.bestand, 'Noch kein Bestand.')}
  <PlanLager {kontext} />

  <section aria-labelledby="geschaefte-heading" class="space-y-3 print:hidden">
    <h3 id="geschaefte-heading" class="font-serif text-lg font-bold text-brand-900">Geschäfte</h3>
    {#if ansicht.geschaefte.length}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Geschäfte">
        {#each ansicht.geschaefte as geschaeft (geschaeft.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 py-2">
            <span class="min-w-0 font-semibold [overflow-wrap:anywhere]">{geschaeft.name}</span>
            {#if bearbeiten}
              <span class="flex gap-1">
                <ActionButton
                  type="button"
                  aria-label="Geschäft {geschaeft.name} ändern"
                  onclick={() => (geschaeftDialog = geschaeft.id)}>Ändern</ActionButton
                >
                <ActionButton
                  type="button"
                  variant="danger"
                  disabled={kontext.busy}
                  aria-label="Geschäft {geschaeft.name} löschen"
                  onclick={() => void geschaeftLoeschen(geschaeft)}>Löschen</ActionButton
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-neutral-700">Noch keine Geschäfte.</p>
    {/if}
    {#if bearbeiten}
      <ActionButton type="button" onclick={() => (geschaeftDialog = null)}
        >Geschäft hinzufügen</ActionButton
      >
    {/if}
  </section>
</div>

<GeschaeftDialog
  {kontext}
  geschaeftId={geschaeftDialog}
  onclose={() => (geschaeftDialog = undefined)}
/>
<PostenDialog
  {kontext}
  {katalog}
  {katalogFehler}
  onkatalog={() => void katalogLaden()}
  art={postenDialog?.art ?? 'bestand'}
  postenId={postenDialog?.id}
  onclose={() => (postenDialog = null)}
/>
