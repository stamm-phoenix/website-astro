<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

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
  }
  let { kontext, mahlzeit, bearbeiten, erste, letzte }: Props = $props();

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

  // Typed, kept after a failed save or a conflict, or still saving: asks before leaving the page
  $effect(() =>
    guardUnsavedChanges(
      () =>
        entwurf || (name.trim() || basis.name) !== basis.name || uhrzeit.trim() !== basis.uhrzeit
    )
  );

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
    if (
      !(await confirmAction({
        title: `${mahlzeit.kennung} ${mahlzeit.name} löschen?`,
        message: 'Die Mahlzeit wird gelöscht; die Nummern der folgenden Mahlzeiten rücken nach.',
        confirmLabel: 'Mahlzeit löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/mahlzeiten/${mahlzeit.id}`, undefined, mahlzeit.etag),
      `${mahlzeit.name} gelöscht.`
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
</li>
