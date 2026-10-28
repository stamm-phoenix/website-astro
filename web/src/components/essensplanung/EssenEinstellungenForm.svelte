<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { formatDateTime } from '../../lib/format';
  import {
    canonicalEinstellungen,
    fromEinstellungenForm,
    newRowKey,
    toEinstellungenForm,
    type EinstellungenForm,
  } from '../../lib/essensplanungSteuerung';
  import type { StaffEssenSteuerung } from '../../lib/types';

  interface Props {
    data: StaffEssenSteuerung;
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = essensplanungSteuerung.state;

  let form = $state<EinstellungenForm | null>(null);
  /** Version the form was filled from. */
  let etag = $state('');
  let baseline = $state('');
  let conflict = $state(false);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  const dirty = $derived(
    form !== null && canonicalEinstellungen(fromEinstellungenForm(form)) !== baseline
  );
  const stale = $derived(conflict || (form !== null && etag !== data.etag));

  // Fill the form from the loaded settings, unless the user is editing
  $effect(() => {
    const current = data;
    untrack(() => {
      if (!form || !dirty) fill(current);
    });
  });

  $effect(() => guardUnsavedChanges(() => dirty));

  function fill(current: StaffEssenSteuerung): void {
    etag = current.etag;
    baseline = canonicalEinstellungen(current.einstellungen);
    conflict = false;
    errors = {};
    form = toEinstellungenForm(current.einstellungen);
  }

  /** Field errors of the whitelist name the index of the entry; shown under the text field. */
  const whitelistError = $derived(
    Object.entries(errors)
      .filter(([key]) => key.startsWith('whitelist'))
      .map(([, text]) => text)[0]
  );

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!form || saving || stale) return;
    const sent = fromEinstellungenForm(form);
    if (
      sent.wartung &&
      !data.einstellungen.wartung &&
      !(await confirmAction({
        title: 'Wartungsmodus einschalten?',
        message:
          'Danach kann niemand mehr etwas an Planungen ändern, bis du ihn wieder ausschaltest. Ansehen geht weiter.',
        confirmLabel: 'Einschalten und speichern',
        cancelLabel: 'Weiter bearbeiten',
      }))
    )
      return;
    saving = true;
    errors = {};
    onnotice(null);
    try {
      const view = await sendApi<StaffEssenSteuerung>(
        'PUT',
        '/intern/pflege/essensplanung/einstellungen',
        { etag, einstellungen: sent }
      );
      store.data = view;
      fill(view);
      onnotice('Einstellungen gespeichert. Sie gelten ab sofort.');
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        conflict = error.status === 409;
        if (error.fields) errors = error.fields;
      }
      onnotice(
        conflict
          ? 'Jemand anderes hat die Einstellungen inzwischen geändert. Lade die aktuelle Fassung; deine Eingaben gehen dabei verloren.'
          : errorMessage(
              error,
              'Die Einstellungen wurden nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Einstellungen speichern“.'
            ),
        'error'
      );
    } finally {
      saving = false;
    }
  }

  async function reloadCurrent(): Promise<void> {
    await essensplanungSteuerung.load({ force: true });
    if (store.data) fill(store.data);
  }

  function addGruppe(): void {
    form?.vorlageGruppen.push({ key: newRowKey(), name: '', faktor: '1' });
  }

  function addMahlzeit(): void {
    form?.vorlageMahlzeiten.push({ key: newRowKey(), name: '' });
  }
</script>

