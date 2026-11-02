<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { packlisteSchluessel } from '../../../../api/lib/essen-packliste-model';
  import {
    freiName,
    personenWahl,
    type PackAuswahl,
    type PackZeile,
  } from '../../lib/essensplanungPackliste';
  import type { PlanKontext } from './planKontext';

  /**
   * Chooses who packs a thing: any members with „Alle“ and „Niemand“ at hand, and free names.
   * `onwahl` saves the choice (or keeps it for a new thing) and says whether the dialog closes.
   */

  interface Props {
    kontext: PlanKontext;
    /** The thing, named in the title; undefined: closed. */
    was: string | undefined;
    /** The row whose persons are chosen; null for a new thing. */
    zeile: PackZeile | null;
    /** The choice the dialog opens with. */
    start: PackAuswahl;
    submitLabel: string;
    onwahl: (auswahl: PackAuswahl) => Promise<string | null>;
    onclose: () => void;
  }
  let { kontext, was, zeile, start, submitLabel, onwahl, onclose }: Props = $props();

  let mitglieder = $state<number[]>([]);
  /** Free names with whether they are chosen; unticked ones stay to tick again. */
  let namen = $state<{ name: string; an: boolean }[]>([]);
  let neuerName = $state('');
  let geaendert = $state(false);
  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let namenFeld = $state<HTMLInputElement | null>(null);

  const offen = $derived(was !== undefined);
  const wahl = $derived(personenWahl(kontext.ansicht.mitglieder, zeile));
  const mitZugang = $derived(wahl.filter((m) => !m.ohneZugang).map((m) => m.id));

  $effect(() => guardUnsavedChanges(() => offen && geaendert));
  $effect(() => {
    if (offen) untrack(fuelle);
  });

  function fuelle(): void {
    mitglieder = [...start.mitglieder];
    namen = start.namen.map((name) => ({ name, an: true }));
    neuerName = '';
    geaendert = false;
    fehler = null;
  }

  function mitglied(id: number, an: boolean): void {
    mitglieder = an ? [...mitglieder, id] : mitglieder.filter((m) => m !== id);
    geaendert = true;
  }

  function alle(): void {
    mitglieder = [...new Set([...mitglieder, ...mitZugang])];
    geaendert = true;
  }

  function niemand(): void {
    mitglieder = [];
    namen = namen.map((n) => ({ ...n, an: false }));
    geaendert = true;
  }

  /** Adds the typed name, chosen; a name there already is chosen again. */
  function nameHinzu(): void {
    const name = freiName(neuerName);
    if (!name) return;
    const schluessel = packlisteSchluessel(name);
    namen = namen.some((n) => packlisteSchluessel(n.name) === schluessel)
      ? namen.map((n) => (packlisteSchluessel(n.name) === schluessel ? { ...n, an: true } : n))
      : [...namen, { name, an: true }];
    neuerName = '';
    geaendert = true;
    void tick().then(() => namenFeld?.focus());
  }

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert) return;
    // A name typed and not added yet counts as chosen
    nameHinzu();
    speichert = true;
    fehler = null;
    // In the order of the list, so „Alle“ keeps the order of the members
    const auswahl: PackAuswahl = {
      mitglieder: wahl.map((m) => m.id).filter((id) => mitglieder.includes(id)),
      namen: namen.filter((n) => n.an).map((n) => n.name),
    };
    fehler = await onwahl(auswahl);
    speichert = false;
    if (fehler === null) {
      geaendert = false;
      onclose();
    }
  }

  async function schliessen(): Promise<void> {
    if (speichert) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: `Deine Auswahl, wer ${was} einpackt, ist noch nicht gespeichert.`,
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Weiter bearbeiten',
      }))
    )
      return;
    geaendert = false;
    onclose();
  }

  const zeilenKlasse =
    'flex min-h-8 any-pointer-coarse:min-h-11 cursor-pointer items-center gap-2 [overflow-wrap:anywhere]';
</script>

<ModalDialog
  open={offen}
  title="Wer packt {was} ein?"
  size="narrow"
  closeDisabled={speichert}
  onclose={() => void schliessen()}
>
  <form class="min-h-0 space-y-3 overflow-y-auto px-5 py-4" onsubmit={speichern}>
    {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
    <div class="flex flex-wrap gap-2">
      <ActionButton
        type="button"
        class="min-h-8 px-3 py-1 text-sm any-pointer-coarse:min-h-11"
        disabled={speichert}
        onclick={alle}>Alle</ActionButton
      >
      <ActionButton
        type="button"
        class="min-h-8 px-3 py-1 text-sm any-pointer-coarse:min-h-11"
        disabled={speichert}
        onclick={niemand}>Niemand</ActionButton
      >
    </div>
    <fieldset class="min-w-0" disabled={speichert}>
      <legend class="form-label text-xs">Mitglieder</legend>
      {#each wahl as m (m.id)}
        {@const an = mitglieder.includes(m.id)}
        <label class={zeilenKlasse}>
          <input
            type="checkbox"
            class="size-4 shrink-0 any-pointer-coarse:size-5"
            checked={an}
            disabled={m.ohneZugang && !an}
            onchange={(event) => mitglied(m.id, event.currentTarget.checked)}
          />
          <span
            >{m.name}{m.ich ? ' (du)' : ''}{#if m.ohneZugang}<span class="text-xs text-neutral-700">
                · ohne Zugang</span
              >{/if}</span
          >
        </label>
      {/each}
    </fieldset>
    <fieldset class="min-w-0" disabled={speichert}>
      <legend class="form-label text-xs">Andere Namen</legend>
      {#each namen as n, index (n.name)}
        <label class={zeilenKlasse}>
          <input
            type="checkbox"
            class="size-4 shrink-0 any-pointer-coarse:size-5"
            checked={n.an}
            onchange={(event) => {
              namen[index] = { ...n, an: event.currentTarget.checked };
              geaendert = true;
            }}
          />
          <span>{n.name}</span>
        </label>
      {/each}
      <div class="mt-1 flex gap-2">
        <input
          bind:this={namenFeld}
          bind:value={neuerName}
          class="form-input mt-0 min-h-8 min-w-0 flex-1 py-0.5 text-sm any-pointer-coarse:min-h-11"
          aria-label="Anderer Name"
          placeholder="Name, z. B. Rover"
          maxlength="100"
          oninput={() => (geaendert = true)}
          onkeydown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            nameHinzu();
          }}
        />
        <ActionButton
          type="button"
          class="min-h-8 px-3 py-1 text-sm whitespace-nowrap any-pointer-coarse:min-h-11"
          disabled={!neuerName.trim()}
          onclick={nameHinzu}>Hinzufügen</ActionButton
        >
      </div>
    </fieldset>
    <div class="flex flex-wrap justify-end gap-2 pt-2">
      <ActionButton type="button" disabled={speichert} onclick={() => void schliessen()}
        >Abbrechen</ActionButton
      >
      <ActionButton type="submit" variant="primary" disabled={speichert || kontext.busy}
        >{submitLabel}</ActionButton
      >
    </div>
  </form>
</ModalDialog>
