<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import { nachDemTippen } from '../../lib/nachDemTippen';
  import { confirmAction } from '../../lib/confirm';
  import {
    freiName,
    fuerText,
    packId,
    zustaendigWahl,
    type PackEntwurf,
    type PackZeile,
  } from '../../lib/essensplanungPackliste';
  import { merkeSpeichern, type PlanKontext } from './planKontext';

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
    /** Changes the draft, which the list keeps by row key. */
    aktionen: {
      /** The current draft, also for a save that ends after this row was hidden. */
      lesen: () => PackEntwurf | undefined;
      oeffnen: (text: string, etag: string | null, name: string) => void;
      tippen: (text: string) => void;
      verwerfen: () => void;
      sendet: (text: string) => void;
      gesichert: (gesendet: string) => void;
      gescheitert: (konflikt: boolean) => void;
    };
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

  /** Saves a change of this row: of its stored row, or the first one of a tool. */
  async function senden(
    felder: { gepackt?: boolean; zustaendigId?: number | null; zustaendigText?: string },
    erfolg: string
  ): Promise<boolean> {
    const { eintrag, werkzeug, name } = zeile;
    /** A message of the server about a field, e.g. a member who has no access any more. */
    let feldFehler: string | undefined;
    speichert = true;
    // Noted, so a PDF asked for meanwhile waits for it
    const lauf = kontext.aendern(async () => {
      try {
        return werkzeug === null
          ? await kontext.api.senden('PATCH', `/packliste/${eintrag!.id}`, {
              ...felder,
              etag: eintrag!.etag,
            })
          : await kontext.api.senden('PUT', '/packliste/werkzeug', {
              ...felder,
              werkzeug: name,
              etag: eintrag?.etag ?? null,
            });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) feldFehler = Object.values(error.fields)[0];
        throw error;
      }
    }, erfolg);
    merkeSpeichern(lauf);
    const ok = await lauf;
    speichert = false;
    if (!ok && feldFehler) kontext.hinweis(`${name}: ${feldFehler}`, 'error');
    return ok;
  }

  async function packen(feld: HTMLInputElement): Promise<void> {
    const gepackt = feld.checked;
    const ok = await senden(
      { gepackt },
      gepackt ? `${zeile.name} ist eingepackt.` : `${zeile.name} ist wieder offen.`
    );
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
    const ok = await senden(
      { zustaendigId: mitglied, zustaendigText: '' },
      name ? `${name} packt ${zeile.name} ein.` : `Für ${zeile.name} ist niemand mehr zuständig.`
    );
    if (!ok) feld.value = auswahl;
  }

  /**
   * Saves the typed name when it changed, on the version it was typed on; Escape leaves it as it
   * was. After a conflict only Enter (`bewusst`) saves it over the new state. Says whether the
   * name is saved: also when nothing changed or a save of it is running (that one is noted on its
   * own); not after an error or with a conflict left open.
   */
  async function textSpeichern(bewusst: boolean): Promise<boolean> {
    const entwurf = aktionen.lesen();
    if (!entwurf || entwurf.gesendet !== null) return true;
    if (entwurf.konflikt && !bewusst) return false;
    const text = freiName(entwurf.text);
    if (!entwurf.konflikt && zeile.zustaendigId === null && text === zeile.zustaendig) {
      aktionen.verwerfen();
      return true;
    }
    const { eintrag, werkzeug, name } = zeile;
    const etag = entwurf.etag;
    let konflikt = false;
    let feldFehler: string | undefined;
    aktionen.sendet(text);
    const ok = await kontext.aendern(
      async () => {
        const felder = { zustaendigId: null, zustaendigText: text };
        try {
          return werkzeug === null
            ? await kontext.api.senden('PATCH', `/packliste/${eintrag!.id}`, { ...felder, etag })
            : await kontext.api.senden('PUT', '/packliste/werkzeug', {
                ...felder,
                werkzeug: name,
                etag,
              });
        } catch (error: unknown) {
          if (error instanceof ApiError) {
            konflikt = error.status === 409;
            if (error.fields) feldFehler = Object.values(error.fields)[0];
          }
          throw error;
        }
      },
      text ? `${text} packt ${name} ein.` : `Für ${name} ist niemand mehr zuständig.`
    );
    if (!ok && feldFehler) kontext.hinweis(`${name}: ${feldFehler}`, 'error');
    // Not saved: the field keeps the name, so it can be sent once more
    if (ok) aktionen.gesichert(text);
    else aktionen.gescheitert(konflikt);
    return ok;
  }

  async function entfernen(): Promise<void> {
    const eintrag = zeile.eintrag!;
    if (
      !(await confirmAction({
        title: `${zeile.name} von der Packliste nehmen?`,
        message: 'Der Eintrag verschwindet für alle.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/packliste/${eintrag.id}`, undefined, eintrag.etag),
      `${zeile.name} steht nicht mehr auf der Packliste.`
    );
  }
</script>

<li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
  <div class="min-w-0 flex-1 basis-56">
    {#if bearbeiten}
      <!-- Box and name are one label: a target of at least 44 px for the finger -->
      <label
        for="{id}-gepackt"
        class="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-3 pr-1 align-middle"
      >
        <input
          type="checkbox"
          id="{id}-gepackt"
          class="size-5 shrink-0"
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
    {:else}
      <span class="font-semibold [overflow-wrap:anywhere]">{zeile.name}</span>
    {/if}
    <span class="text-sm {zeile.gepackt ? 'text-success' : 'text-neutral-700'}"
      >· {zeile.gepackt ? 'gepackt' : 'noch einpacken'}</span
    >
    {#if fuer}
      <p
        id="{id}-fuer"
        class="text-sm text-neutral-700 [overflow-wrap:anywhere] {bearbeiten ? 'pl-8' : ''}"
      >
        für {fuer}
      </p>
    {/if}
    {#if !bearbeiten && zeile.zustaendig}
      <p class="text-sm text-neutral-700">Zuständig: {zeile.zustaendig}</p>
    {/if}
  </div>
  {#if bearbeiten}
    <div class="flex flex-wrap items-center gap-1">
      {#if entwurf !== null}
        <input
          bind:this={textFeld}
          value={entwurf.text}
          oninput={(event) => aktionen.tippen(event.currentTarget.value)}
          class="form-input min-h-11 w-40 py-1 text-sm"
          aria-label="Wer packt {zeile.name} ein?"
          placeholder="Name, z. B. Rover"
          maxlength="100"
          aria-invalid={entwurf.konflikt ? 'true' : undefined}
          aria-describedby={entwurf.konflikt ? `${id}-konflikt` : undefined}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              merkeSpeichern(textSpeichern(true));
            } else if (event.key === 'Escape') aktionen.verwerfen();
          }}
          onblur={() => nachDemTippen(() => merkeSpeichern(textSpeichern(false)))}
        />
      {:else}
        <select
          class="form-input min-h-11 w-auto max-w-48 py-1 text-sm"
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
      {#if zeile.werkzeug === null}
        <ActionButton
          type="button"
          variant="danger"
          disabled={speichert || kontext.busy}
          aria-label="{zeile.name} entfernen"
          onclick={() => void entfernen()}>Entfernen</ActionButton
        >
      {/if}
    </div>
    {#if entwurf?.konflikt}
      <p id="{id}-konflikt" class="basis-full text-sm text-danger" role="alert">
        Jemand anderes hat gerade geändert, wer {zeile.name} einpackt (jetzt: {zeile.zustaendig ||
          'niemand'}). Enter speichert deinen Namen trotzdem, Escape verwirft ihn.
      </p>
    {/if}
  {/if}
</li>
