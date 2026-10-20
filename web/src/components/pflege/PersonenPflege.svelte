<script lang="ts">
  import ReloadAction from '../ui/ReloadAction.svelte';
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { personenPflege } from '../../lib/pflegeStore.svelte';
  import { PERSON_GRUPPE_LABELS } from '../../lib/protokollEditor';
  import type { WeiterePerson } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import InfoHint from '../ui/InfoHint.svelte';

  /**
   * Weitere Personen (#301): Altleitende and others who take part regularly but are not in the
   * Entra group of the leaders. The Protokoll-Editor offers the active ones for every name.
   */

  interface Form {
    id: number | null;
    etag: string;
    name: string;
    login: string;
    gruppe: WeiterePerson['gruppe'];
    aktiv: boolean;
  }

  const store = personenPflege.state;
  let form = $state<Form | null>(null);
  let message = $state<string | null>(null);
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);

  const gruppen = $derived(
    (['altleitende', 'weitere'] as const).map((gruppe) => ({
      gruppe,
      personen: (store.data ?? []).filter((p) => p.gruppe === gruppe),
    }))
  );

  $effect(() => {
    untrack(() => void personenPflege.load());
  });

  function open(person?: WeiterePerson): void {
    form = person
      ? {
          id: person.id,
          etag: person.etag,
          name: person.name,
          login: person.login,
          gruppe: person.gruppe,
          aktiv: person.aktiv,
        }
      : { id: null, etag: '', name: '', login: '', gruppe: 'altleitende', aktiv: true };
    dialog.reset();
  }

  function close(): void {
    if (!busy) form = null;
  }

  /** After a conflict: replaces the input with the current version of the person. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await personenPflege.load({ force: true });
    const fresh = store.data?.find((p) => p.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Person wurde inzwischen gelöscht.';
      return false;
    }
    open(fresh);
    return true;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    if (dialog.invalid(form.name.trim() ? {} : { name: 'Bitte einen Namen angeben.' })) {
      await tick();
      document.getElementById('person-name')?.focus();
      return;
    }
    const { id, ...body } = form;
    await dialog.run(async () => {
      if (id) await sendApi('PATCH', `/intern/pflege/personen/${id}`, body);
      else await sendApi('POST', '/intern/pflege/personen', body);
      message = `${body.name.trim()} gespeichert.`;
      form = null;
      await personenPflege.load({ force: true });
    }, 'Die Person wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || busy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/personen/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = `${current.name.trim()} gelöscht. In alten Protokollen bleibt der Name stehen.`;
      form = null;
      await personenPflege.load({ force: true });
    }, 'Die Person wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap justify-end gap-2">
    <ReloadAction
      disabled={store.loading || busy}
      onclick={() => void personenPflege.load({ force: true })}>Neu laden</ReloadAction
    >
    <ActionButton variant="primary" disabled={!store.data || busy} onclick={() => open()}
      >Person hinzufügen</ActionButton
    >
  </div>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Personen werden geladen …"
    onretry={() => void personenPflege.load({ force: true })}
    isEmpty={(data) => data.length === 0}
  >
    {#snippet empty()}
      <div class="border-t border-neutral-200 pt-5">
        <h2 class="font-serif text-xl text-brand-900">Noch niemand eingetragen</h2>
      </div>
    {/snippet}
    {#each gruppen as { gruppe, personen } (gruppe)}
      <section class="pt-2" aria-labelledby="personen-{gruppe}">
        <h2
          id="personen-{gruppe}"
          class="border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900"
        >
          {PERSON_GRUPPE_LABELS[gruppe]}
        </h2>
        {#if personen.length === 0}
          <p class="py-4 text-sm text-neutral-700">Niemand eingetragen.</p>
        {:else}
          <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
            {#each personen as person (person.id)}
              <li
                class="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="min-w-0">
                  <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
                    {person.name}
                  </p>
                  <p class="flex flex-wrap gap-x-3 text-sm text-neutral-700">
                    {#if person.login}<span class="[overflow-wrap:anywhere]">{person.login}</span
                      >{/if}
                    <StatusLabel
                      label={person.aktiv ? 'Wird angeboten' : 'Inaktiv'}
                      tone={person.aktiv ? 'success' : 'neutral'}
                    />
                  </p>
                </div>
                <ActionButton
                  variant="secondary"
                  class="shrink-0"
                  aria-label="Bearbeiten: {person.name}"
                  disabled={busy}
                  onclick={() => open(person)}>Bearbeiten</ActionButton
                >
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  </LoadState>
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? 'Person bearbeiten' : 'Person hinzufügen'}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteTitle={`${form?.name.trim() ?? ''} löschen?`}
  deleteQuestion="Die Person aus der Liste löschen? In alten Protokollen bleibt der Name stehen."
>
  {#if form}
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Person</legend>
      <FormField id="person-name" label="Name" error={errors.name}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="text"
            class="form-input"
            maxlength="200"
            bind:value={form!.name}
          />
        {/snippet}
      </FormField>
      <FormField id="person-gruppe" label="Gruppe" error={errors.gruppe}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={form!.gruppe}>
            <option value="altleitende">{PERSON_GRUPPE_LABELS.altleitende}</option>
            <option value="weitere">{PERSON_GRUPPE_LABELS.weitere}</option>
          </select>
        {/snippet}
      </FormField>
      <FormField id="person-login" label="Konto-Adresse" optional error={errors.login}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="email"
            class="form-input"
            maxlength="254"
            autocomplete="off"
            placeholder="vorname.nachname@stamm-phoenix.de"
            bind:value={form!.login}
          />
        {/snippet}
      </FormField>
      <div class="form-field">
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <input
              id="person-aktiv"
              type="checkbox"
              aria-invalid={errors.aktiv ? 'true' : undefined}
              aria-describedby={errors.aktiv ? 'person-aktiv-error' : undefined}
              bind:checked={form!.aktiv}
            />
            Im Protokoll zur Auswahl anbieten
          </label>
          <InfoHint
            label="Im Protokoll zur Auswahl anbieten"
            text="Inaktive Personen bleiben in alten Protokollen stehen, werden aber nicht mehr angeboten."
          />
        </div>
        {#if errors.aktiv}
          <p id="person-aktiv-error" class="mt-1 text-sm text-danger">{errors.aktiv}</p>
        {/if}
      </div>
    </fieldset>
  {/if}
</EditDialog>
