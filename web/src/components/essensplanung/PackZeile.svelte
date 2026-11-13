<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { fuerText, packId, personenText, type PackZeile } from '../../lib/essensplanungPackliste';
  import type { PackZuteilung } from '../../../../api/lib/essen-packliste-model';
  import { anteilAbhaken, packAbhaken } from './packSpeichern';
  import { gespeichert, type PlanKontext } from './planKontext';

  /**
   * One thing on the packing list. With at most one person the box packs it; with several, each
   * has their own box next to their name, and the thing is packed when all of them packed. The
   * button opens the choice of who packs it (`PackWerDialog.svelte`). Ticks save at once.
   */

  interface Props {
    kontext: PlanKontext;
    zeile: PackZeile;
    bearbeiten: boolean;
    /** Opens the choice of who packs this row. */
    onwer: (zeile: PackZeile) => void;
  }
  let { kontext, zeile, bearbeiten, onwer }: Props = $props();

  let speichert = $state(false);

  const id = $derived(packId(zeile.key));
  const fuer = $derived(fuerText(zeile));
  const mehrere = $derived(zeile.personen.length > 1);
  const wer = $derived(personenText(zeile));
  const gepacktAnzahl = $derived(zeile.personen.filter((p) => p.gepackt).length);

  async function packen(feld: HTMLInputElement): Promise<void> {
    speichert = true;
    const ok = await packAbhaken(kontext, zeile, feld.checked);
    speichert = false;
    // Not saved: the box shows the saved state again
    if (!ok) feld.checked = zeile.gepackt;
  }

  async function anteilPacken(person: PackZuteilung, feld: HTMLInputElement): Promise<void> {
    speichert = true;
    const ok = await anteilAbhaken(kontext, zeile, person, feld.checked);
    speichert = false;
    if (!ok)
      feld.checked = zeile.personen.find((p) => p.id === person.id)?.gepackt ?? person.gepackt;
  }

  async function entfernen(): Promise<void> {
    // A change saving right now goes first, so the version below includes it
    if (!(await gespeichert())) {
      kontext.hinweis(
        `Eine Änderung an ${zeile.name} ist noch nicht gespeichert, der Eintrag wurde nicht entfernt. Versuche es noch einmal.`,
        'error'
      );
      return;
    }
    // The entry as asked about: a change of others during the question is a conflict
    const eintrag = zeile.eintrag;
    const name = zeile.name;
    if (!eintrag) return;
    // An entry that planned dishes need as a tool too: only its own state goes, the tool stays
    const bleibt = zeile.gerichte.length > 0;
    if (
      !(await confirmAction({
        title: bleibt
          ? `Eigene Angaben zu ${name} entfernen?`
          : `${name} von der Packliste nehmen?`,
        message: bleibt
          ? `Deine Angaben zu ${name} (zuständig, gepackt) werden entfernt. ${name} bleibt auf der Packliste, weil Gerichte es brauchen.`
          : 'Der Eintrag verschwindet für alle.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/packliste/${eintrag.id}`, undefined, eintrag.etag),
      bleibt
        ? `Eigene Angaben zu ${name} entfernt; es bleibt für die Gerichte auf der Packliste.`
        : `${name} steht nicht mehr auf der Packliste.`
    );
  }
</script>

<!-- Columns as in the head of the list (`PlanPackliste.svelte`): what · who packs it · removing -->
<li
  class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-0.5 md:grid md:grid-cols-[minmax(0,1fr)_14rem_8rem] {zeile.gepackt
    ? 'bg-success-soft'
    : ''}"
>
  <div class="min-w-0 flex-1 basis-56">
    {#if bearbeiten && !mehrere}
      <!-- Box and name are one label: a target of at least 44 px for the finger on the phone -->
      <label
        for="{id}-gepackt"
        class="inline-flex min-h-8 any-pointer-coarse:min-h-11 min-w-8 any-pointer-coarse:min-w-11 cursor-pointer items-center gap-2 pr-1 align-middle"
      >
        <input
          type="checkbox"
          id="{id}-gepackt"
          class="size-4 shrink-0 any-pointer-coarse:size-5"
          checked={zeile.gepackt}
          disabled={speichert}
          aria-describedby={fuer ? `${id}-fuer` : undefined}
          onchange={(event) => void packen(event.currentTarget)}
        />
        <span
          class="font-semibold [overflow-wrap:anywhere] {zeile.gepackt
            ? 'text-neutral-700 line-through'
            : ''}">{zeile.name}</span
        >
      </label>
      {#if zeile.gepackt}<span class="text-xs font-semibold text-success">gepackt</span>{/if}
    {:else}
      <span
        class="inline-flex min-h-8 items-center font-semibold [overflow-wrap:anywhere] {bearbeiten &&
        zeile.gepackt
          ? 'text-neutral-700 line-through'
          : ''}">{zeile.name}</span
      >
      <span class="text-xs {zeile.gepackt ? 'font-semibold text-success' : 'text-neutral-700'}"
        >· {zeile.gepackt
          ? 'gepackt'
          : mehrere
            ? `${gepacktAnzahl} von ${zeile.personen.length} gepackt`
            : 'noch einpacken'}</span
      >
    {/if}
    {#if fuer}
      <span
        id="{id}-fuer"
        class="block text-xs text-neutral-700 [overflow-wrap:anywhere] md:ml-2 md:inline {bearbeiten &&
        !mehrere
          ? 'pl-7 md:pl-0'
          : ''}"
      >
        für {fuer}
      </span>
    {/if}
    {#if mehrere}
      <ul class="flex flex-wrap gap-x-3" aria-label="Wer hat {zeile.name} gepackt?">
        {#each zeile.personen as person (person.id)}
          <li>
            {#if bearbeiten}
              <label
                class="inline-flex min-h-8 any-pointer-coarse:min-h-11 cursor-pointer items-center gap-1.5 pr-1 text-sm [overflow-wrap:anywhere]"
              >
                <input
                  type="checkbox"
                  class="size-4 shrink-0 any-pointer-coarse:size-5"
                  checked={person.gepackt}
                  disabled={speichert}
                  aria-label="{person.name} hat {zeile.name} gepackt"
                  onchange={(event) => void anteilPacken(person, event.currentTarget)}
                />
                <span class={person.gepackt ? 'text-neutral-700 line-through' : ''}
                  >{person.name}</span
                >
              </label>
            {:else}
              <span class="text-sm [overflow-wrap:anywhere]"
                >{person.name}:
                <span class={person.gepackt ? 'font-semibold text-success' : 'text-neutral-700'}
                  >{person.gepackt ? 'gepackt' : 'offen'}</span
                ></span
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if !bearbeiten}
    <p class="basis-full text-sm [overflow-wrap:anywhere] md:basis-auto">
      {#if zeile.personen.length === 1}
        <span class="text-neutral-700 md:sr-only">Zuständig:</span>
        {wer}
      {/if}
    </p>
  {:else}
    <ActionButton
      type="button"
      class="min-h-8 max-w-full justify-start truncate px-2 py-0.5 text-left text-sm any-pointer-coarse:min-h-11 md:w-full"
      aria-label="Wer packt {zeile.name} ein? {wer || 'Niemand zuständig'}"
      disabled={speichert}
      onclick={() => onwer(zeile)}>{wer || 'Niemand zuständig'}</ActionButton
    >
    <div class="md:text-right">
      {#if zeile.werkzeug === null}
        <ActionButton
          type="button"
          variant="danger"
          class="min-h-8 px-2 py-0.5 text-xs any-pointer-coarse:min-h-11"
          disabled={speichert || kontext.busy}
          aria-label="{zeile.name} entfernen"
          onclick={() => void entfernen()}>Entfernen</ActionButton
        >
      {/if}
    </div>
  {/if}
</li>
