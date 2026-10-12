<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import MitschriftLive from './MitschriftLive.svelte';
  import MitschriftNotizen from './MitschriftNotizen.svelte';
  import MitschriftTranskript from './MitschriftTranskript.svelte';
  import MitschriftUpload from './MitschriftUpload.svelte';
  import MitschriftWiederherstellen from './MitschriftWiederherstellen.svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import { isCacheSupported } from '../../lib/mitschriftAudioCache';
  import { formatClock, settleChunks } from '../../lib/mitschriften';
  import type { MitschriftDetail } from '../../lib/types';

  const POLL_MS = 10_000;

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  let id = $state<number | null>(null);
  let mitschrift = $state.raw<MitschriftDetail | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  let generating = $state(false);
  let recordingHere = $state(false);
  let recoveryKey = $state(0);

  let editing = $state<{ title: string; date: string } | null>(null);
  let editErrors = $state<Record<string, string>>({});
  let editError = $state<string | null>(null);
  let editBusy = $state(false);
  let deleting = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);

  const user = $derived(authStore.principal?.userDetails ?? '');
  const runningJobs = $derived(
    mitschrift?.auftraege.filter((a) => a.status === 'laeuft' || a.status === 'hochladen') ?? []
  );
  const failedJobs = $derived(mitschrift?.auftraege.filter((a) => a.status === 'fehler') ?? []);

  function notify(text: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    messageKind = kind;
    message = text;
  }

  function errorText(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  /** Takes a loaded Mitschrift; deletes local pieces whose job is done. */
  function show(detail: MitschriftDetail): void {
    mitschrift = detail;
    if (user && isCacheSupported()) void settleChunks(detail, user).catch(() => undefined);
  }

  async function load(): Promise<void> {
    if (id === null) return;
    try {
      show(await fetchApi<MitschriftDetail>(`/intern/mitschriften/${id}`));
      loadError = null;
    } catch (error: unknown) {
      loadError = errorText(error, 'Die Mitschrift konnte nicht geladen werden.');
    }
  }

  /** Writes the notes after a transcription, unless there are some already. */
  async function generateNotes(detail: MitschriftDetail): Promise<void> {
    if (detail.status !== 'fertig' || detail.notes !== null || detail.abschnitte.length === 0)
      return;
    generating = true;
    try {
      await sendApi('POST', `/intern/pflege/mitschriften/${detail.id}/notizen`, {
        pass: 'abschluss',
        etag: detail.etag,
      });
      await load();
    } catch (error: unknown) {
      notify(errorText(error, 'Die Notizen konnten nicht erzeugt werden.'), 'warning');
    } finally {
      generating = false;
    }
  }

  /** Asks Azure Speech about running jobs; stores finished results. */
  async function check(): Promise<void> {
    if (!mitschrift || recordingHere) return;
    try {
      const result = await sendApi<{ stored: boolean; mitschrift: MitschriftDetail }>(
        'POST',
        `/intern/pflege/mitschriften/${mitschrift.id}/pruefen`
      );
      show(result.mitschrift);
      if (result.stored) {
        notify('Die Transkription ist fertig. Das Audio wurde gelöscht.');
        await generateNotes(result.mitschrift);
      }
    } catch {
      // Tried again with the next poll
    }
  }

  async function dismissJob(auftragId: number): Promise<void> {
    if (!mitschrift) return;
    try {
      show(
        await sendApi<MitschriftDetail>(
          'DELETE',
          `/intern/pflege/mitschriften/${mitschrift.id}/auftraege/${auftragId}`
        )
      );
    } catch (error: unknown) {
      notify(errorText(error, 'Das hat nicht geklappt.'), 'error');
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing || !mitschrift) return;
    editBusy = true;
    editErrors = {};
    editError = null;
    try {
      await sendApi('PATCH', `/intern/pflege/mitschriften/${mitschrift.id}`, {
        ...editing,
        etag: mitschrift.etag,
      });
      editing = null;
      notify('Gespeichert.');
      await load();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) editErrors = error.fields;
      editError = errorText(error, 'Das Speichern hat nicht geklappt.');
    } finally {
      editBusy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!mitschrift) return;
    deleteBusy = true;
    deleteError = null;
    try {
      await sendApi('DELETE', `/intern/pflege/mitschriften/${mitschrift.id}`);
      window.location.href = '/leitendenbereich/mitschriften';
    } catch (error: unknown) {
      deleteError = errorText(error, 'Das Löschen hat nicht geklappt.');
      deleteBusy = false;
    }
  }

  /** After deleting sentences the notes are gone; they are written again from the rest. */
  async function afterDelete(): Promise<void> {
    await load();
    if (mitschrift) await generateNotes(mitschrift);
  }

  async function finished(detail: MitschriftDetail): Promise<void> {
    show(detail);
    notify('Aufnahme beendet. Die Notizen werden erzeugt.');
    await generateNotes(detail);
  }

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('id') ?? '';
      id = /^\d{1,9}$/.test(param) ? Number(param) : null;
      if (id === null) {
        loadError = 'Diese Mitschrift gibt es nicht.';
        return;
      }
      void fetchPrincipal().then(load);
    });
  });

  // Asks about running jobs while the page is open (not while recording here: the
  // recorder does it itself)
  $effect(() => {
    if (runningJobs.length === 0 || recordingHere) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);
    return () => clearInterval(timer);
  });