{#if form}
  <form novalidate onsubmit={save} aria-labelledby="einstellungen-heading">
    <div
      class="sticky top-20 z-20 mb-4 flex flex-wrap items-center gap-3 border-y border-neutral-300 bg-surface p-3 print:hidden"
    >
      <ActionButton
        variant="primary"
        type="submit"
        disabled={saving || !dirty || stale}
        aria-busy={saving}
      >
        {saving ? 'Wird gespeichert …' : 'Einstellungen speichern'}
      </ActionButton>
      {#if stale}
        <ActionButton type="button" onclick={() => void reloadCurrent()}>
          Aktuelle Fassung laden
        </ActionButton>
      {/if}
      <p role="status" class="text-sm font-semibold">
        {dirty ? 'Änderungen noch nicht gespeichert.' : 'Alle Änderungen gespeichert.'}
      </p>
      <p class="text-sm text-neutral-700">
        Zuletzt geändert {formatDateTime(data.updatedAt)} von {data.updatedBy}
      </p>
    </div>

    <fieldset disabled={saving} inert={saving} class="min-w-0 space-y-8">
      <section class="surface p-5 md:p-6" aria-labelledby="einstellungen-heading">
        <h2 id="einstellungen-heading" class="font-serif text-xl font-bold text-brand-900">
          Wer darf Planungen anlegen?
        </h2>
        <p class="mt-1 text-sm text-neutral-700">
          Adressen auf @stamm-phoenix.de dürfen immer. Alle anderen nur, wenn das Anlegen durch
          Externe an ist und ihre Adresse oder Domain in der Liste steht. Ist die Liste leer, dürfen
          alle.
        </p>
        <div class="mt-4 space-y-4">
          <label class="flex gap-3">
            <input type="checkbox" class="mt-1" bind:checked={form.anlegenExtern} />
            <span>
              <span class="font-semibold text-brand-900">Anlegen durch Externe</span>
              <span class="block text-sm text-neutral-700">
                Menschen außerhalb des Stammes, z. B. aus dem Bezirk, können eigene Planungen
                anlegen.
              </span>
            </span>
          </label>
          <FormField
            id="essen-whitelist"
            label="Erlaubte Adressen und Domains"
            optional
            hint="Eine pro Zeile, z. B. dpsg-bezirk.de oder kueche@example.org."
            error={whitelistError}
          >
            {#snippet children(attrs)}
              <textarea
                {...attrs}
                class="form-input resize-y font-mono text-sm"
                rows="4"
                bind:value={form!.whitelist}></textarea>
            {/snippet}
          </FormField>
          <FormField
            id="essen-aufbewahrung"
            label="Aufbewahrung in Monaten nach dem letzten Tag"
            hint="Danach wird eine Planung mit allen Daten gelöscht; die Besitzer:innen bekommen 14 Tage vorher eine Mail."
            error={errors.aufbewahrungMonate}
            class="max-w-xs"
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                type="text"
                inputmode="numeric"
                class="form-input"
                bind:value={form!.aufbewahrungMonate}
              />
            {/snippet}
          </FormField>
          <label class="flex gap-3">
            <input type="checkbox" class="mt-1" bind:checked={form.wartung} />
            <span>
              <span class="font-semibold text-brand-900">Wartungsmodus</span>
              <span class="block text-sm text-neutral-700">
                Sperrt alle Änderungen an Planungen; ansehen geht weiter. Nur bei Störungen.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section class="surface p-5 md:p-6" aria-labelledby="vorlagen-heading">
        <h2 id="vorlagen-heading" class="font-serif text-xl font-bold text-brand-900">
          Vorlagen für neue Planungen
        </h2>
        <p class="mt-1 text-sm text-neutral-700">
          Jede neue Planung startet mit diesen Gruppen und Mahlzeiten und kann sie danach frei
          ändern. Der Faktor gibt an, wie viel eine Person der Gruppe im Vergleich isst.
        </p>
        <div class="mt-4 grid gap-8 md:grid-cols-2">
          <fieldset class="min-w-0">
            <legend class="font-semibold text-brand-900">Gruppen</legend>
            {#if errors.vorlageGruppen}
              <p class="mt-1 text-sm text-danger">{errors.vorlageGruppen}</p>
            {/if}
            <ul class="mt-2 space-y-2">
              {#each form.vorlageGruppen as gruppe, index (gruppe.key)}
                <li class="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2">
                  <FormField
                    id="gruppe-{gruppe.key}-name"
                    label="Name"
                    error={errors[`vorlageGruppen.${index}.name`]}
                  >
                    {#snippet children(attrs)}
                      <input
                        {...attrs}
                        class="form-input"
                        maxlength="50"
                        bind:value={gruppe.name}
                      />
                    {/snippet}
                  </FormField>
                  <FormField
                    id="gruppe-{gruppe.key}-faktor"
                    label="Faktor"
                    error={errors[`vorlageGruppen.${index}.faktor`]}
                  >
                    {#snippet children(attrs)}
                      <input
                        {...attrs}
                        class="form-input"
                        inputmode="decimal"
                        bind:value={gruppe.faktor}
                      />
                    {/snippet}
                  </FormField>
                  <ActionButton
                    type="button"
                    variant="danger"
                    class="mt-7 print:hidden"
                    aria-label="Gruppe {gruppe.name || 'ohne Namen'} entfernen"
                    disabled={form.vorlageGruppen.length <= 1}
                    onclick={() => form!.vorlageGruppen.splice(index, 1)}>Entfernen</ActionButton
                  >
                </li>
              {/each}
            </ul>
            <ActionButton type="button" class="mt-3 print:hidden" onclick={addGruppe}>
              Gruppe hinzufügen
            </ActionButton>
          </fieldset>

          <fieldset class="min-w-0">
            <legend class="font-semibold text-brand-900">Mahlzeiten eines Tages</legend>
            {#if errors.vorlageMahlzeiten}
              <p class="mt-1 text-sm text-danger">{errors.vorlageMahlzeiten}</p>
            {/if}
            <ol class="mt-2 space-y-2">
              {#each form.vorlageMahlzeiten as mahlzeit, index (mahlzeit.key)}
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <FormField
                    id="mahlzeit-{mahlzeit.key}"
                    label="{index + 1}. Mahlzeit"
                    error={errors[`vorlageMahlzeiten.${index}`]}
                  >
                    {#snippet children(attrs)}
                      <input
                        {...attrs}
                        class="form-input"
                        maxlength="50"
                        bind:value={mahlzeit.name}
                      />
                    {/snippet}
                  </FormField>
                  <ActionButton
                    type="button"
                    variant="danger"
                    class="mt-7 print:hidden"
                    aria-label="Mahlzeit {mahlzeit.name || 'ohne Namen'} entfernen"
                    disabled={form.vorlageMahlzeiten.length <= 1}
                    onclick={() => form!.vorlageMahlzeiten.splice(index, 1)}>Entfernen</ActionButton
                  >
                </li>
              {/each}
            </ol>
            <ActionButton type="button" class="mt-3 print:hidden" onclick={addMahlzeit}>
              Mahlzeit hinzufügen
            </ActionButton>
          </fieldset>
        </div>
      </section>
    </fieldset>
  </form>
{/if}
