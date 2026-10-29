<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { einplanungBody, faktorText } from '../../lib/essensplanungEinplanung';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { mahlzeitStand } from '../../../../api/lib/essen-planung-model';
  import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';
  import EinplanungMengen from './EinplanungMengen.svelte';
  import { esserRechner } from '../../lib/essensplanungRechnung';

  /**
   * One meal: name and time are saved when the field is left or Enter is pressed. While a field
   * has focus, changes of others do not overwrite the input.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    bearbeiten: boolean;
    erste: boolean;
    letzte: boolean;
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
    oneinplanen,
    ongruppen,
    unvertraeglichkeiten,
  }: Props = $props();
  const ohne = $derived(
    mahlzeit.ohneGruppen
      .map((id) => kontext.ansicht.gruppen.find((g) => g.id === id)?.name ?? '')
      .filter(Boolean)
  );
  const gerichte = $derived(new Map(kontext.ansicht.gerichte.map((g) => [g.id, g.name])));
  const esser = $derived(esserRechner(kontext.ansicht));

  let name = $state('');
  let uhrzeit = $state('');
  let fokus = $state(false);
  /** The saved values the input started from, with their version. */
  let basis = $state({ name: '', uhrzeit: '', etag: '' });
  /** Typed but not saved yet; changes of others then leave the fields alone. */
  let entwurf = $state(false);

  function uebernehme(current: PlanungMahlzeit): void {
    basis = { name: current.name, uhrzeit: current.uhrzeit ?? '', etag: current.etag };
    name = basis.name;
    uhrzeit = basis.uhrzeit;
  }

  /** Typed, kept after a failed save or a conflict, or still saving. */
  function ungespeichert(): boolean {
    return (
      entwurf || (name.trim() || basis.name) !== basis.name || uhrzeit.trim() !== basis.uhrzeit
    );
  }
  // Asks before leaving the page
  $effect(() => guardUnsavedChanges(ungespeichert));

  /** Set when this page deletes the meal itself, which needs no word about lost input. */
  let selbstGeloescht = false;
  // Someone else deleted the meal or its day: the row goes, so the input is shown to copy
  $effect(() => () => {
    if (selbstGeloescht || !ungespeichert()) return;
    const eingabe = [name.trim(), uhrzeit.trim() && `${uhrzeit.trim()} Uhr`]
      .filter(Boolean)
      .join(', ');
    const text = `${mahlzeit.kennung} wurde gerade gelöscht. Deine Eingabe „${eingabe}“ war noch nicht gespeichert.`;
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
    const neueUhrzeit = uhrzeit.trim();
    const nameNeu = neuerName !== basis.name;
    const uhrzeitNeu = neueUhrzeit !== basis.uhrzeit;
    if (position === undefined && !nameNeu && !uhrzeitNeu) {
      entwurf = false;
      uebernehme(mahlzeit);
      return;
    }
    // Someone else saved the same field meanwhile: keep the input and let the person decide
    if (
      (nameNeu && mahlzeit.name !== basis.name) ||
      (uhrzeitNeu && (mahlzeit.uhrzeit ?? '') !== basis.uhrzeit)
    ) {
      basis = {
        name: mahlzeit.name,
        uhrzeit: mahlzeit.uhrzeit ?? '',
        etag: mahlzeit.etag,
      };
      entwurf = true;
      kontext.hinweis(
        `Jemand anderes hat ${mahlzeit.kennung} gerade geändert (jetzt „${mahlzeit.name}“${mahlzeit.uhrzeit ? `, ${mahlzeit.uhrzeit} Uhr` : ''}). Deine Eingabe steht noch im Feld; verlasse es noch einmal, um sie zu speichern.`,
        'error'
      );
      return;
    }
    entwurf = true;
    const ok = await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/mahlzeiten/${mahlzeit.id}`, {
        // Fields left alone take what others saved meanwhile
        etag: mahlzeit.etag,
        name: nameNeu ? neuerName : mahlzeit.name,
        uhrzeit: (uhrzeitNeu ? neueUhrzeit : (mahlzeit.uhrzeit ?? '')) || null,
        ...(position !== undefined ? { position } : {}),
      })
    );
    if (ok) {
      entwurf = false;
      // The saved state is the new start even while a field has focus again; what was typed
      // since stays in the field and counts as a change of its own
      if (fokus)
        basis = { name: mahlzeit.name, uhrzeit: mahlzeit.uhrzeit ?? '', etag: mahlzeit.etag };
      else uebernehme(mahlzeit);
    } else {
      basis = { name: mahlzeit.name, uhrzeit: mahlzeit.uhrzeit ?? '', etag: mahlzeit.etag };
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

  async function verschiebe(einplanung: Einplanung, position: number): Promise<void> {
    await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/einplanungen/${einplanung.id}`, {
        ...einplanungBody(einplanung, mahlzeit.id),
        position,
      })
    );
  }

  async function entfernen(einplanung: Einplanung, name: string): Promise<void> {
    const { id, etag } = einplanung;
    if (
      !(await confirmAction({
        title: `${name} aus ${mahlzeit.kennung} nehmen?`,
        message: 'Das Gericht bleibt in der Planung und lässt sich wieder einplanen.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/einplanungen/${id}`, undefined, etag),
      `${name} aus ${mahlzeit.name} genommen.`
    );
  }

  function enter(event: KeyboardEvent): void {
    if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
  }
</script>

<li class="flex flex-wrap items-center gap-2 py-2">
  <span
    class="w-12 shrink-0 font-mono text-sm font-semibold text-brand-900"
    title="Mahlzeit-ID: Tag_Mahlzeit">{mahlzeit.kennung}</span
  >
  {#if bearbeiten}
    <span class="hidden min-w-0 flex-1 print:inline">{name}</span>
    {#if uhrzeit}<span class="hidden text-sm print:inline">{uhrzeit} Uhr</span>{/if}
    <label class="sr-only" for="mahlzeit-name-{mahlzeit.id}">Name von {mahlzeit.kennung}</label>
    <input
      id="mahlzeit-name-{mahlzeit.id}"
      class="form-input min-w-0 flex-1 print:hidden"
      maxlength="50"
      bind:value={name}
      onfocus={() => (fokus = true)}
      onblur={() => {
        fokus = false;
        void speichern();
      }}
      onkeydown={enter}
    />
    <label class="sr-only" for="mahlzeit-zeit-{mahlzeit.id}">Uhrzeit von {mahlzeit.kennung}</label>
    <input
      id="mahlzeit-zeit-{mahlzeit.id}"
      type="time"
      class="form-input w-28 print:hidden"
      bind:value={uhrzeit}
      onfocus={() => (fokus = true)}
      onblur={() => {
        fokus = false;
        void speichern();
      }}
      onkeydown={enter}
    />
    <span class="flex gap-1 print:hidden">
      <ActionButton
        type="button"
        disabled={erste || kontext.busy}
        aria-label="{mahlzeit.name} nach oben"
        onclick={() => void speichern(mahlzeit.position - 1)}>↑</ActionButton
      >
      <ActionButton
        type="button"
        disabled={letzte || kontext.busy}
        aria-label="{mahlzeit.name} nach unten"
        onclick={() => void speichern(mahlzeit.position + 1)}>↓</ActionButton
      >
      <ActionButton
        type="button"
        variant="danger"
        disabled={kontext.busy}
        aria-label="{mahlzeit.name} löschen"
        onclick={() => void loeschen()}>✕</ActionButton
      >
    </span>
  {:else}
    <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{mahlzeit.name}</span>
    {#if mahlzeit.uhrzeit}<span class="text-sm text-neutral-700">{mahlzeit.uhrzeit} Uhr</span>{/if}
  {/if}
  {#if kontext.ansicht.gruppen.length}
    <div class="flex basis-full flex-wrap items-center gap-x-3 pl-14 text-sm">
      <span class="text-neutral-700"
        >Wer isst mit: <span class="text-neutral-900"
          >{ohne.length ? `alle außer ${ohne.join(', ')}` : 'alle'}</span
        ></span
      >
      {#if bearbeiten}
        <button
          type="button"
          class="min-h-11 font-semibold text-link underline print:hidden"
          aria-label="Wer isst mit bei {mahlzeit.kennung} ändern"
          onclick={() => ongruppen(mahlzeit.id)}>Ändern</button
        >
      {/if}
    </div>
  {/if}
  {#if mahlzeit.einplanungen.length || (bearbeiten && gerichte.size)}
    <div class="basis-full space-y-1 pl-14">
      {#if mahlzeit.einplanungen.length}
        <ol class="space-y-1" aria-label="Gerichte bei {mahlzeit.kennung}">
          {#each mahlzeit.einplanungen as einplanung, index (einplanung.id)}
            {@const name = gerichte.get(einplanung.gerichtId) ?? 'Gericht'}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                class="font-mono text-sm font-semibold text-brand-900"
                title="Gericht-ID: Tag_Mahlzeit_Gericht">{mahlzeit.kennung}_{index + 1}</span
              >
              <span class="min-w-0 font-semibold text-neutral-900 [overflow-wrap:anywhere]"
                >{name}</span
              >
              {#if faktorText(einplanung.faktor)}<span class="text-sm tabular-nums"
                  >{faktorText(einplanung.faktor)}</span
                >{/if}
              {#if einplanung.zustaendig}<span
                  class="min-w-0 text-sm text-neutral-700 [overflow-wrap:anywhere]"
                  >{einplanung.zustaendig}</span
                >{/if}
              {#if bearbeiten}
                <span class="flex flex-wrap gap-1 print:hidden">
                  <ActionButton
                    type="button"
                    disabled={index === 0 || kontext.busy}
                    aria-label="{name} bei {mahlzeit.kennung} nach oben"
                    onclick={() => void verschiebe(einplanung, einplanung.position - 1)}
                    >↑</ActionButton
                  >
                  <ActionButton
                    type="button"
                    disabled={index === mahlzeit.einplanungen.length - 1 || kontext.busy}
                    aria-label="{name} bei {mahlzeit.kennung} nach unten"
                    onclick={() => void verschiebe(einplanung, einplanung.position + 1)}
                    >↓</ActionButton
                  >
                  <ActionButton
                    type="button"
                    aria-label="{name} bei {mahlzeit.kennung} ändern"
                    onclick={() =>
                      oneinplanen({
                        modus: 'aendern',
                        mahlzeitId: mahlzeit.id,
                        einplanungId: einplanung.id,
                      })}>Ändern</ActionButton
                  >
                  <ActionButton
                    type="button"
                    aria-label="{name} bei {mahlzeit.kennung} kopieren"
                    onclick={() =>
                      oneinplanen({
                        modus: 'kopieren',
                        mahlzeitId: mahlzeit.id,
                        einplanungId: einplanung.id,
                      })}>Kopieren</ActionButton
                  >
                  <ActionButton
                    type="button"
                    variant="danger"
                    disabled={kontext.busy}
                    aria-label="{name} aus {mahlzeit.kennung} entfernen"
                    onclick={() => void entfernen(einplanung, name)}>Entfernen</ActionButton
                  >
                </span>
              {/if}
              <EinplanungMengen
                {kontext}
                {mahlzeit}
                {einplanung}
                {name}
                {esser}
                {unvertraeglichkeiten}
              />
            </li>
          {/each}
        </ol>
      {/if}
      {#if bearbeiten && gerichte.size}
        <button
          type="button"
          class="min-h-11 text-sm font-semibold text-link underline print:hidden"
          onclick={() => oneinplanen({ modus: 'neu', mahlzeitId: mahlzeit.id, einplanungId: null })}
          >Gericht einplanen<span class="sr-only"> bei {mahlzeit.kennung}</span></button
        >
      {/if}
    </div>
  {/if}
</li>
