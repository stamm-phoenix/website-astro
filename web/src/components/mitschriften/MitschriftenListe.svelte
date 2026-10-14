<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import MitschriftWiederherstellen from './MitschriftWiederherstellen.svelte';
  import { errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { formatDuration, mitschriftUrl } from '../../lib/mitschriften';
  import type { MitschriftDetail, MitschriftenOverview, MitschriftStatus } from '../../lib/types';

  const STATUS: Record<MitschriftStatus, { label: string; tone: 'neutral' | 'warning' }> = {
    live: { label: 'Aufnahme läuft', tone: 'warning' },
    datei: { label: 'Wartet auf die Datei', tone: 'warning' },
    fertig: { label: 'Fertig', tone: 'neutral' },
  };

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  let overview = $state.raw<MitschriftenOverview | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');

  interface Draft {
    title: string;
    date: string;
    mode: 'live' | 'datei';
    consent: boolean;
  }
  let draft = $state<Draft | null>(null);
  // A conflict cannot be reloaded here, so the dialogs show the API's own message
  const draftForm = createDialogForm(errorMessage);

  let cleanupOpen = $state(false);
  const cleanupForm = createDialogForm(errorMessage);

  async function load(): Promise<void> {
    loadError = null;
    try {
      overview = await fetchApi<MitschriftenOverview>('/intern/mitschriften');
    } catch (error: unknown) {
      loadError = errorMessage(error, 'Die Mitschriften konnten nicht geladen werden.');
    }
  }

  function startCreate(mode: Draft['mode']): void {
    draft = {
      title: 'Leitendenrunde',
      date: overview?.today ?? new Date().toISOString().slice(0, 10),
      mode,
      consent: false,
    };
    draftForm.reset();
  }

  async function create(): Promise<void> {
    if (!draft) return;
    const body = draft;
    await draftForm.run(async () => {
      const created = await sendApi<MitschriftDetail>('POST', '/intern/pflege/mitschriften', body);
      // Saved: close the dialog first, so its warning about unsaved changes is gone
      draft = null;
      await tick();
      window.location.href = mitschriftUrl(created.id);
    }, 'Die Mitschrift konnte nicht angelegt werden.');
  }

  async function cleanup(): Promise<void> {
    await cleanupForm.run(async () => {
      const { deleted } = await sendApi<{ deleted: number }>(
        'POST',
        '/intern/pflege/mitschriften-aufraeumen'
      );
      cleanupOpen = false;
      messageKind = 'success';
      message = `${deleted} alte ${deleted === 1 ? 'Mitschrift' : 'Mitschriften'} endgültig gelöscht.`;
      await load();
    }, 'Das Aufräumen hat nicht geklappt.');
  }

  $effect(() => {
    untrack(() => void load());
  });
</script>

<div class="space-y-6">
  <MitschriftWiederherstellen />

  <LoadState
    data={overview}
    loading={!overview && !loadError}
    error={loadError}
    loadingText="Mitschriften werden geladen …"
    onretry={load}
  >
    {#snippet skeleton()}
      <div class="space-y-2">
        {#each [1, 2, 3] as n (n)}
          <div class="skeleton-element h-16 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet children(overview)}
      <div class="flex flex-wrap gap-2">
        <ActionButton variant="primary" onclick={() => startCreate('live')}>
          Live aufnehmen
        </ActionButton>
        <ActionButton onclick={() => startCreate('datei')}>Audiodatei hochladen</ActionButton>
      </div>

      <StatusNotice {message} kind={messageKind} popup />

      {#if overview.oldCount > 0}
        <div class="border-l-2 border-warning py-1 pl-4 text-sm">
          <p class="font-semibold text-warning">
            {overview.oldCount}
            {overview.oldCount === 1 ? 'Mitschrift ist' : 'Mitschriften sind'} älter als
            {overview.warnAfterMonths} Monate.
          </p>
          <p class="mt-1 text-neutral-700">
            Mitschriften werden nicht automatisch gelöscht. Was nicht mehr gebraucht wird, bitte
            aufräumen.
          </p>
          <ActionButton
            class="mt-2"
            variant="danger"
            onclick={() => {
              cleanupOpen = true;
              cleanupForm.reset();
            }}
          >
            Alte Mitschriften aufräumen
          </ActionButton>
        </div>
      {/if}

      {#if overview.mitschriften.length === 0}
        <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
          Noch keine Mitschriften.
        </p>
      {:else}
        <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
          {#each overview.mitschriften as mitschrift (mitschrift.id)}
            <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4">
              <div>
                <a class="text-lg font-semibold text-link" href={mitschriftUrl(mitschrift.id)}>
                  {mitschrift.title}
                </a>
                <p class="text-sm text-neutral-700">
                  {dateFormatter.format(new Date(`${mitschrift.date}T00:00:00Z`))}
                  {#if mitschrift.abschnitte > 0}
                    · {formatDuration(mitschrift.durationMs)} · {mitschrift.abschnitte}
                    {mitschrift.abschnitte === 1 ? 'Satz' : 'Sätze'}
                  {/if}
                  {#if mitschrift.auftraege > 0}
                    · wird transkribiert
                  {/if}
                </p>
              </div>
              <StatusLabel {...STATUS[mitschrift.status]} />
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </LoadState>
</div>

<EditDialog
  open={draft !== null}
  title={draft?.mode === 'datei' ? 'Audiodatei transkribieren' : 'Meeting live mitschreiben'}
  busy={draftForm.state.busy}
  error={draftForm.state.error}
  submitLabel={draft?.mode === 'datei' ? 'Weiter zum Hochladen' : 'Weiter zur Aufnahme'}
  busyLabel="Wird angelegt …"
  onsubmit={create}
  onclose={() => (draft = null)}
>
  {#if draft}
    <div class="space-y-4">
      <FormField id="mitschrift-title" label="Titel" error={draftForm.state.fields.title}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="200" required bind:value={draft!.title} />
        {/snippet}
      </FormField>
      <FormField
        id="mitschrift-date"
        label="Datum des Meetings"
        error={draftForm.state.fields.date}
      >
        {#snippet children(attrs)}
          <input {...attrs} type="date" class="form-input" required bind:value={draft!.date} />
        {/snippet}
      </FormField>
      <div>
        <label class="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            class="mt-1"
            required
            aria-invalid={draftForm.state.fields.consent ? 'true' : undefined}
            aria-describedby="mitschrift-consent-hint"
            bind:checked={draft.consent}
          />
          <span>Alle Anwesenden wurden informiert und sind einverstanden.</span>
        </label>
        <p id="mitschrift-consent-hint" class="mt-1 text-xs text-neutral-700">
          {#if draft.mode === 'live'}
            Sind Externe über Teams dabei, informiere sie bitte selbst: Teams zeigt ihnen bei
            unserem Tool keinen Hinweis an.
          {:else}
            Nur Aufnahmen hochladen, bei denen alle mit der Aufnahme und der Transkription
            einverstanden waren.
          {/if}
          Transkribiert wird mit Azure AI Speech, die Notizen schreibt Azure OpenAI. Audio wird nur bis
          zur Transkription aufbewahrt (verschlüsselt im Browser der aufnehmenden Person oder kurz in
          Azure) und nie abgespielt.
        </p>
        {#if draftForm.state.fields.consent}
          <p class="mt-1 text-sm text-danger">{draftForm.state.fields.consent}</p>
        {/if}
      </div>
    </div>
  {/if}
</EditDialog>

<ConfirmDialog
  open={cleanupOpen}
  title="Alte Mitschriften aufräumen"
  busy={cleanupForm.state.busy}
  error={cleanupForm.state.error}
  submitLabel="Endgültig löschen"
  busyLabel="Wird gelöscht …"
  onconfirm={cleanup}
  onclose={() => (cleanupOpen = false)}
>
  <p class="text-sm text-neutral-800">
    {overview?.oldCount ?? 0}
    {overview?.oldCount === 1 ? 'Mitschrift' : 'Mitschriften'} mit einem Meeting vor mehr als
    {overview?.warnAfterMonths ?? 12} Monaten werden mit Transkript und Notizen endgültig gelöscht. Das
    lässt sich nicht rückgängig machen.
  </p>
</ConfirmDialog>
