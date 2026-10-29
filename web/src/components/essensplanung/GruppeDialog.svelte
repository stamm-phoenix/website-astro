<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { zahlText } from '../../lib/essensplanungTeilnehmende';
  import {
    GRUPPEN_FAKTOR_FEHLER,
    gruppenFaktorGueltig,
    leseGruppenFaktor,
  } from '../../../../api/lib/essen-teilnehmende-model';
  import type { PlanKontext } from './planKontext';

  /** Adds a group or changes its name and factor. */

  interface Props {
    kontext: PlanKontext;
    /** The group to change; null adds one; undefined: closed. */
    gruppeId: number | null | undefined;
    onclose: () => void;
  }
  let { kontext, gruppeId, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let name = $state('');
  let faktor = $state('1');
  let felder = $state<Record<string, string>>({});
  /** Why the last save failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => gruppeId !== undefined && geaendert));
  /** The version of the group when the dialog opened. */
  let etag = '';

  $effect(() => {
    const id = gruppeId;
    if (id !== undefined) untrack(() => fuelle(id));
  });

  function fuelle(id: number | null): void {
    felder = {};
    fehler = null;
    geaendert = false;
    const gruppe = id === null ? undefined : ansicht.gruppen.find((g) => g.id === id);
    etag = gruppe?.etag ?? '';
    name = gruppe?.name ?? '';
    faktor = gruppe ? zahlText(gruppe.faktor) : '1';
  }

  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || gruppeId === undefined) return;
    speichert = true;
    try {
      await speichereFormular(gruppeId);
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(id: number | null): Promise<void> {
    felder = {};
    fehler = null;
    const zahl = leseGruppenFaktor(faktor);
    if (!name.trim()) felder.name = 'Bitte einen Namen eintragen.';
    if (!gruppenFaktorGueltig(zahl)) felder.faktor = GRUPPEN_FAKTOR_FEHLER;
    if (Object.keys(felder).length) return;
    let abgelehnt: unknown = null;
    const body = { name, faktor: zahl };
    const ok = await kontext.aendern(async () => {
      try {
        return id === null
          ? await kontext.api.senden('POST', '/gruppen', body)
          : await kontext.api.senden('PATCH', `/gruppen/${id}`, { ...body, etag });
      } catch (error: unknown) {
        abgelehnt = error;
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, `${name.trim()} gespeichert.`);
    if (ok) {
      geaendert = false;
      onclose();
      return;
    }
    if (!Object.keys(felder).length) fehler = kontext.fehler;
    // Only after a conflict does saving again take the input over what is saved now
    const jetzt = ansicht.gruppen.find((g) => g.id === id);
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) etag = jetzt.etag;
  }

  async function schliessen(): Promise<void> {
    if (kontext.busy) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Deine Eingaben an dieser Gruppe sind noch nicht gespeichert.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    geaendert = false;
    onclose();
  }
</script>

<ModalDialog
  open={gruppeId !== undefined}
  title={gruppeId === null ? 'Neue Gruppe' : 'Gruppe ändern'}
  closeDisabled={kontext.busy}
  onclose={() => void schliessen()}
>
  <form
    class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    onsubmit={speichern}
    oninput={() => (geaendert = true)}
  >
    <fieldset class="min-w-0 space-y-4" disabled={speichert}>
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <FormField id="gruppe-name" label="Name" error={felder.name}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="50" bind:value={name} />
        {/snippet}
      </FormField>
      <FormField
        id="gruppe-faktor"
        label="Faktor"
        error={felder.faktor}
        info="Wie viel eine Person der Gruppe isst, gemessen an einer Portion: 0,7 für Wölflinge, 1,2 für Rover."
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input w-28"
            inputmode="decimal"
            autocomplete="off"
            bind:value={faktor}
          />
        {/snippet}
      </FormField>
      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {gruppeId === null ? 'Hinzufügen' : 'Speichern'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
