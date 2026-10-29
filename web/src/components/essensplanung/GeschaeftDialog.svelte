<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { PlanKontext } from './planKontext';

  /** Adds a shop of the Planung or renames it. */

  interface Props {
    kontext: PlanKontext;
    /** The shop to change; null adds one; undefined: closed. */
    geschaeftId: number | null | undefined;
    onclose: () => void;
  }
  let { kontext, geschaeftId, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let name = $state('');
  let felder = $state<Record<string, string>>({});
  /** Why the last save failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => geschaeftId !== undefined && geaendert));
  /** The version of the shop when the dialog opened. */
  let etag = '';

  $effect(() => {
    const id = geschaeftId;
    if (id !== undefined) untrack(() => fuelle(id));
  });

  function fuelle(id: number | null): void {
    felder = {};
    fehler = null;
    geaendert = false;
    const geschaeft = id === null ? undefined : ansicht.geschaefte.find((g) => g.id === id);
    etag = geschaeft?.etag ?? '';
    name = geschaeft?.name ?? '';
  }

  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || geschaeftId === undefined) return;
    speichert = true;
    try {
      await speichereFormular(geschaeftId);
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(id: number | null): Promise<void> {
    felder = {};
    fehler = null;
    if (!name.trim()) felder.name = 'Bitte einen Namen eintragen.';
    if (Object.keys(felder).length) return;
    let abgelehnt: unknown = null;
    const body = { name };
    const ok = await kontext.aendern(async () => {
      try {
        return id === null
          ? await kontext.api.senden('POST', '/geschaefte', body)
          : await kontext.api.senden('PATCH', `/geschaefte/${id}`, { ...body, etag });
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
    const jetzt = ansicht.geschaefte.find((g) => g.id === id);
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) etag = jetzt.etag;
  }

  async function schliessen(): Promise<void> {
    if (kontext.busy) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Deine Eingaben an diesem Geschäft sind noch nicht gespeichert.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    geaendert = false;
    onclose();
  }
</script>

<ModalDialog
  open={geschaeftId !== undefined}
  title={geschaeftId === null ? 'Neues Geschäft' : 'Geschäft ändern'}
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
      <FormField id="geschaeft-name" label="Name" error={felder.name}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="80"
            placeholder="z. B. Metro"
            bind:value={name}
          />
        {/snippet}
      </FormField>
      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {geschaeftId === null ? 'Hinzufügen' : 'Speichern'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