</script>

<div class="space-y-8">
  {#if loadError}
    <div class="space-y-3">
      <p class="text-sm font-semibold text-danger" role="alert">{loadError}</p>
      {#if id !== null}<ActionButton onclick={load}>Erneut laden</ActionButton>{/if}
    </div>
  {:else if !mitschrift}
    <p role="status" aria-live="polite" class="text-sm text-neutral-700">Wird geladen …</p>
  {:else}
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="font-serif text-3xl text-brand-900">{mitschrift.title}</h2>
        <p class="text-neutral-700">
          {dateFormatter.format(new Date(`${mitschrift.date}T00:00:00Z`))} · angelegt von
          {mitschrift.createdBy}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <ActionButton
          disabled={recordingHere}
          onclick={() => {
            editing = { title: mitschrift!.title, date: mitschrift!.date };
            editErrors = {};
            editError = null;
          }}
        >
          Titel und Datum
        </ActionButton>
        <ActionButton
          variant="danger"
          disabled={recordingHere}
          onclick={() => {
            deleting = true;
            deleteError = null;
          }}
        >
          Mitschrift löschen
        </ActionButton>
      </div>
    </div>

    <StatusNotice {message} kind={messageKind} popup />

    {#if !recordingHere}
      {#key recoveryKey}
        <MitschriftWiederherstellen mitschriftId={mitschrift.id} ondone={() => void load()} />
      {/key}
    {/if}

    {#if runningJobs.length > 0}
      <div class="border-l-2 border-warning py-1 pl-4 text-sm" role="status" aria-live="polite">
        <p class="font-semibold text-warning">
          {runningJobs.some((a) => a.untilMs !== null)
            ? 'Lücken der Aufnahme werden nachtranskribiert …'
            : 'Die Aufnahme wird transkribiert …'}
        </p>
        <p class="mt-1 text-neutral-700">
          Das dauert meist einige Minuten. Die Seite fragt selbst nach; du kannst sie auch schließen
          und später wiederkommen.
        </p>
      </div>
    {/if}
    {#each failedJobs as job (job.id)}
      <div class="border-l-2 border-danger py-1 pl-4 text-sm" role="alert">
        <p class="font-semibold text-danger">
          {job.untilMs === null
            ? 'Die Transkription der Datei ist fehlgeschlagen.'
            : `Die Lücke ab ${formatClock(job.offsetMs)} konnte nicht transkribiert werden.`}
        </p>
        {#if job.error}<p class="mt-1 text-neutral-700">{job.error}</p>{/if}
        <ActionButton
          class="mt-2"
          onclick={async () => {
            await dismissJob(job.id);
            recoveryKey++;
          }}
        >
          Ausblenden
        </ActionButton>
      </div>
    {/each}

    {#if mitschrift.status === 'datei' && runningJobs.length === 0}
      <MitschriftUpload {mitschrift} onstarted={(detail) => show(detail)} />
    {/if}

    {#if mitschrift.status === 'live'}
      <MitschriftLive
        {mitschrift}
        {user}
        onfinished={finished}
        ondetail={show}
        onchange={load}
        {notify}
        onrecording={(value) => (recordingHere = value)}
      />
    {/if}

    {#if !recordingHere && mitschrift.status !== 'datei'}
      <div class="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <MitschriftTranskript {mitschrift} onchange={load} ondeleted={afterDelete} {notify} />
        <MitschriftNotizen {mitschrift} {generating} onchange={load} {notify} />
      </div>
    {/if}
  {/if}
</div>

<EditDialog
  open={editing !== null}
  title="Titel und Datum"
  busy={editBusy}
  error={editError}
  onsubmit={saveEdit}
  onclose={() => (editing = null)}
>
  {#if editing}
    <div class="space-y-4">
      <FormField id="edit-title" label="Titel" error={editErrors.title}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="200"
            required
            bind:value={editing!.title}
          />
        {/snippet}
      </FormField>
      <FormField id="edit-date" label="Datum des Meetings" error={editErrors.date}>
        {#snippet children(attrs)}
          <input {...attrs} type="date" class="form-input" required bind:value={editing!.date} />
        {/snippet}
      </FormField>
    </div>
  {/if}
</EditDialog>

<EditDialog
  open={deleting}
  title="Mitschrift löschen"
  busy={deleteBusy}
  error={deleteError}
  submitLabel="Endgültig löschen"
  busyLabel="Wird gelöscht …"
  onsubmit={remove}
  onclose={() => (deleting = false)}
>
  <p class="text-sm text-neutral-800">
    „{mitschrift?.title}“ wird mit Transkript und Notizen endgültig gelöscht. Das lässt sich nicht
    rückgängig machen.
  </p>
</EditDialog>
