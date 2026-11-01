<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { nachDemTippen } from '../../lib/nachDemTippen';
  import { confirmAction } from '../../lib/confirm';
  import {
    fuerText,
    packId,
    zustaendigWahl,
    type PackEntwurf,
    type PackZeile,
  } from '../../lib/essensplanungPackliste';
  import type { EntwurfAktionen } from './packEntwuerfe.svelte';
  import { packAbhaken, packSenden, zustaendigErfolg } from './packSpeichern';
  import { gespeichert, merkeSpeichern, type PlanKontext } from './planKontext';

  /**
   * One thing on the packing list. The box packs it, the choice next to it says who packs it;
   * both save at once, on the version the row was shown with. A free name being typed lives in
   * the list (`entwurf`), so it survives a filter that hides the row or a switch to read-only.
   */

  interface Props {
    kontext: PlanKontext;
    zeile: PackZeile;
    bearbeiten: boolean;
    /** A free name being typed; the field shows instead of the choice. null: none. */
    entwurf: PackEntwurf | null;
    /** Changes and saves the draft, which the list keeps by row key. */
    aktionen: EntwurfAktionen;
  }
  let { kontext, zeile, bearbeiten, entwurf, aktionen }: Props = $props();

  let speichert = $state(false);
  let textFeld = $state<HTMLInputElement | null>(null);

  const id = $derived(packId(zeile.key));
  const fuer = $derived(fuerText(zeile));
  /** Members to choose; one without access only while responsible. */
  const mitglieder = $derived(zustaendigWahl(kontext.ansicht.mitglieder, zeile));
  const auswahl = $derived(
    zeile.zustaendigId !== null ? `m:${zeile.zustaendigId}` : zeile.zustaendig ? 'text' : ''
  );

  async function packen(feld: HTMLInputElement): Promise<void> {
    speichert = true;
    const ok = await packAbhaken(kontext, () => zeile, feld.checked, entwurf, aktionen);
    speichert = false;
    // Not saved: the box shows the saved state again
    if (!ok) feld.checked = zeile.gepackt;
  }

  async function waehlen(feld: HTMLSelectElement): Promise<void> {
    const wert = feld.value;
    if (wert === 'neu') {
      aktionen.oeffnen(
        zeile.zustaendigId === null ? zeile.zustaendig : '',
        zeile.eintrag?.etag ?? null,
        zeile.name
      );
      feld.value = auswahl;
      await tick();
      textFeld?.focus();
      return;
    }
    const mitglied = wert.startsWith('m:') ? Number(wert.slice(2)) : null;
    const name = mitglieder.find((m) => m.id === mitglied)?.name;
    speichert = true;
    const ok = await packSenden(
      kontext,
      zeile,
      { zustaendigId: mitglied, zustaendigText: '' },
      zustaendigErfolg(name ?? '', zeile.name)
    );
    speichert = false;
    if (!ok) feld.value = auswahl;
  }

  async function entfernen(): Promise<void> {
    // A name left with this click saves first, so the version below includes it
    if (!(await gespeichert())) {
      kontext.hinweis(
        `Eine Änderung an ${zeile.name} ist noch nicht gespeichert, der Eintrag wurde nicht entfernt. Speichere sie in der Zeile und versuche es noch einmal.`,
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
    {#if bearbeiten}
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
      <span class="font-semibold [overflow-wrap:anywhere]">{zeile.name}</span>
      <span class="text-xs {zeile.gepackt ? 'font-semibold text-success' : 'text-neutral-700'}"
        >· {zeile.gepackt ? 'gepackt' : 'noch einpacken'}</span
      >
    {/if}
    {#if fuer}
      <span
        id="{id}-fuer"
        class="block text-xs text-neutral-700 [overflow-wrap:anywhere] md:ml-2 md:inline {bearbeiten
          ? 'pl-7 md:pl-0'
          : ''}"
      >
        für {fuer}
      </span>
    {/if}
  </div>
  {#if !bearbeiten}
    <p class="basis-full text-sm [overflow-wrap:anywhere] md:basis-auto">
      {#if zeile.zustaendig}
        <span class="text-neutral-700 md:sr-only">Zuständig:</span>
        {zeile.zustaendig}
      {/if}
    </p>
  {:else}
    {#if entwurf !== null}
      <input
        bind:this={textFeld}
        value={entwurf.text}
        oninput={(event) => aktionen.tippen(event.currentTarget.value)}
        class="form-input mt-0 min-h-8 any-pointer-coarse:min-h-11 w-40 py-0.5 text-sm md:w-full"
        aria-label="Wer packt {zeile.name} ein?"
        placeholder="Name, z. B. Rover"
        maxlength="100"
        aria-invalid={entwurf.konflikt ? 'true' : undefined}
        aria-describedby={entwurf.konflikt ? `${id}-konflikt` : undefined}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            merkeSpeichern(aktionen.speichern(true));
          } else if (event.key === 'Escape') aktionen.verwerfen();
        }}
        onblur={() => nachDemTippen(() => merkeSpeichern(aktionen.speichern(false)))}
      />
    {:else}
      <select
        class="form-input mt-0 min-h-8 any-pointer-coarse:min-h-11 w-auto max-w-48 py-0.5 text-sm md:w-full md:max-w-none"
        aria-label="Wer packt {zeile.name} ein?"
        value={auswahl}
        disabled={speichert}
        onchange={(event) => void waehlen(event.currentTarget)}
      >
        <option value="">Niemand zuständig</option>
        {#each mitglieder as mitglied (mitglied.id)}
          <option value="m:{mitglied.id}">{mitglied.name}</option>
        {/each}
        {#if zeile.zustaendigId === null && zeile.zustaendig}
          <option value="text">{zeile.zustaendig}</option>
        {/if}
        <option value="neu">Anderer Name …</option>
      </select>
    {/if}
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
    {#if entwurf?.konflikt}
      <div class="flex basis-full flex-wrap items-center gap-2 md:col-span-3">
        <p id="{id}-konflikt" class="text-sm text-danger [overflow-wrap:anywhere]" role="alert">
          Jemand anderes hat gerade geändert, wer {zeile.name} einpackt (jetzt: {zeile.zustaendig ||
            'niemand'}). Enter speichert deinen Namen trotzdem, „Name verwerfen“ nimmt den
          gespeicherten.
        </p>
        <!-- Keeps the focus in the field, so leaving it does not try to save first -->
        <ActionButton
          type="button"
          class="min-h-8 any-pointer-coarse:min-h-11 min-w-8 any-pointer-coarse:min-w-11 px-2 py-0.5 text-xs"
          aria-label="Name für {zeile.name} verwerfen"
          disabled={entwurf.gesendet !== null}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => aktionen.verwerfen()}>Name verwerfen</ActionButton
        >
      </div>
    {/if}
  {/if}
</li>
