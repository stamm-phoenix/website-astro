<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';

  import FormField from '../pflege/FormField.svelte';

  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { nikolausSteuerung } from '../../lib/pflegeStore.svelte';
  import { refreshNikolausStatus } from '../../lib/nikolausStatusStore.svelte';

  import type { NikolausCleanupScope, StaffNikolausSteuerung } from '../../lib/types';

  import { formatDay } from '../../lib/nikolausSteuerungForm';
  interface Props {
    data: StaffNikolausSteuerung;
    onnotice: (message: string | null, kind: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = nikolausSteuerung.state;
  // Deleting
  let deleting = $state<NikolausCleanupScope | null>(null);
  let confirmation = $state('');
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);

  function startDelete(scope: NikolausCleanupScope): void {
    deleting = scope;
    confirmation = '';
    deleteError = null;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || !data) return;
    deleteBusy = true;
    deleteError = null;
    try {
      const result = await sendApi<{ view: StaffNikolausSteuerung }>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/loeschen',
        { scope: deleting, confirmation }
      );
      store.data = result.view;
      void refreshNikolausStatus();

      onnotice(
        deleting === 'bookings'
          ? 'Alle Anmeldungen und die Dispo sind gelöscht.'
          : 'Alle Helfenden und die Einteilung sind gelöscht.',
        'success'
      );
      deleting = null;
    } catch (error: unknown) {
      deleteError =
        (error instanceof ApiError && error.fields?.confirmation) ||
        errorMessage(
          error,
          'Die Daten wurden nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „endgültig löschen“.'
        );
    } finally {
      deleteBusy = false;
    }
  }
</script>

<section class="surface p-5 md:p-6" aria-labelledby="cleanup-heading">
  <h2 id="cleanup-heading" class="font-serif text-xl font-bold text-brand-900">Daten löschen</h2>
  <p class="mt-1 text-sm text-neutral-800">
    {#if data.cleanup.deleteBy}
      Laut Datenschutzerklärung bis <strong>{formatDay(data.cleanup.deleteBy)}</strong> löschen (ein
      Monat nach dem letzten Besuch am <strong>{formatDay(data.cleanup.lastVisit)}</strong>).
    {:else}
      Laut Datenschutzerklärung einen Monat nach dem letzten Besuch löschen; es gibt noch keinen
      bestätigten Besuch.
    {/if}
  </p>

  <ul class="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
    {#each [{ scope: 'bookings', title: 'Anmeldungen', text: `${data.cleanup.bookings} Anmeldungen, ${data.cleanup.dispoVisits} Besuche der Dispo`, count: data.cleanup.bookings + data.cleanup.dispoVisits }, { scope: 'helpers', title: 'Helfende', text: `${data.cleanup.helpers} Helfende, ${data.cleanup.assignments} Einträge der Einteilung`, count: data.cleanup.helpers }] as item (item.scope)}
      {@const scope = item.scope as NikolausCleanupScope}
      <li class="py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold text-brand-900">{item.title}</h3>
            <p class="text-sm text-neutral-700">{item.text}</p>
          </div>
          {#if deleting !== scope}
            <ActionButton
              variant="danger"
              type="button"
              disabled={item.count === 0 || deleting !== null}
              onclick={() => startDelete(scope)}
            >
              {item.title} löschen …
            </ActionButton>
          {/if}
        </div>
        {#if deleting === scope}
          <div
            class="mt-4 border-l-4 border-danger pl-4"
            role="group"
            aria-labelledby="delete-{scope}-warning"
          >
            <p id="delete-{scope}-warning" class="text-sm font-semibold text-danger">
              Endgültig – das lässt sich nicht rückgängig machen.
              {#if !data.cleanup.due}
                Die Löschfrist ist noch nicht erreicht.
              {/if}
            </p>
            <FormField
              id="delete-{scope}-confirmation"
              label={`Zur Bestätigung „${data.confirmations[scope]}“ eintippen`}
              error={deleteError ?? undefined}
              class="mt-3 max-w-md"
            >
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="text"
                  autocomplete="off"
                  class="form-input"
                  bind:value={confirmation}
                />
              {/snippet}
            </FormField>
            <div class="mt-3 flex flex-wrap gap-3">
              <ActionButton
                variant="danger"
                type="button"
                disabled={deleteBusy || confirmation.trim() !== data.confirmations[scope]}
                aria-busy={deleteBusy}
                onclick={() => void confirmDelete()}
              >
                {deleteBusy ? 'Wird gelöscht …' : `${item.title} endgültig löschen`}
              </ActionButton>
              <ActionButton
                variant="secondary"
                type="button"
                disabled={deleteBusy}
                onclick={() => (deleting = null)}
              >
                Abbrechen
              </ActionButton>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>
