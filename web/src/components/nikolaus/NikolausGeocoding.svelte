<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';

  import StatusLabel from '../ui/StatusLabel.svelte';

  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { nikolausSteuerung } from '../../lib/pflegeStore.svelte';

  import type { StaffNikolausSteuerung } from '../../lib/types';

  import { dateTime } from '../../lib/nikolausSteuerungForm';
  interface Props {
    data: StaffNikolausSteuerung;
    onnotice: (message: string | null, kind: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = nikolausSteuerung.state;
  // Geocoding reservation
  let releaseConfirmed = $state(false);
  let releaseBusy = $state(false);

  async function releaseGeocoding(): Promise<void> {
    if (!data?.geocoding.owner) return;
    releaseBusy = true;
    try {
      store.data = await sendApi<StaffNikolausSteuerung>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/geocoding',
        { owner: data.geocoding.owner, confirmedStopped: releaseConfirmed }
      );
      releaseConfirmed = false;

      onnotice('Die Sperre der Adresssuche ist gelöst.', 'success');
    } catch (error: unknown) {
      onnotice(
        (error instanceof ApiError && error.fields?.confirmedStopped) ||
          errorMessage(
            error,
            'Die Sperre der Adresssuche wurde nicht gelöst. Prüfe deine Internetverbindung und tippe noch einmal auf „Sperre lösen“.'
          ),
        'error'
      );
    } finally {
      releaseBusy = false;
    }
  }
</script>

<section class="surface p-5 md:p-6" aria-labelledby="geocoding-heading">
  <h2 id="geocoding-heading" class="font-serif text-xl font-bold text-brand-900">Adresssuche</h2>
  {#if data.geocoding.owner}
    <p class="mt-1 text-sm text-neutral-800">
      <StatusLabel tone="warning" label="Gesperrt" />
      Eine Adresssuche läuft seit
      {data.geocoding.startedAt
        ? dateTime.format(new Date(data.geocoding.startedAt))
        : 'unbekannt'}. Normalerweise dauert sie Sekunden. Hängt sie länger als ein paar Minuten,
      findet keine Adresse mehr ihren Ort; dann die Sperre lösen.
    </p>
    <label class="mt-3 flex gap-3 text-sm">
      <input type="checkbox" class="mt-1" bind:checked={releaseConfirmed} />
      Die Suche läuft seit mehr als zehn Minuten, es hängt also kein Vorgang mehr daran.
    </label>
    <div class="mt-3">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={!releaseConfirmed || releaseBusy}
        aria-busy={releaseBusy}
        onclick={() => void releaseGeocoding()}
      >
        {releaseBusy ? 'Wird gelöst …' : 'Sperre lösen'}
      </ActionButton>
    </div>
  {:else}
    <p class="mt-1 text-sm text-neutral-800">
      <StatusLabel tone="success" label="Frei" /> Keine Adresssuche läuft gerade.
    </p>
  {/if}
</section>
