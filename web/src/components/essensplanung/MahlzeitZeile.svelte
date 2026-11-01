<script lang="ts">
  import { untrack } from 'svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { mahlzeitStand } from '../../../../api/lib/essen-planung-model';
  import type { PlanungMahlzeit } from '../../lib/types';
  import type { esserRechner } from '../../lib/essensplanungRechnung';
  import type { PlanKontext } from './planKontext';
  import EinplanungKarte from './EinplanungKarte.svelte';
  import SlotEingabe from './SlotEingabe.svelte';
  import { SYMBOL } from './planAktionen';
  import { ablegen, ueber, verlassen, ziehen } from './planZiehen.svelte';

  /**
   * One meal of a day in the list, as a row: ID, name (saved when the field is left or Enter is
   * pressed; changes of others do not overwrite typing), the planned dishes with a field to type
   * the next, who eats, and sorting and deleting as small symbols.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    bearbeiten: boolean;
    erste: boolean;
    letzte: boolean;
    esser: ReturnType<typeof esserRechner>;
    /** Opens the dialog of planned dishes. */
    oneinplanen: (auftrag: Auftrag) => void;
    /** Opens the dialog of the groups that eat at the meal. */
    ongruppen: (mahlzeitId: number) => void;
    /** Names of the intolerances, for the amounts; empty while not loaded. */
    unvertraeglichkeiten: Map<number, string>;
  }
  let {
    kontext,
    mahlzeit,
    bearbeiten,
    erste,
    letzte,
    esser,
    oneinplanen,
    ongruppen,
    unvertraeglichkeiten,
  }: Props = $props();
  const ohne = $derived(
    mahlzeit.ohneGruppen
      .map((id) => kontext.ansicht.gruppen.find((g) => g.id === id)?.name ?? '')
      .filter(Boolean)
  );
  const markiert = $derived(ziehen.ziel?.mahlzeitId === mahlzeit.id);

  let name = $state('');
  let fokus = $state(false);
  /** The saved name the input started from, with its version. */
  let basis = $state({ name: '', etag: '' });
  /** Typed but not saved yet; changes of others then leave the field alone. */
  let entwurf = $state(false);

  function uebernehme(current: PlanungMahlzeit): void {
    basis = { name: current.name, etag: current.etag };
    name = basis.name;
  }

  /** Typed, kept after a failed save or a conflict, or still saving. */
  function ungespeichert(): boolean {
    return entwurf || (name.trim() || basis.name) !== basis.name;
  }
  // Asks before leaving the page
  $effect(() => guardUnsavedChanges(ungespeichert));

  /** Set when this page deletes the meal itself, which needs no word about lost input. */
  let selbstGeloescht = false;
  // Someone else deleted the meal or its day: the row goes, so the input is shown to copy
  $effect(() => () => {
    if (selbstGeloescht || !ungespeichert()) return;
    const text = `${mahlzeit.kennung} wurde gerade gelöscht. Deine Eingabe „${name.trim()}“ war noch nicht gespeichert.`;
    // After the update that removes the row, which would not show a change made during it
    setTimeout(() => kontext.hinweis(text, 'error'));
  });

  // Follow the saved state unless the user is typing or has unsaved input
  $effect(() => {
    const current = mahlzeit;
    untrack(() => {
      if (!fokus && !entwurf) uebernehme(current);
    });
  });

  async function speichern(position?: number): Promise<void> {
    const neuerName = name.trim() || basis.name;
    const nameNeu = neuerName !== basis.name;
    if (position === undefined && !nameNeu) {
      entwurf = false;
      uebernehme(mahlzeit);
      return;
    }
    // Someone else saved the name meanwhile: keep the input and let the person decide
    if (nameNeu && mahlzeit.name !== basis.name) {
      basis = { name: mahlzeit.name, etag: mahlzeit.etag };
      entwurf = true;
      kontext.hinweis(
        `Jemand anderes hat ${mahlzeit.kennung} gerade geändert (jetzt „${mahlzeit.name}“). Deine Eingabe steht noch im Feld; verlasse es noch einmal, um sie zu speichern.`,
        'error'
      );
      return;
    }
    entwurf = true;
    const ok = await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/mahlzeiten/${mahlzeit.id}`, {
        etag: mahlzeit.etag,
        name: nameNeu ? neuerName : mahlzeit.name,
        ...(position !== undefined ? { position } : {}),
      })
    );
    if (ok) {
      entwurf = false;
      // The saved state is the new start even while the field has focus again; what was typed
      // since stays in the field and counts as a change of its own
      if (fokus) basis = { name: mahlzeit.name, etag: mahlzeit.etag };
      else uebernehme(mahlzeit);
    } else {
      basis = { name: mahlzeit.name, etag: mahlzeit.etag };
    }
  }

  async function loeschen(): Promise<void> {
    // The meal as asked about, with its dishes: a change of others meanwhile is a conflict
    const { id, name: alterName, kennung } = mahlzeit;
    const stand = mahlzeitStand(mahlzeit);
    const anzahl = mahlzeit.einplanungen.length;
    if (
      !(await confirmAction({
        title: `${kennung} ${alterName} löschen?`,
        message: `Die Mahlzeit wird ${anzahl === 1 ? 'mit ihrem eingeplanten Gericht ' : anzahl ? `mit ihren ${anzahl} eingeplanten Gerichten ` : ''}gelöscht; die Nummern der folgenden Mahlzeiten rücken nach. Die Gerichte selbst bleiben.`,
        confirmLabel: 'Mahlzeit löschen',
      }))
    )
      return;
    selbstGeloescht = true;
    const ok = await kontext.aendern(
      () => kontext.api.senden('DELETE', `/mahlzeiten/${id}`, undefined, stand),
      `${alterName} gelöscht.`
    );
    if (!ok) selbstGeloescht = false;
  }
</script>

<li
  class="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-2 py-1.5 md:grid-cols-[3rem_minmax(8rem,13rem)_minmax(0,1fr)_minmax(6rem,9rem)_auto] md:items-start {markiert
    ? 'bg-brand-100'
    : ''}"
  data-mahlzeit={mahlzeit.kennung}
>
  <span
    class="pt-1 font-mono text-xs font-semibold text-brand-900"
    title="Mahlzeit-ID: Tag_Mahlzeit">{mahlzeit.kennung}</span
  >
  {#if bearbeiten}
    <span class="hidden print:inline">{name}</span>
    <label class="sr-only" for="mahlzeit-name-{mahlzeit.id}">Name von {mahlzeit.kennung}</label>
    <input
      id="mahlzeit-name-{mahlzeit.id}"
      class="form-input mt-0 min-h-0 border-b border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-brand-900 hover:border-neutral-300 focus:bg-[var(--color-field)] any-pointer-coarse:min-h-11 print:hidden"
      maxlength="50"
      bind:value={name}
      onfocus={() => (fokus = true)}
      onblur={() => {
        fokus = false;
        void speichern();
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  {:else}
    <span class="pt-0.5 font-semibold text-brand-900 [overflow-wrap:anywhere]">{mahlzeit.name}</span
    >
  {/if}
  <!-- Sorting and deleting: small symbols at the end of the row -->
  <span class="flex justify-end gap-0.5 md:order-last print:hidden">
    {#if bearbeiten}
      <button
        type="button"
        class={SYMBOL}
        disabled={erste || kontext.busy}
        title="Nach oben"
        aria-label="{mahlzeit.name} nach oben"
        onclick={() => void speichern(mahlzeit.position - 1)}>↑</button
      >
      <button
        type="button"
        class={SYMBOL}
        disabled={letzte || kontext.busy}
        title="Nach unten"
        aria-label="{mahlzeit.name} nach unten"
        onclick={() => void speichern(mahlzeit.position + 1)}>↓</button
      >
      <button
        type="button"
        class="{SYMBOL} hover:text-danger"
        disabled={kontext.busy}
        title="Mahlzeit löschen"
        aria-label="{mahlzeit.name} löschen"
        onclick={() => void loeschen()}
        ><svg
          viewBox="0 0 24 24"
          class="size-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg
        ></button
      >
    {/if}
  </span>
  <!-- The dishes; the whole cell takes a dragged dish -->
  <!-- svelte-ignore a11y_no_static_element_interactions (dropping; the keyboard types dishes in) -->
  <div
    class="col-span-3 min-w-0 space-y-1 md:col-span-1"
    ondragover={bearbeiten ? (event) => ueber(event, mahlzeit) : undefined}
    ondragleave={(event) => verlassen(event, mahlzeit)}
    ondrop={bearbeiten ? (event) => void ablegen(event, kontext, mahlzeit) : undefined}
  >
    <ol class="space-y-1" aria-label="Gerichte bei {mahlzeit.kennung}">
      {#each mahlzeit.einplanungen as einplanung, index (einplanung.id)}
        <li>
          {#if markiert && ziehen.ziel?.index === index}
            <div class="mb-1 h-0.5 rounded bg-brand-800" aria-hidden="true"></div>
          {/if}
          <EinplanungKarte
            {kontext}
            {mahlzeit}
            {einplanung}
            {esser}
            {bearbeiten}
            variante="liste"
            {unvertraeglichkeiten}
            {oneinplanen}
          />
        </li>
      {/each}
    </ol>
    {#if markiert && ziehen.ziel?.index === mahlzeit.einplanungen.length}
      <div class="h-0.5 rounded bg-brand-800" aria-hidden="true"></div>
    {/if}
    {#if bearbeiten}
      <div class="max-w-md print:hidden"><SlotEingabe {kontext} {mahlzeit} /></div>
    {:else if !mahlzeit.einplanungen.length}
      <p class="px-1 text-xs text-neutral-700">Noch kein Gericht.</p>
    {/if}
  </div>
  <div class="col-span-3 flex items-baseline gap-1 text-xs md:col-span-1 md:pt-1">
    <span class="text-neutral-700 md:sr-only">Wer isst mit:</span>
    {#if bearbeiten && kontext.ansicht.gruppen.length}
      <button
        type="button"
        class="rounded-sm px-1 text-left text-neutral-900 hover:bg-neutral-100 hover:underline any-pointer-coarse:min-h-11 print:hidden"
        title="Wer isst mit ändern"
        aria-label="Wer isst mit bei {mahlzeit.kennung} ändern: {ohne.length
          ? `alle außer ${ohne.join(', ')}`
          : 'alle'}"
        onclick={() => ongruppen(mahlzeit.id)}
        >{ohne.length ? `alle außer ${ohne.join(', ')}` : 'alle'}
        <span aria-hidden="true">✎</span></button
      >
    {:else}
      <span class="text-neutral-900">{ohne.length ? `alle außer ${ohne.join(', ')}` : 'alle'}</span>
    {/if}
  </div>
</li>
